from pathlib import Path
import hashlib, json
from datetime import datetime, timezone
root = Path(__file__).resolve().parents[1]
base = root / 'public' / 'app'
files = sorted(p for p in base.rglob('*') if p.is_file() and 'tests' not in p.relative_to(base).parts and p.name != 'version.js')
hash = hashlib.sha256()
for path in files:
    hash.update(path.relative_to(root).as_posix().encode())
    hash.update(b'\0')
    hash.update(path.read_bytes().replace(b'\r\n', b'\n'))
    hash.update(b'\0')
version = {'schema': 1, 'revision': hash.hexdigest(), 'publishedAt': datetime.now(timezone.utc).isoformat()}
(base / 'version.js').write_text('export const BUILD = ' + json.dumps(version) + ';\n', encoding='utf-8')
manifest = {**version, 'files': {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest() for path in [*files, base / 'version.js']}}
(root / 'version.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(version['revision'])
