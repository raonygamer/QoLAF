import hashlib
import importlib.util
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from snapshot import asset_path, haxe_strings

spec = importlib.util.spec_from_file_location('check_upstream', Path(__file__).resolve().parents[1] / 'scripts/check-upstream.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class SnapshotTests(unittest.TestCase):
    def test_manifest_paths_are_bounded(self):
        self.assertTrue(asset_path('textures/texture_body.png'))
        for path in ('../token', 'ui/../token', '/ui/a.png', 'https://example.com/a', 'ui/a?token=1'):
            self.assertFalse(asset_path(path))

    def test_haxe_length_and_references(self):
        self.assertEqual(list(haxe_strings('aoy4:pathy11:ui%2Fbg.jpgR1gh')), ['path', 'ui/bg.jpg'])

    def test_unchanged_release_skips_deploy(self):
        paths = ['astroflux.js', 'playerio/playerio-loader.js', 'playerio/PlayerIOClient.minified.js']
        paths += [f'manifest/{name}.json' for name in ('data', 'fonts', 'textures', 'sound', 'ui')]
        snapshot = {'files': [{'path': p, 'sha256': hashlib.sha256(p.encode()).hexdigest()} for p in paths]}
        checker.fetch = lambda path: path.encode()
        self.assertFalse(checker.changed(snapshot))
        snapshot['files'][-1]['sha256'] = 'changed'
        self.assertTrue(checker.changed(snapshot))


if __name__ == '__main__':
    unittest.main()
