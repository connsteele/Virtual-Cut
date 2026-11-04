# Screen text engine

Reads on-screen text from keyframes (VC-141) with RapidOCR and the PP-OCRv6 small models on
DirectML (decided on the review board, October 10, D3). It runs in its own Python 3.12 runtime,
apart from the speech engine, because its ONNX Runtime build (DirectML) clashes with the speech
engine's (CPU).

## Where it lives

`electron/screen-text-runtime.cts` finds the engine, in this order:

1. `VIRTUAL_CUT_OCR_RUNTIME` in the environment (development and checks; see `.env.example`).
2. The folder saved by setup in the profile (`screen-text-runtime.json`, `{ "folder": "..." }`).
3. `ocr` beside the bundled tools.

An install folder holds `python\python.exe` (Python 3.12 embeddable) and `libraries\` (the
packages below). The models ship inside RapidOCR's wheel, in `libraries\rapidocr\models`
(`PP-OCRv6_det_small.onnx`, `PP-OCRv6_rec_small.onnx`); their presence marks a complete install.

## Pinned packages (Sprint 11)

Python 3.12.10 embeddable (the speech engine's archive) and 23 wheels, 126.7 MB to download,
about 0.4 GB installed: rapidocr 3.9.2, onnxruntime-directml 1.24.4, opencv-python 5.0.0.93,
numpy 2.5.4, pillow 13.0.0, sympy 1.14.0, shapely 2.2.0 and small pure-Python dependencies. The
hash-checked manifest is VC-192's.

## Worker

`worker.py` speaks JSON lines on stdin and stdout: `check` reads `check.png` (a neutral test image)
and says whether DirectML is in use; `read` returns, per image, each line's text, box and
confidence. See its docstring. It records facts only and never labels text.
