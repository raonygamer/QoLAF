"""Fetch public game resources into the deployment artifact, never into Git."""
import concurrent.futures
import argparse
import hashlib
import json
import re
import shutil
import time
import urllib.parse
import urllib.request
from pathlib import Path

ORIGIN = 'https://astroflux.net/'
DEST = Path(__file__).resolve().parent.parent / 'dist' / 'upstream'
PREFIXES = ('ui/', 'fonts/', 'textures/', 'data/', 'sound/', 'playerio/', 'manifest/')


def asset_path(value):
    return (value.startswith(PREFIXES) and not any(c in value for c in ('?', '#', '\\', ':'))
            and all(p not in ('', '.', '..') for p in value.split('/')))


def haxe_strings(text):
    """Read length-prefixed strings without mistaking reference IDs for paths."""
    pos = 0
    while match := re.search(r'y(\d+):', text[pos:]):
        start = pos + match.end()
        end = start + int(match[1])
        if end > len(text):
            break
        yield urllib.parse.unquote(text[start:end])
        pos = end


def fetch(path, version=None):
    url = urllib.parse.urljoin(ORIGIN, urllib.parse.quote(path, safe='/'))
    if version:
        url += '?v=' + version
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'QoLAF/0.1 (public asset deployment)'})
            with urllib.request.urlopen(request, timeout=60) as response:
                if not response.url.startswith(ORIGIN):
                    raise ValueError('Unexpected upstream redirect')
                content = response.read()
                if response.headers.get_content_type() == 'text/html':
                    raise ValueError('Unexpected HTML for asset ' + path)
                return content
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client-file', type=Path,
                        help='Use these exact client bytes; upstream must still match before publication')
    args = parser.parse_args()
    staging = DEST.with_name('upstream-staging')
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    records = []

    def save(path, data):
        target = staging / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        records.append({'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})

    bundle = args.client_file.read_bytes() if args.client_file else fetch('astroflux.js')
    source = bundle.decode('utf-8')
    versions = set(re.findall(r'"v=(\d+)"', source))
    if len(versions) != 1:
        raise ValueError('Expected exactly one upstream asset version; inspect the new bundle')
    version = versions.pop()
    save('astroflux.js', bundle)
    paths = {'playerio/playerio-loader.js', 'playerio/PlayerIOClient.minified.js', 'ui/russo_one.ttf'}
    # Literal asset references plus encoded paths in the embedded default manifest.
    for value in re.findall(r'"([^"\n]+)"', source):
        if asset_path(value) and re.search(r'\.(png|jpg|xml|fnt|json|ttf|mp3)$', value):
            paths.add(value)
    paths.update(value for value in haxe_strings(source) if asset_path(value))
    for name in ('data', 'fonts', 'textures', 'sound', 'ui'):
        path = f'manifest/{name}.json'
        raw = fetch(path, version)
        manifest = json.loads(raw)
        if not isinstance(manifest.get('assets'), str) or manifest.get('rootPath') != '../':
            raise ValueError('Manifest format changed: ' + path)
        paths.update(value for value in haxe_strings(manifest['assets']) if asset_path(value))
        save(path, raw)
    paths.difference_update(r['path'] for r in records)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        jobs = {pool.submit(fetch, path, version): path for path in sorted(paths)}
        for future in concurrent.futures.as_completed(jobs):
            path = jobs[future]
            save(path, future.result())
    # Refuse to publish if an upstream deployment changed mid-download.
    if fetch('astroflux.js') != bundle:
        raise ValueError('Upstream client changed while downloading. Re-run deployment.')
    pin = re.search(r'sha256:"([0-9a-f]{64})"', (staging / 'playerio/playerio-loader.js').read_text())
    sdk_hash = hashlib.sha256((staging / 'playerio/PlayerIOClient.minified.js').read_bytes()).hexdigest()
    if not pin or pin[1] != sdk_hash:
        raise ValueError('PlayerIO SDK does not match the official loader pin')
    (staging / 'snapshot.json').write_text(json.dumps({
        'origin': ORIGIN, 'assetVersion': version,
        'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'clientSha256': hashlib.sha256(bundle).hexdigest(),
        'files': sorted(records, key=lambda r: r['path']),
    }, indent=2) + '\n')
    shutil.rmtree(DEST, ignore_errors=True)
    staging.rename(DEST)
    print(f'Snapshotted {len(records)} public resources; {sum(r["bytes"] for r in records):,} bytes; asset version {version}')


if __name__ == '__main__':
    main()
