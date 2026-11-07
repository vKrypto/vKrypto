"""Stamp browser worker assets before Jekyll builds the deployment artifact."""
import argparse
import hashlib
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--directory', type=Path, default=Path('build/notify'))
parser.add_argument('--version')
args = parser.parse_args()
worker = args.directory / 'sw.js'
source = worker.read_text()
canonical = re.sub(r'^const SW_VERSION = .*;\n', '', source)
inputs = canonical + ''.join(p.name + p.read_text() for p in sorted(args.directory.glob('*.js')) if p != worker)
version = args.version or 'local-' + hashlib.sha256(inputs.encode()).hexdigest()[:16]
worker.write_text('const SW_VERSION = ' + json.dumps(version) + ';\n' + canonical)
(args.directory / 'version.json').write_text(json.dumps({'version': version}, indent=2) + '\n')
