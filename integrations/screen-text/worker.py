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

A failed request replies {"id", "ok": false, "error"} and the worker keeps going. It stops at
end of input. Facts only: text, where, confidence. Nothing here decides what text means.
"""
import json
import os
import sys
import time

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


if __name__ == "__main__":
    main()
