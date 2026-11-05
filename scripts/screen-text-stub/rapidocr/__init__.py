"""A stand-in for RapidOCR in checks (VC-141), so the real worker, guard and FFmpeg pipe run on
any PC without the screen text engine. It reads nothing: each frame gets a fixed line at the top
left and a line named after the frame's brightness, so the same picture always gives the same
lines. Set VIRTUAL_CUT_STUB_OCR_MS to slow each reading down (pause checks).
"""
import os
import time


class OCRVersion:
    PPOCRV6 = "PP-OCRv6"


class ModelType:
    SMALL = "small"


class _Session:
    def get_providers(self):
        return ["CPUExecutionProvider"]


class _Part:
    def __init__(self):
        self.session = type("Wrapped", (), {"session": _Session()})()


class _Result:
    def __init__(self, lines):
        self.boxes = [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]] for (x0, y0, x1, y1), _, _ in lines]
        self.txts = [t for _, t, _ in lines]
        self.scores = [s for _, _, s in lines]


class RapidOCR:
    def __init__(self, params=None):
        self.text_det = _Part()
        self.text_rec = _Part()

    def __call__(self, image):
        delay = float(os.environ.get("VIRTUAL_CUT_STUB_OCR_MS") or 0)
        if delay:
            time.sleep(delay / 1000)
        if isinstance(image, str):
            return _Result([((10, 10, 200, 40), "Screen text check", 0.99)])
        data, width, height = image if isinstance(image, tuple) else (image.tobytes(), image.shape[1], image.shape[0])
        step = max(1, len(data) // 4096)
        sample = data[::step]
        bright = sum(sample) / len(sample)
        return _Result([
            ((20, 20, 160, 48), "Score 100", 0.98),
            ((width // 3, height - 120, width * 2 // 3, height - 80), f"Brightness {int(bright // 32)}", 0.9),
        ])
