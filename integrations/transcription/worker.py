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
        if requested == "auto" and device == "cpu":
            emit({"type": "info", "device": "cpu", "message": reason})
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
            emit({"type": "info", "device": "cpu", "message": reason})
            model = load_model(device)
        emit({"type": "info", "device": device, "message": reason if device == "cpu" and requested == "auto" else ""})
        emit({"type": "stage", "message": "Recognizing speech", "progress": 0.05,
              "engine": faster_whisper.__version__, "runtime": ctranslate2.__version__})
        # Keep real utterance boundaries. Concatenating sparse speech through VAD can
        # align a cue to the preceding utterance, tens of seconds before it was spoken.
        # Scan bounded PCM windows; only a <=30-second recognition span is held at once.
        import wave
        from faster_whisper.vad import get_speech_timestamps, get_vad_model, VadOptions
        options = VadOptions(threshold=0.35, min_speech_duration_ms=100,
                             min_silence_duration_ms=700, speech_pad_ms=450,
                             max_speech_duration_s=25)
        # Voice probability per 32 ms window of the whole track, for each line's voice score
        # (VC-166). The same detector finds the speech intervals; this keeps its raw answer.
        detector = get_vad_model()
        voice = []
        with wave.open(wav, "rb") as audio:
            frames = audio.getnframes()
            duration = frames / 16000
            ranges = []
            position = 0
            while position < frames:
                raw = audio.readframes(60 * 16000)
                block = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
                windows = -(-len(block) // 512)
                voice.append(np.asarray(detector(np.pad(block, (0, windows * 512 - len(block))))).reshape(-1)[:windows])
                for span in get_speech_timestamps(block, options):
                    start, end = position + span["start"], position + span["end"]
                    if ranges and start - ranges[-1][1] <= 12800 and end - ranges[-1][0] <= 480000:
                        ranges[-1][1] = end
                    else:
                        ranges.append([start, end])
                position += len(block)
                emit({"type": "stage", "message": "Finding speech intervals", "progress": 0.05 + 0.05 * position / max(frames, 1)})
            voice = np.concatenate(voice) if voice else np.zeros(0, dtype=np.float32)
            def voice_score(spans):
                # Mean voice probability over the windows a line's own words cover (VC-166).
                windows = set()
                for a, b in spans:
                    first = max(0, int(a * 16000) // 512)
                    last = min(len(voice), -(-int(b * 16000) // 512))
                    windows.update(range(first, max(first + 1, last)))
                picked = [voice[i] for i in windows if i < len(voice)]
                return round(float(np.mean(picked)), 3) if picked else 0.0
            ordinal = 0
            language = request["language"] or None
            emit({"type": "info", "language": language or "", "duration": duration})
            # The app sends batch 8, with or without vocabulary hints; the harness may choose.
            # Preserve each utterance's real source offset; never concatenate gaps.
            batch_size = int(request.get("batchSize", 1))
            hints = request.get("vocabulary") or None
            guard = request.get("hintGuard") if hints else None
            redos = 0
            def plain(text):
                # The same normalisation as electron/stock-phrases.ts.
                import re
                text = re.sub(r"[^a-z0-9' ]+", " ", text.lower().replace("‘", "'").replace("’", "'"))
                return " ".join(text.split())
            stock = set(guard["stockPhrases"]) if guard else set()
            def guard_reason(segment):
                # VC-164: hints at batch 8 can swap real speech for a stock phrase ("Thank you
                # for watching!" over 28 s of dialogue). Such a line is recognized again without
                # hints, and the transcript keeps that text.
                if plain(segment.text) in stock:
                    return "stock-phrase"
                length = segment.end - segment.start
                words = len(segment.words or []) or len(segment.text.split())
                if length >= guard["minSeconds"] and words < length / guard["secondsPerWord"]:
                    return "sparse"
                return None
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
                    temperature=0, hotwords=hints, **extra)
                if language is None:
                    language = info.language
                    emit({"type": "info", "language": language, "languageProbability": info.language_probability, "duration": duration})
                found = []
                for segment in segments:
                    reason = guard_reason(segment) if guard else None
                    if not reason:
                        found.append((segment, 0.0, None))
                        continue
                    # Recognize this span again without hints; its times are from the span start.
                    first = max(0, int(segment.start * 16000))
                    last = min(len(chunk), int(segment.end * 16000) + 1)
                    again, _ = model.transcribe(chunk[first:last], language=language, beam_size=5,
                        word_timestamps=True, vad_filter=False, temperature=0, hotwords=None,
                        condition_on_previous_text=False, hallucination_silence_threshold=2)
                    found.extend((line, first / 16000, reason) for line in again)
                    redos += 1
                for segment, shift, reason in found:
                    local = start / 16000 + shift
                    at = request["offset"] + local
                    spoken = [(w.start + local, w.end + local) for w in segment.words or []]
                    line = {
                        "id": ordinal, "start": max(0, segment.start + at), "end": max(0, segment.end + at),
                        "text": segment.text, "noSpeechProbability": segment.no_speech_prob,
                        "averageLogProbability": segment.avg_logprob,
                        "voiceScore": voice_score(spoken or [(segment.start + local, segment.end + local)]),
                        "words": [{"start": max(0, w.start + at), "end": max(0, w.end + at),
                                   "text": w.word, "probability": w.probability} for w in segment.words or []]}
                    if reason:
                        line["hintGuard"] = reason
                    emit({"type": "segment", "segment": line,
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
        emit({"type": "complete", "elapsedMs": round((time.monotonic() - began) * 1000), "peakMemoryBytes": memory.peak if measured else None,
              **({"guardRedos": redos} if guard else {})})
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
