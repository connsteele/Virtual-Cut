import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('vcut', pathlib.Path(__file__).parents[1] / 'integrations/resolve/Virtual Cut metadata.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class Item:
    def __init__(self, file, markers):
        self.file, self.markers, self.fail = file, copy.deepcopy(markers), False
    def GetMarkers(self): return copy.deepcopy(self.markers)
    def GetClipProperty(self): return {'File Path': self.file, 'FPS': '60'}
    def GetMediaId(self): return 'media-id'
    def GetName(self): return 'Renamed in Resolve'
    def DeleteMarkerAtFrame(self, frame):
        return self.markers.pop(frame, None) is not None
    def AddMarker(self, frame, color, name, note, duration, customData):
        if self.fail:
            self.fail = False
            return False
        if frame in self.markers: return False
        self.markers[frame] = dict(color=color, name=name, note=note, duration=duration, customData=customData)
        return True


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.file = str(pathlib.Path(self.temp.name) / 'clip.mp4')
        pathlib.Path(self.file).write_bytes(b'verified video fixture')
        self.data = {'schema': 'virtual-cut-export', 'version': 2, 'exportId': '12345678-1234-4234-9234-123456789012', 'verified': {'actual': {'start': 6, 'end': 10}, 'videoPackets': 240, 'bytes': pathlib.Path(self.file).stat().st_size, 'sha256': helper.hashlib.sha256(pathlib.Path(self.file).read_bytes()).hexdigest()}, 'markers': [dict(id='one', name='First', note='Line one\n日本語', colorName='Blue', containerTime=.554444), dict(id='two', name='Second', note='Two\nlines', colorName='Red', containerTime=1.242176)]}
        self.save()
        self.data['verified']['constantFrameDuration'] = 1 / 60
        self.save()
        self.old = {0.0: dict(name='Clip start', note='', color='Blue', duration=1, customData=''), 33.0: dict(name='First', note='', color='Blue', duration=1, customData=''), 74.0: dict(name='Second', note='', color='Blue', duration=1, customData='')}
    def tearDown(self): self.temp.cleanup()
    def save(self): pathlib.Path(self.file + '.vcut.json').write_text(json.dumps(self.data), encoding='utf-8')
    def test_rounding_idempotence_and_preservation(self):
        item = Item(self.file, self.old)
        plan = helper.plan_clip(item)
        self.assertEqual([c['frame'] for c in plan['changes']], [33, 74])
        self.assertEqual(helper.apply_clip(plan), 2)
        self.assertEqual(item.markers[74]['color'], 'Red')
        self.assertEqual(item.markers[33]['note'], 'Line one\n日本語')
        self.assertEqual(item.markers[0], self.old[0])
        self.assertEqual(helper.plan_clip(item)['changes'], [])
        item.markers[74]['note'] = 'User edited'
        self.assertTrue(helper.plan_clip(item)['conflicts'])
    def test_explicit_generated_anchor(self):
        self.data['version'] = 3
        self.data['generatedChapters'] = [dict(name='Clip start', containerTime=0, purpose='quicktime-leading-anchor')]
        self.save()
        item = Item(self.file, self.old)
        plan = helper.plan_clip(item)
        self.assertIsNone(plan['changes'][0]['after'])
        self.assertEqual(helper.apply_clip(plan), 3)
        self.assertNotIn(0, item.markers)
        self.assertEqual(helper.plan_clip(item)['changes'], [])
        # Failure after removing the anchor must restore the entire snapshot.
        item = Item(self.file, self.old); item.fail = True
        with self.assertRaisesRegex(RuntimeError, 'restored'): helper.apply_clip(helper.plan_clip(item))
        self.assertEqual(item.markers, self.old)
        # User edits and genuine zero-time markers are never removed.
        item = Item(self.file, self.old); item.markers[0]['note'] = 'Mine'
        self.assertFalse(any(c['after'] is None for c in helper.plan_clip(item)['changes']))
        self.data['markers'].insert(0, dict(id='real', name='Clip start', note='Genuine', colorName='Blue', containerTime=0))
        self.save()
        item = Item(self.file, self.old)
        plan = helper.plan_clip(item)
        self.assertFalse(any(c['after'] is None for c in plan['changes']))
        helper.apply_clip(plan)
        self.assertEqual(item.markers[0]['note'], 'Genuine')
        self.data['markers'] = []; self.save()
        self.assertEqual(helper.plan_clip(Item(self.file, self.old))['changes'], [])

    def test_conflicts_and_stale_plan(self):
        item = Item(self.file, self.old)
        item.markers[33]['note'] = 'User note'
        plan = helper.plan_clip(item)
        self.assertTrue(plan['conflicts'])
        with self.assertRaisesRegex(ValueError, 'conflicts'): helper.apply_clip(plan)
        self.assertEqual(item.markers[33]['note'], 'User note')
        item = Item(self.file, self.old)
        plan = helper.plan_clip(item)
        item.markers[100] = dict(name='Unrelated', note='', color='Green', duration=1)
        with self.assertRaisesRegex(ValueError, 'changed'): helper.apply_clip(plan)
    def test_rollback(self):
        item = Item(self.file, self.old)
        plan = helper.plan_clip(item)
        item.fail = True
        with self.assertRaisesRegex(RuntimeError, 'restored'): helper.apply_clip(plan)
        self.assertEqual(item.GetMarkers(), self.old)
    def test_hash_and_metadata_validation(self):
        pathlib.Path(self.file).write_bytes(b'corrupted video fixture')
        with self.assertRaises(ValueError): helper.plan_clip(Item(self.file, self.old))
    def test_zero_collision_ambiguity_and_vfr(self):
        self.data['markers'][0]['containerTime'] = 0
        changes, conflicts = helper.plan_markers(self.data, 60, self.old)
        self.assertTrue(conflicts)  # Clip start is preserved.
        self.data['markers'][0]['containerTime'] = self.data['markers'][1]['containerTime']
        changes, conflicts = helper.plan_markers(self.data, 60, {})
        self.assertTrue(conflicts)
        self.data['verified'].pop('constantFrameDuration')
        self.data['markers'][0]['containerTime'] = .554444
        changes, conflicts = helper.plan_markers(self.data, 60, {})
        self.assertTrue(conflicts)
        changes, conflicts = helper.plan_markers(self.data, 60, self.old)
        self.assertFalse(conflicts)  # Existing chapter establishes import coordinates.
        old = copy.deepcopy(self.old); old[34] = copy.deepcopy(old[33])
        self.assertTrue(helper.plan_markers(self.data, 60, old)[1])


if __name__ == '__main__': unittest.main()
