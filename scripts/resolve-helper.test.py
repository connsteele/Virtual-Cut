import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import time

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


class TranscribedItem(Item):
    """Resolve 21.1.2+: a media-pool clip with its own start timecode and transcript."""
    def __init__(self, file, markers, start='00:00:00:00', fps='60', transcript=None):
        super().__init__(file, markers)
        self.start, self.fps, self.transcript, self.sets = start, fps, copy.deepcopy(transcript), 0
    def GetClipProperty(self): return {'File Path': self.file, 'FPS': self.fps, 'Start TC': self.start}
    def GetTranscription(self): return copy.deepcopy(self.transcript)
    def SetTranscription(self, transcription):
        self.sets += 1
        self.transcript = {'language': 'en', 'segments': copy.deepcopy(transcription['segments'])}
        return True


class ColoredItem(Item):
    """A media-pool clip with Resolve's clip color (MediaPoolItem.GetClipColor/SetClipColor)."""
    def __init__(self, file, markers, color='', keeps=True):
        super().__init__(file, markers)
        self.color, self.keeps, self.sets = color, keeps, 0
    def GetClipColor(self): return self.color
    def SetClipColor(self, name):
        self.sets += 1
        if self.keeps: self.color = name
        return True


class Tests(unittest.TestCase):
    def test_pool_discovery_nested_bins_duplicates_and_no_video_reads(self):
        class Folder:
            def __init__(self, id, clips, children=None): self.id, self.clips, self.children = id, clips, children or []
            def GetUniqueId(self): return self.id
            def GetClipList(self): return self.clips
            def GetSubFolderList(self): return self.children
        class Media:
            def __init__(self, id, file): self.id, self.file = id, file
            def GetMediaId(self): return self.id
            def GetClipProperty(self): return {'File Path':self.file}
        first = Media('one', self.file)
        duplicate = Media('two', self.file)
        child = Folder('child', [duplicate, Media('image','image.jpg'), Media('timeline','')])
        root = Folder('root', [first, first], [child])
        child.children = [root]  # Even an unexpected repeated bin cannot loop.
        pool = type('Pool', (), {'GetRootFolder':lambda _: root})()
        with patch('builtins.open', side_effect=AssertionError('Discovery read a file')), patch.object(helper.os.path, 'isfile', return_value=True) as exists:
            matches, scanned, checks = helper.discover_companions(helper.pool_items(pool))
        self.assertEqual([m.id for m in matches], ['one','two'])
        self.assertEqual((scanned,checks,exists.call_count), (4,1,1))
        supported = [Media(ext, 'clip.' + ext.upper()) for ext in ('mp4','mkv','mov','m4v','webm')]
        with patch.object(helper.os.path, 'isfile', return_value=True):
            self.assertEqual(helper.discover_companions(supported)[0], supported)
        # Report metadata lookup cost separately; this excludes live Resolve IPC and video hashes.
        items = [Media(str(i), str(pathlib.Path(self.temp.name) / (str(i)+'.mp4'))) for i in range(5000)]
        started = time.perf_counter()
        self.assertEqual(helper.discover_companions(items)[0], [])
        print('5000 local companion lookups (mock Media Pool): {:.3f}s'.format(time.perf_counter()-started))

    def test_matching_file_verification_is_reused_only_within_one_check(self):
        first, second = Item(self.file,self.old), Item(self.file,self.old)
        cache = {}
        with patch.object(helper, 'load_companion', wraps=helper.load_companion) as load:
            helper.plan_clip(first,cache); helper.plan_clip(second,cache)
            self.assertEqual(load.call_count,1)
            helper.plan_clip(first,{})
            self.assertEqual(load.call_count,2)
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
    def test_companion_transcript_history_is_ignored(self):
        # VC-154: the optional, separately versioned transcripts section must not change markers.
        self.data['version'] = 4
        self.data['transcripts'] = {'schema': 'virtual-cut-transcript-history', 'version': 1, 'items': [{'spans': [{'subtitleText': 'Hello'}]}]}
        self.save()
        item = Item(self.file, self.old)
        self.assertEqual([c['frame'] for c in helper.plan_clip(item)['changes']], [33, 74])
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

    def test_range_duration_idempotence_and_conflict(self):
        self.data['version'] = 4
        self.data['markers'][0].update(end=8, containerEnd=2.554444, duration=2)
        self.save()
        item = Item(self.file, self.old)
        plan = helper.plan_clip(item)
        self.assertFalse(plan['conflicts'])
        helper.apply_clip(plan)
        self.assertEqual(item.markers[33]['duration'], 120)
        self.assertEqual(helper.plan_clip(item)['changes'], [])
        item.markers[33]['duration'] = 119
        self.assertTrue(helper.plan_clip(item)['conflicts'])
        del self.data['verified']['constantFrameDuration']; self.save()
        self.assertTrue(helper.plan_clip(Item(self.file, self.old))['conflicts'])
        self.data['markers'][0]['containerEnd'] = -1; self.save()
        with self.assertRaisesRegex(ValueError, 'end timing'): helper.plan_clip(Item(self.file, self.old))

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

    def write_srt(self, text):
        pathlib.Path(self.file[:-4] + '.srt').write_text(text, encoding='utf-8')
    def test_transcript_from_srt_only_when_the_clip_has_none(self):
        # Decision 0023: the plain .srt beside the video, placed from the clip's start in Resolve.
        self.write_srt('1\n00:00:00,500 --> 00:00:01,250\nHello there\n\n2\n00:00:02,000 --> 00:00:03,000\nLapis\nrooted\n\n3\n00:00:09,000 --> 00:00:09,500\nPast the clip\n')
        item = TranscribedItem(self.file, self.old)
        plan = helper.plan_clip(item)
        self.assertEqual(plan['transcript']['line'], 'Transcript: set from clip.srt (2 lines).')
        segments = plan['transcript']['segments']
        self.assertEqual([(s['start'], s['end'], s['text']) for s in segments],
                         [('00:00:00:30', '00:00:01:15', 'Hello there'), ('00:00:02:00', '00:00:03:00', 'Lapis rooted')])
        self.assertEqual(segments[0]['words'], [{'text': 'Hello '}, {'text': 'there '}])
        self.assertEqual(segments[1]['words'], [{'text': 'Lapis '}, {'text': 'rooted'}])  # Resolve spreads them.
        self.assertTrue(helper.apply_transcript(plan))
        self.assertEqual(item.transcript['segments'], segments)
        # The next check keeps it, and Apply never sets it twice.
        again = helper.plan_clip(item)
        self.assertEqual(again['transcript']['action'], 'keep')
        self.assertFalse(helper.apply_transcript(again))
        self.assertEqual(item.sets, 1)
        self.assertEqual(helper.apply_summary(2, ['clip.mp4'], []),
                         '2 marker changes applied and 1 transcripts set (clip.mp4); project saved. Check again to verify; repeated apply adds no duplicates.')
        self.assertEqual(helper.check_summary(10, 2, 2, .1, 0, 0, [plan, again], 1.5),
                         '10 items scanned, 2 companion locations checked, 2 matching clips in 0.10s. 0 marker changes, 0 conflicts/errors. 1 transcripts to set, 1 kept, 0 with none. Total with file verification: 1.50s.')
    def test_existing_transcript_is_never_replaced(self):
        self.write_srt('1\n00:00:00,500 --> 00:00:01,250\nHello\n')
        mine = {'language': 'en', 'segments': [{'start': '00:00:00:00', 'end': '00:00:01:00', 'text': 'Mine', 'words': [{'text': 'Mine'}]}]}
        item = TranscribedItem(self.file, self.old, transcript=mine)
        plan = helper.plan_clip(item)
        self.assertEqual(plan['transcript']['line'], 'Transcript: kept. This clip already has one in Resolve.')
        self.assertFalse(helper.apply_transcript(plan))
        # One that appears between Check and Apply is kept too, and the clip is named.
        fresh = TranscribedItem(self.file, self.old)
        plan = helper.plan_clip(fresh)
        fresh.transcript = mine
        with self.assertRaisesRegex(ValueError, 'appeared in Resolve after the check'):
            helper.apply_transcript(plan)
        self.assertEqual(fresh.transcript, mine)
        self.assertEqual(fresh.sets, 0)
        # A source changed after the check is not written either.
        fresh.transcript = None
        self.write_srt('1\n00:00:00,500 --> 00:00:01,250\nChanged\n')
        with self.assertRaisesRegex(ValueError, 'changed after the check'):
            helper.apply_transcript(plan)
        self.assertEqual(fresh.sets, 0)
    def test_companion_word_timing_game_only_from_timecode(self):
        self.data['version'] = 4
        word = lambda text, start, end: {'text': ' ' + text, 'correctedText': ' ' + text, 'clipStart': start, 'clipEnd': end}
        self.data['transcripts'] = {'schema': 'virtual-cut-transcript-history', 'version': 1, 'items': [
            {'transcript': {'role': 'mic'}, 'spans': [{'clipStart': 0, 'clipEnd': 1, 'subtitleText': 'Clip start', 'timingPrecision': 'word', 'words': []}]},
            {'transcript': {'role': 'game'}, 'spans': [
                {'clipStart': 1, 'clipEnd': 2, 'subtitleText': ' Where is Kai', 'timingPrecision': 'word',
                 'words': [word('Where', 1, 1.2), word('is', 1.2, 1.4), dict(word('Kai', 1.4, 2), correctedText=' Cai')]},
                {'clipStart': 2.5, 'clipEnd': 3, 'subtitleText': 'Fixed phrase', 'timingPrecision': 'phrase', 'words': []}]}]}
        self.save()
        item = TranscribedItem(self.file, self.old, start='01:00:00:00', fps='30')
        plan = helper.plan_clip(item)
        self.assertEqual(plan['transcript']['line'], 'Transcript: set from the companion (2 lines, word timing).')
        first, second = plan['transcript']['segments']
        self.assertEqual((first['start'], first['end'], first['text']), ('01:00:01:00', '01:00:02:00', 'Where is Cai'))
        self.assertEqual(first['words'][2], {'text': 'Cai ', 'start': '01:00:01:12', 'end': '01:00:02:00'})
        self.assertEqual(second['words'], [{'text': 'Fixed '}, {'text': 'phrase'}])
        self.assertNotIn('Clip start', str(plan['transcript']['segments']))  # Microphone notes never go in.
    def test_transcript_none_reasons(self):
        older = Item(self.file, self.old)  # Resolve before 21.1.2: markers only.
        self.assertEqual(helper.plan_clip(older)['transcript']['line'], 'Transcript: none. ' + helper.NEEDS_RESOLVE)
        self.assertFalse(helper.apply_transcript(helper.plan_clip(older)))
        item = TranscribedItem(self.file, self.old)
        self.assertEqual(helper.plan_clip(item)['transcript']['line'],
                         'Transcript: none. No game dialogue .srt or transcript history beside this video.')
        self.write_srt('')  # VC-236: an empty .srt says the clip has no dialogue.
        self.assertEqual(helper.plan_clip(item)['transcript']['line'],
                         'Transcript: none. The game dialogue .srt is empty: no dialogue in this clip.')
        self.write_srt('1\n00:00:01,000 --> 00:00:02,000\nHello\n')
        fractional = TranscribedItem(self.file, self.old, fps='59.94')
        self.assertRegex(helper.plan_clip(fractional)['transcript']['line'], 'whole-number frame rate')
        drop = TranscribedItem(self.file, self.old, start='00:59:58;02', fps='30')
        self.assertRegex(helper.plan_clip(drop)['transcript']['line'], 'cannot place')
    def test_clip_color_set_only_when_resolve_has_none(self):
        # VC-207: the optional clipColor section; markers are unaffected by it.
        item = ColoredItem(self.file, self.old)
        self.assertEqual(helper.plan_clip(item)['color'], {'action': 'none', 'line': None})
        self.data['version'] = 4
        self.data['clipColor'] = {'schema': 'virtual-cut-clip-color', 'version': 1, 'name': 'Orange'}
        self.save()
        plan = helper.plan_clip(item)
        self.assertEqual([c['frame'] for c in plan['changes']], [33, 74])
        self.assertEqual(plan['color'], {'action': 'set', 'name': 'Orange', 'line': 'Clip color: set to Orange.'})
        self.assertEqual(helper.check_summary(1, 1, 1, .1, 2, 0, [plan], .2),
                         '1 items scanned, 1 companion locations checked, 1 matching clips in 0.10s. 2 marker changes, 0 conflicts/errors. 0 transcripts to set, 0 kept, 1 with none. 1 clip colors to set. Total with file verification: 0.20s.')
        self.assertTrue(helper.apply_color(plan))
        self.assertEqual(item.color, 'Orange')
        again = helper.plan_clip(item)
        self.assertEqual(again['color']['line'], 'Clip color: already Orange.')
        self.assertFalse(helper.apply_color(again))
        self.assertEqual(item.sets, 1)
        self.assertEqual(helper.apply_summary(2, [], [], ['clip.mp4: Orange']),
                         '2 marker changes applied and no transcripts set, 1 clip colors set (clip.mp4: Orange); project saved. Check again to verify; repeated apply adds no duplicates.')
        # A color chosen in Resolve is never replaced, at check or at apply.
        mine = ColoredItem(self.file, self.old, color='Navy')
        kept = helper.plan_clip(mine)
        self.assertEqual(kept['color']['line'], 'Clip color: kept Navy set in Resolve (Virtual Cut has Orange).')
        self.assertFalse(helper.apply_color(kept))
        late = ColoredItem(self.file, self.old)
        late_plan = helper.plan_clip(late)
        late.color = 'Teal'
        with self.assertRaisesRegex(ValueError, 'appeared in Resolve after the check'):
            helper.apply_color(late_plan)
        self.assertEqual(late.color, 'Teal')
        refused = ColoredItem(self.file, self.old, keeps=False)
        with self.assertRaisesRegex(RuntimeError, 'did not keep the clip color Orange'):
            helper.apply_color(helper.plan_clip(refused))
        # Older Resolve without the calls, and a marker color name in the clip color section.
        self.assertEqual(helper.plan_clip(Item(self.file, self.old))['color']['line'],
                         'Clip color: none. This Resolve cannot set clip colors from scripts.')
        self.data['clipColor']['name'] = 'Cyan'
        self.save()
        self.assertRegex(helper.plan_clip(item)['color']['line'], "not one of Resolve's clip colors")
    def test_segments_stay_ascending_and_inside_the_clip(self):
        lines = [(2.0, 3.0, [('b', 2.5, 3.5)]), (1.0, 2.4, [('a', 1.0, 2.4)]), (3.9, 9.0, [('c', None, None)])]
        segments = helper.transcript_segments(lines, 10, '00:00:00:00', 4)
        self.assertEqual([(s['start'], s['end']) for s in segments], [('00:00:01:00', '00:00:02:04'), ('00:00:02:04', '00:00:03:00'), ('00:00:03:09', '00:00:04:00')])
        self.assertEqual(segments[1]['words'][0], {'text': 'b ', 'start': '00:00:02:05', 'end': '00:00:03:00'})
        self.assertEqual(segments[2]['words'], [{'text': 'c'}])

if __name__ == '__main__': unittest.main()
