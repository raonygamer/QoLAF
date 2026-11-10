"""Poll upstream identities; download the full asset snapshot only if changed."""
import hashlib
import json
import os
import urllib.error
import urllib.request
from snapshot import fetch


def changed(snapshot):
    records = {entry['path']: entry['sha256'] for entry in snapshot['files']}
    paths = ['astroflux.js', 'playerio/playerio-loader.js', 'playerio/PlayerIOClient.minified.js']
    paths += [f'manifest/{name}.json' for name in ('data', 'fonts', 'textures', 'sound', 'ui')]
    for path in paths:
        if hashlib.sha256(fetch(path)).hexdigest() != records.get(path):
            print('Upstream changed:', path)
            return True
    print('Upstream client, SDK, and manifests are unchanged.')
    return False


def main():
    url = os.environ['DEPLOYED_URL'].rstrip('/') + '/upstream/snapshot.json'
    try:
        request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(request, timeout=30) as response:
            snapshot = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        update = True
    else:
        update = changed(snapshot)
    result = 'true' if update else 'false'
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('changed=' + result + '\n')


if __name__ == '__main__':
    main()
