"""Install pinned wheels without pip or machine changes; validate without loading a model."""
import json
import shutil
import sys
import zipfile
from pathlib import Path, PurePosixPath


def unpack(archive, destination):
    root = Path(destination).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        entries = []
        for info in z.infolist():
            name = PurePosixPath(info.filename)
            if name.is_absolute() or '..' in name.parts or '\\' in info.filename or ':' in info.filename or (info.external_attr >> 16) & 0xF000 == 0xA000:
                raise RuntimeError('Unsafe wheel entry.')
            parts = name.parts
            if parts and parts[0].endswith('.data'):
                if len(parts) < 3:
                    continue
                if parts[1] in ('purelib', 'platlib'):
                    parts = parts[2:]
                else:
                    # Preserve non-library data/licenses; no command-line scripts are invoked.
                    parts = ('wheel-data',) + parts
            target = root.joinpath(*parts).resolve()
            if not target.is_relative_to(root) or target == root:
                raise RuntimeError('Unsafe wheel entry.')
            entries.append((info, target))
        for info, target in entries:
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(info) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)


def main():
    request = json.loads(sys.stdin.readline())
    if request['mode'] == 'unpack':
        unpack(request['archive'], request['destination'])
    elif request['mode'] == 'validate':
        sys.path.insert(0, request['libraries'])
        import av, ctranslate2, faster_whisper, numpy, onnxruntime, tokenizers
        import importlib.metadata as metadata
        for package, version in request['versions'].items():
            if metadata.version(package) != version:
                raise RuntimeError('Installed dependency version mismatch: ' + package)
        model = Path(request['model'])
        json.loads((model / 'config.json').read_text('utf-8'))
        tokenizers.Tokenizer.from_file(str(model / 'tokenizer.json'))
        print(json.dumps({'python': sys.version.split()[0], 'engine': faster_whisper.__version__, 'ctranslate2': ctranslate2.__version__, 'validated': True}))
    else:
        raise RuntimeError('Unknown install operation.')


if __name__ == '__main__':
    main()
