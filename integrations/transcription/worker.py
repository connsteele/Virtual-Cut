"""One local recognition job. JSON lines are the only stdout protocol.

The guard owns a Windows kill-on-close Job Object and watches the Electron
parent handle. The recognition process cannot read its request until assigned
to that job. Killing the guard, closing the app, or a parent crash ends the
recognizer and ffmpeg descendants. No model remains resident between jobs.
"""
import ctypes
import json
import os
import subprocess
import sys
import time


def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def guard(parent_pid):
    if os.name != "nt":
        raise RuntimeError("This transcription worker currently requires Windows.")
    from ctypes import wintypes as w
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
    k.CreateJobObjectW.restype = w.HANDLE
    k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    k.OpenProcess.restype = w.HANDLE
    k.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
    k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
    k.CloseHandle.argtypes = [w.HANDLE]

    class Basic(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                    ("flags", w.DWORD), ("min_ws", ctypes.c_size_t), ("max_ws", ctypes.c_size_t),
                    ("active", w.DWORD), ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(str(i), ctypes.c_uint64) for i in range(6)]
    class Limits(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", IO), ("process_memory", ctypes.c_size_t),
                    ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]

    parent = k.OpenProcess(0x100000, False, parent_pid)  # SYNCHRONIZE, no write access
    if not parent or k.WaitForSingleObject(parent, 0) != 258:
        raise RuntimeError("The app is no longer running.")
    job = k.CreateJobObjectW(None, None)
    child = None
    try:
        limits = Limits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not job or not k.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())
        request = sys.stdin.buffer.readline(1024 * 1024)
        if not request.endswith(b"\n"):
            raise RuntimeError("Missing transcription request.")
        child = subprocess.Popen([sys.executable, "-u", __file__, "--worker"], stdin=subprocess.PIPE,
                                 creationflags=subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS)
        if not k.AssignProcessToJobObject(job, int(child._handle)):
            child.kill()
            raise ctypes.WinError(ctypes.get_last_error())
        emit({"type": "worker", "pid": child.pid, "guardPid": os.getpid()})
        child.stdin.write(request)
        child.stdin.close()
        while child.poll() is None:
            if k.WaitForSingleObject(parent, 250) != 258:
                return 2
        return child.returncode
    finally:
        if job:
            k.CloseHandle(job)
        if child is not None:
            child.wait(timeout=10)
        k.CloseHandle(parent)


def worker():
    request = json.loads(sys.stdin.buffer.readline(1024 * 1024))
    sys.path.insert(0, request["libraries"])
    # DLL search is scoped to this disposable process; never change machine PATH.
    handles = []
    gpu_root = request.get("gpuLibraries")
    if gpu_root:
        for folder in [gpu_root, os.path.join(gpu_root, "nvidia", "cublas", "bin"),
                       os.path.join(gpu_root, "nvidia", "cudnn", "bin")]:
            if os.path.isdir(folder):
                handles.append(os.add_dll_directory(folder))
                os.environ["PATH"] = folder + os.pathsep + os.environ.get("PATH", "")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["OMP_NUM_THREADS"] = str(request["threads"])
    import ctranslate2
    def gpu_ready():
        try:
            if not ctranslate2.get_cuda_device_count():
                return False, "No compatible NVIDIA GPU detected. Automatic will use CPU."
            for name in ["cublas64_12.dll", "cublasLt64_12.dll", "cudnn64_9.dll"]:
                ctypes.WinDLL(name)
            return True, "NVIDIA GPU libraries ready. Recognition verifies the model when it starts."
        except Exception as error:
            return False, "NVIDIA runtime unavailable: " + str(error)
    if request.get("mode") == "probe":
        available, message = gpu_ready()
        emit({"type": "gpu", "available": available, "message": message})
        emit({"type": "complete"})
        return
    os.environ["TEMP"] = os.environ["TMP"] = request["tempDirectory"]
    began = time.monotonic()
    emit({"type": "stage", "message": "Preparing speech audio", "progress": 0.01})
    wav = request["wav"]
    try:
        subprocess.run([request["ffmpeg"], "-v", "error", "-nostdin", "-i", request["source"],
                        "-map", "0:" + str(request["track"]), "-vn", "-ac", "1", "-ar", "16000",
                        "-c:a", "pcm_s16le", "-y", wav], check=True, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        emit({"type": "stage", "message": "Loading local speech model", "progress": 0.03})
        from faster_whisper import WhisperModel
        import faster_whisper
        import numpy as np
        requested = request.get("device", "auto")
        available, reason = gpu_ready() if requested != "cpu" else (False, "CPU selected")
        if requested == "cuda" and not available:
            raise RuntimeError(reason + ". Choose Automatic or CPU, or configure the GPU runtime folder.")
        device = "cuda" if requested != "cpu" and available else "cpu"
        def load_model(device):
            model = WhisperModel(request["model"], device=device,
                                 compute_type="float16" if device == "cuda" else "int8",
                                 cpu_threads=request["threads"], local_files_only=True)
            if device == "cuda":
                model.encode(model.feature_extractor(np.zeros(30 * 16000, dtype=np.float32))[:, :3000])
            return model
        try:
            model = load_model(device)
        except Exception as error:
            if requested != "auto" or device != "cuda":
                raise
            import gc
            gc.collect()
            reason = "GPU check failed; using CPU: " + str(error)
            device = "cpu"
            model = load_model(device)
        emit({"type": "info", "device": device, "message": reason if device == "cpu" and requested == "auto" else ""})
        emit({"type": "stage", "message": "Recognizing speech", "progress": 0.05,
              "engine": faster_whisper.__version__, "runtime": ctranslate2.__version__})
        # Keep real utterance boundaries. Concatenating sparse speech through VAD can
        # align a cue to the preceding utterance, tens of seconds before it was spoken.
        # Scan bounded PCM windows; only a <=30-second recognition span is held at once.
        import wave
        from faster_whisper.vad import get_speech_timestamps, VadOptions
        options = VadOptions(threshold=0.35, min_speech_duration_ms=100,
                             min_silence_duration_ms=700, speech_pad_ms=450,
                             max_speech_duration_s=25)
        with wave.open(wav, "rb") as audio:
            frames = audio.getnframes()
            duration = frames / 16000
            ranges = []
            position = 0
            while position < frames:
                raw = audio.readframes(60 * 16000)
                block = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
                for span in get_speech_timestamps(block, options):
                    start, end = position + span["start"], position + span["end"]
                    if ranges and start - ranges[-1][1] <= 12800 and end - ranges[-1][0] <= 480000:
                        ranges[-1][1] = end
                    else:
                        ranges.append([start, end])
                position += len(block)
                emit({"type": "stage", "message": "Finding speech intervals", "progress": 0.05 + 0.05 * position / max(frames, 1)})
            ordinal = 0
            language = request["language"] or None
            emit({"type": "info", "language": language or "", "duration": duration})
            # Experimental batching is available to the measurement harness only.
            # Preserve each utterance's real source offset; never concatenate gaps.
            batch_size = int(request.get("batchSize", 1))
            if batch_size not in [1, 2, 4, 8]:
                raise RuntimeError("Unsupported speech batch size.")
            groups = []
            for span in ranges:
                if groups and len(groups[-1]) < batch_size and span[1] - groups[-1][0][0] <= 180 * 16000:
                    groups[-1].append(span)
                else:
                    groups.append([span])
            for group in groups:
                start, end = group[0][0], group[-1][1]
                audio.setpos(start)
                chunk = np.frombuffer(audio.readframes(end - start), dtype="<i2").astype(np.float32) / 32768.0
                transcriber = model
                extra = {"condition_on_previous_text": False, "hallucination_silence_threshold": 2}
                if batch_size > 1:
                    from faster_whisper import BatchedInferencePipeline
                    transcriber = BatchedInferencePipeline(model)
                    extra = {"batch_size": batch_size, "clip_timestamps": [
                        {"start": (a - start) / 16000, "end": (b - start) / 16000} for a, b in group]}
                segments, info = transcriber.transcribe(chunk, language=language, beam_size=5,
                    word_timestamps=True, vad_filter=False,
                    temperature=0, hotwords=request.get("vocabulary") or None, **extra)
                if language is None:
                    language = info.language
                    emit({"type": "info", "language": language, "languageProbability": info.language_probability, "duration": duration})
                offset = request["offset"] + start / 16000
                for segment in segments:
                    emit({"type": "segment", "segment": {
                        "id": ordinal, "start": max(0, segment.start + offset), "end": max(0, segment.end + offset),
                        "text": segment.text, "noSpeechProbability": segment.no_speech_prob,
                        "averageLogProbability": segment.avg_logprob,
                        "words": [{"start": max(0, w.start + offset), "end": max(0, w.end + offset),
                                   "text": w.word, "probability": w.probability} for w in segment.words or []]},
                          "progress": min(0.99, 0.10 + 0.89 * end / max(frames, 1))})
                    ordinal += 1
        from ctypes import wintypes as w
        class Memory(ctypes.Structure):
            _fields_ = [("cb", w.DWORD), ("faults", w.DWORD)] + [(name, ctypes.c_size_t) for name in
                ["peak", "working", "peak_pool", "pool", "peak_nonpaged", "nonpaged", "pagefile", "peak_pagefile"]]
        memory = Memory(); memory.cb = ctypes.sizeof(memory)
        kernel = ctypes.WinDLL("kernel32"); kernel.GetCurrentProcess.restype = w.HANDLE
        psapi = ctypes.WinDLL("psapi"); psapi.GetProcessMemoryInfo.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD]
        measured = psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(memory), memory.cb)
        emit({"type": "complete", "elapsedMs": round((time.monotonic() - began) * 1000), "peakMemoryBytes": memory.peak if measured else None})
    finally:
        if os.path.isfile(wav):
            os.unlink(wav)


if __name__ == "__main__":
    try:
        if sys.argv[1] == "--guard":
            sys.exit(guard(int(sys.argv[2])))
        elif sys.argv[1] == "--worker":
            worker()
        else:
            raise RuntimeError("Unknown worker mode.")
    except Exception as error:
        emit({"type": "error", "message": str(error)[:3000]})
        sys.exit(1)
