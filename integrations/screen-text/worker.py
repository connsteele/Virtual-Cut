"""Screen text worker (VC-141, VC-192). JSON lines are the only stdout protocol.

Run with the screen text engine's own Python:
    python.exe -I worker.py <libraries folder>
Each stdin line is one request; each gets one reply line with the same "id".

    {"id": 1, "op": "check"}
        Reads check.png beside this file. Reply: {"id", "ok", "text", "gpu", "providers", "ms"}.
        "gpu" is true when DirectML runs both models.
    {"id": 2, "op": "read", "images": ["C:/.../00001.png", ...]}
        Reply: {"id", "ok", "results": [{"lines": [{"text", "box", "score"}], "ms"}]}
        "box" is [x0, y0, x1, y1] in the image's own pixels (the axis-aligned bounds of the
        detected quadrilateral); "score" is the recognizer's confidence, 0 to 1.
    {"id": 3, "op": "read", "video": {...}}
        Reads a recording's keyframes as FFmpeg decodes them, one reply line per frame
        (VC-141); see read_video. Long passes run behind a guard; see guard.

A failed request replies {"id", "ok": false, "error"} and the worker keeps going. It stops at
end of input. Facts only: text, where, confidence. Nothing here decides what text means.
"""
import ctypes
import json
import os
import re
import subprocess
import sys
import threading
import time
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))


def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def engine():
    from rapidocr import ModelType, OCRVersion, RapidOCR

    version, size = OCRVersion.PPOCRV6, ModelType.SMALL
    # Settings from the October spike: whole input at its own size (limit_type max), no angle
    # classifier. RapidOCR's defaults upscale and run 2 to 8 times slower.
    return RapidOCR(params={
        "Det.ocr_version": version, "Rec.ocr_version": version,
        "Det.model_type": size, "Rec.model_type": size,
        "Global.log_level": "error", "Global.use_cls": False, "Det.limit_type": "max",
        "EngineConfig.onnxruntime.use_dml": True,
    })


def lines(result):
    out = []
    for quad, text, score in zip(result.boxes if result.boxes is not None else (), result.txts or (), result.scores or ()):
        xs = [float(p[0]) for p in quad]
        ys = [float(p[1]) for p in quad]
        out.append({"text": text, "box": [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))], "score": round(float(score), 3)})
    return out


def main():
    sys.path.insert(0, sys.argv[1])
    ocr = engine()
    providers = [ocr.text_det.session.session.get_providers()[0], ocr.text_rec.session.session.get_providers()[0]]
    for raw in sys.stdin:
        if not raw.strip():
            continue
        request = {}
        try:
            request = json.loads(raw)
            if request.get("op") == "check":
                t = time.perf_counter()
                found = lines(ocr(os.path.join(HERE, "check.png")))
                emit({"id": request.get("id"), "ok": True, "text": " ".join(l["text"] for l in found),
                      "gpu": all(p == "DmlExecutionProvider" for p in providers), "providers": providers,
                      "ms": round((time.perf_counter() - t) * 1000)})
            elif request.get("op") == "read" and "video" in request:
                read_video(ocr, providers, request)
            elif request.get("op") == "read":
                results = []
                for image in request["images"]:
                    t = time.perf_counter()
                    found = lines(ocr(image))
                    results.append({"lines": found, "ms": round((time.perf_counter() - t) * 1000)})
                emit({"id": request.get("id"), "ok": True, "results": results})
            else:
                raise ValueError("Unknown screen text operation.")
        except Exception as error:  # one bad request never ends the worker
            emit({"id": request.get("id") if isinstance(request, dict) else None, "ok": False, "error": str(error)})


SHOWINFO = re.compile(rb"Parsed_showinfo.*?pts_time:\s*([-0-9.]+)")


def read_video(ocr, providers, request):
    """Streams one recording's keyframes through FFmpeg and reads each one (VC-141).

    {"id", "op": "read", "video": {"ffmpeg", "args", "width", "height", "same", "after"}}
    "args" make FFmpeg write raw bgr24 frames of width x height to stdout and log each frame with
    showinfo, whose pts_time is the frame's time. Frames at or before "after" are skipped. A frame
    inside a "same" span ([start, end] seconds where the picture does not change) together with
    the last frame read is not read again. One line per frame:
        {"id", "frame": {"time", "lines", "ms"}}    read
        {"id", "frame": {"time", "same": true}}      unchanged since the last frame read
    then {"id", "ok", "frames", "read", "ms", "gpu", "peakMemoryBytes"}.
    """
    try:
        import numpy as np
    except ImportError:  # only the checks' stand-in engine runs without numpy
        np = None

    video = request["video"]
    width, height = int(video["width"]), int(video["height"])
    size = width * height * 3
    spans = [(float(a), float(b)) for a, b in video.get("same") or []]
    after = video.get("after")
    began = time.perf_counter()
    times = deque()
    ready = threading.Condition()
    errors = deque(maxlen=20)
    process = subprocess.Popen([video["ffmpeg"], *video["args"]], stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def log():
        for raw in process.stderr:
            found = SHOWINFO.search(raw)
            if found:
                with ready:
                    times.append(float(found.group(1)))
                    ready.notify()
            elif raw.strip() and b"Parsed_showinfo" not in raw:
                errors.append(raw.decode("utf-8", "replace").strip())
        with ready:
            ready.notify()

    logger = threading.Thread(target=log, daemon=True)
    logger.start()
    frames = read = 0
    last = None
    try:
        while True:
            data = process.stdout.read(size)
            if len(data) < size:
                break
            with ready:
                ready.wait_for(lambda: times or not logger.is_alive(), timeout=30)
                if not times:
                    raise RuntimeError("FFmpeg gave a frame without its time.")
                t = times.popleft()
            frames += 1
            if after is not None and t <= after:
                continue
            if last is not None and any(a <= last and t <= b for a, b in spans if a <= t):
                emit({"id": request.get("id"), "frame": {"time": round(t, 3), "same": True}})
                continue
            started = time.perf_counter()
            image = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3) if np else (data, width, height)
            found = lines(ocr(image))
            read += 1
            last = t
            emit({"id": request.get("id"), "frame": {"time": round(t, 3), "lines": found,
                                                      "ms": round((time.perf_counter() - started) * 1000)}})
        code = process.wait()
        logger.join(timeout=5)
        if code != 0:
            raise RuntimeError("FFmpeg could not read the recording: " + (" ".join(errors) or f"exit {code}")[-800:])
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    emit({"id": request.get("id"), "ok": True, "frames": frames, "read": read,
          "ms": round((time.perf_counter() - began) * 1000),
          "gpu": all(p == "DmlExecutionProvider" for p in providers), "peakMemoryBytes": peak_memory()})


def peak_memory():
    if os.name != "nt":
        return None
    from ctypes import wintypes as w

    class Memory(ctypes.Structure):
        _fields_ = [("cb", w.DWORD), ("faults", w.DWORD)] + [(name, ctypes.c_size_t) for name in
            ["peak", "working", "peak_pool", "pool", "peak_nonpaged", "nonpaged", "pagefile", "peak_pagefile"]]
    memory = Memory()
    memory.cb = ctypes.sizeof(memory)
    kernel = ctypes.WinDLL("kernel32")
    kernel.GetCurrentProcess.restype = w.HANDLE
    psapi = ctypes.WinDLL("psapi")
    psapi.GetProcessMemoryInfo.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD]
    ok = psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(memory), memory.cb)
    return memory.peak if ok else None


def guard(libraries, parent_pid):
    """Long passes start the worker as `python.exe -I worker.py <libraries> --guard <app pid>`.

    The speech worker's guard (integrations/transcription/worker.py), passing stdin through for
    as long as the reader runs instead of one request: it owns a Windows kill-on-close Job Object,
    starts the reader inside it and watches the app, so closing the app, a crash or killing the
    guard ends the reader and its FFmpeg.
    """
    if os.name != "nt":
        raise RuntimeError("The screen text guard requires Windows.")
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
        # The reader loads its models before reading stdin, so this guard assigns it at once; any
        # FFmpeg it starts later is inside the job too.
        child = subprocess.Popen([sys.executable, "-I", os.path.abspath(__file__), libraries], stdin=subprocess.PIPE,
                                 creationflags=subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS)
        if not k.AssignProcessToJobObject(job, int(child._handle)):
            child.kill()
            raise ctypes.WinError(ctypes.get_last_error())
        emit({"id": None, "worker": child.pid, "guard": os.getpid()})

        def relay():
            try:
                for raw in sys.stdin.buffer:
                    child.stdin.write(raw)
                    child.stdin.flush()
            except OSError:
                pass
            finally:
                try:
                    child.stdin.close()
                except OSError:
                    pass

        threading.Thread(target=relay, daemon=True).start()
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


if __name__ == "__main__":
    # -I ignores PYTHONUTF8, and screen text and file names are often not ASCII.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) > 3 and sys.argv[2] == "--guard":
        try:
            sys.exit(guard(sys.argv[1], int(sys.argv[3])))
        except Exception as error:
            emit({"id": None, "ok": False, "error": str(error)[:3000]})
            sys.exit(1)
    main()
