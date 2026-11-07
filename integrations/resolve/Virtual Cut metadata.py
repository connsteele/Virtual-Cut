"""Explicit marker and transcript enrichment for already imported media. No imports or timeline edits.

Run from Resolve's Workspace > Scripts > Utility menu. Plan is read-only; Apply
checks the selected clips, file identity and marker snapshot again before writing.
Transcripts (decision 0023) are set only on clips that have none, never replaced.
"""
import copy
import hashlib
import json
import math
import os
import re
import time

COLORS = {'Blue', 'Cyan', 'Green', 'Yellow', 'Red', 'Pink', 'Purple', 'Fuchsia',
          'Rose', 'Lavender', 'Sky', 'Mint', 'Lemon', 'Sand', 'Cocoa', 'Cream'}
PREFIX = 'virtual-cut-marker:'
SRT_TIME = re.compile(r'(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s*-->\s*(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})')
NEEDS_RESOLVE = 'Setting transcripts needs DaVinci Resolve Studio 21.1.2 or later.'
EXPORT_EXTENSIONS = {'.mp4', '.mkv', '.mov', '.m4v', '.webm'}


def pool_items(media_pool):
    """Visit bins without changing Resolve's current bin or selection."""
    pending, seen_folders, seen_items = [media_pool.GetRootFolder()], set(), set()
    while pending:
        folder = pending.pop()
        identity = folder.GetUniqueId()
        if identity in seen_folders:
            continue
        seen_folders.add(identity)
        pending.extend(folder.GetSubFolderList() or [])
        for item in folder.GetClipList() or []:
            identity = item.GetMediaId()
            if identity not in seen_items:
                seen_items.add(identity)
                yield item


def discover_companions(items):
    """Metadata-only lookup: no video reads, filesystem recursion, or imports."""
    matches, checked, scanned = [], {}, 0
    for item in items:
        scanned += 1
        file = (item.GetClipProperty() or {}).get('File Path', '')
        if not file or os.path.splitext(file)[1].lower() not in EXPORT_EXTENSIONS:
            continue
        key = os.path.normcase(os.path.abspath(file))
        if key not in checked:
            checked[key] = os.path.isfile(file + '.vcut.json')
        if checked[key]:
            matches.append(item)
    return matches, scanned, len(checked)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()


def fields(marker, frame):
    return {'frame': float(frame), 'name': marker.get('name', ''),
            'note': marker.get('note', ''), 'color': marker.get('color', 'Blue'),
            'duration': marker.get('duration', 1)}


def ownership(marker):
    text = marker.get('customData', '')
    if not text.startswith(PREFIX):
        return None
    try:
        return json.loads(text[len(PREFIX):])
    except (ValueError, TypeError):
        return None


def load_companion(media_path):
    companion_path = media_path + '.vcut.json'
    if os.path.getsize(companion_path) > 16 * 1024 * 1024:
        raise ValueError('Companion metadata is too large.')
    with open(companion_path, encoding='utf-8') as handle:
        data = json.load(handle)
    if data.get('schema') != 'virtual-cut-export' or data.get('version') not in (1, 2, 3, 4):
        raise ValueError('Choose a Virtual Cut export companion.')
    if not re.fullmatch(r'[a-fA-F0-9-]{36}', data.get('exportId', '')):
        raise ValueError('Companion export identity is invalid.')
    verified = data.get('verified', {})
    if not re.fullmatch(r'[a-f0-9]{64}', verified.get('sha256', '')) or os.path.getsize(media_path) != verified.get('bytes'):
        raise ValueError('The selected video does not match the companion receipt.')
    hasher = hashlib.sha256()
    with open(media_path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            hasher.update(chunk)
    if hasher.hexdigest() != verified['sha256']:
        raise ValueError('The selected video has changed since export.')
    if not isinstance(data.get('markers'), list) or len(data['markers']) > 50000:
        raise ValueError('Invalid marker metadata.')
    return data


def plan_markers(data, fps, existing):
    """Pure reconciliation: marker identity is independent of clip display names."""
    if not math.isfinite(fps) or fps <= 0 or fps > 240:
        raise ValueError('Resolve did not report a usable frame rate.')
    changes, conflicts, reserved = [], [], {}
    export_id = data['exportId']
    duration = data['verified']['actual']['end'] - data['verified']['actual']['start']
    frame_duration = data['verified'].get('constantFrameDuration')
    # An average packet count is insufficient evidence of constant frame timing.
    # Older companions can still enrich the positions established by chapters.
    cfr = (isinstance(frame_duration, (int, float)) and math.isfinite(frame_duration)
           and frame_duration > 0 and abs(frame_duration * fps - 1) <= .001)
    ids = set()
    for marker in data['markers']:
        marker_id = marker.get('id')
        name, note = marker.get('name'), marker.get('note', '')
        color = marker.get('colorName', 'Blue')
        seconds = marker.get('containerTime', marker.get('clipTime'))
        if not isinstance(marker_id, str) or marker_id in ids or not isinstance(name, str) or not isinstance(note, str) or color not in COLORS or not isinstance(seconds, (float, int)) or not math.isfinite(seconds) or seconds < 0 or seconds >= duration + .002:
            raise ValueError('A companion marker has invalid identity, timing or text.')
        ids.add(marker_id)
        expected = math.floor(seconds * fps + 1e-7)
        marker_duration = 1
        if marker.get('end') is not None:
            end_seconds = marker.get('containerEnd')
            if data.get('version', 1) < 4 or not isinstance(end_seconds, (float, int)) or not math.isfinite(end_seconds) or end_seconds <= seconds or end_seconds > duration + data['verified'].get('videoStart', 0) + .002:
                raise ValueError('A range marker has invalid end timing.')
            if not cfr:
                conflicts.append(name + ': range duration needs verified constant frame timing.'); continue
            marker_duration = max(1, math.floor(end_seconds * fps + 1e-7) - expected)
        owned = [(frame, value) for frame, value in existing.items()
                 if ownership(value) and ownership(value).get('export') == export_id and ownership(value).get('marker') == marker_id]
        candidates = [(frame, value) for frame, value in existing.items()
                      if value.get('name') == name and abs(float(frame) - expected) <= 1]
        old = None
        frame = expected
        if len(owned) > 1:
            conflicts.append(name + ': multiple app markers have this identity.'); continue
        if owned:
            frame, old = owned[0]
            owner = ownership(old)
            if owner.get('signature') != digest(fields(old, frame)):
                conflicts.append(name + ': the Resolve marker was edited; preserving it.'); continue
            if abs(float(frame) - expected) > 1:
                conflicts.append(name + ': owned marker timing no longer matches.'); continue
        elif candidates:
            if len(candidates) != 1:
                conflicts.append(name + ': chapter matches are ambiguous.'); continue
            frame, old = candidates[0]
            if old.get('note') or old.get('color', 'Blue') != 'Blue' or old.get('customData') or old.get('duration', 1) != 1:
                conflicts.append(name + ': existing notes, color or ownership will be preserved.'); continue
        elif not cfr:
            conflicts.append(name + ': variable frame timing needs an existing matching chapter.'); continue
        if frame in reserved:
            conflicts.append(name + ': two companion markers occupy the same frame.'); continue
        reserved[frame] = marker_id
        if old is None and frame in existing:
            conflicts.append(name + ': another marker occupies the target frame.'); continue
        target = {'name': name, 'note': note, 'color': color, 'duration': marker_duration}
        target['customData'] = PREFIX + json.dumps({'export': export_id, 'marker': marker_id,
                                                  'signature': digest(fields(target, frame))}, sort_keys=True)
        if old and fields(old, frame) == fields(target, frame) and old.get('customData') == target['customData']:
            continue
        changes.append({'frame': frame, 'before': copy.deepcopy(old), 'after': target,
                        'action': 'Enrich chapter' if old else 'Add marker'})
    # Version 3 explicitly identifies the muxer's leading chapter. Never infer
    # ownership from a title alone, or delete a genuine/user-edited marker.
    generated = data.get('generatedChapters', []) if data.get('version', 1) >= 3 else []
    if generated == [{'name': 'Clip start', 'containerTime': 0, 'purpose': 'quicktime-leading-anchor'}] and data['markers'] and all(m.get('containerTime', m.get('clipTime', 0)) * fps >= 1 for m in data['markers']):
        anchor = existing.get(0)
        if anchor and fields(anchor, 0) == {'frame': 0.0, 'name': 'Clip start', 'note': '', 'color': 'Blue', 'duration': 1} and not anchor.get('customData'):
            changes.insert(0, {'frame': 0, 'before': copy.deepcopy(anchor), 'after': None, 'action': 'Remove generated Clip start'})
    # Never partially apply a same-frame conflict; callers block the entire clip.
    return changes, conflicts


def has_transcript(existing):
    if isinstance(existing, dict):
        return bool(existing.get('segments'))
    return bool(existing)


def history_lines(data):
    """Game dialogue from the companion's transcript history (VC-154): corrected words, word timing."""
    history = data.get('transcripts') if data.get('version', 1) >= 4 else None
    if not isinstance(history, dict) or history.get('schema') != 'virtual-cut-transcript-history' or history.get('version') != 1:
        return None
    for entry in history.get('items') or []:
        if not isinstance(entry, dict) or (entry.get('transcript') or {}).get('role') != 'game':
            continue
        lines = []
        for span in entry.get('spans') or []:
            start, end = span.get('clipStart'), span.get('clipEnd')
            if not all(isinstance(t, (int, float)) and math.isfinite(t) for t in (start, end)):
                raise ValueError('The companion transcript history has invalid timing.')
            words = []
            if span.get('timingPrecision') == 'word':
                for word in span.get('words') or []:
                    text = (word.get('correctedText', word.get('text')) or '').strip()
                    if text and all(isinstance(word.get(k), (int, float)) for k in ('clipStart', 'clipEnd')):
                        words.append((text, word['clipStart'], word['clipEnd']))
            if not words:
                words = [(text, None, None) for text in (span.get('subtitleText') or '').split()]
            if words:
                lines.append((start, end, words))
        return lines
    return None


def srt_lines(path):
    """Game dialogue from the plain .srt beside the video: whole lines, words spread by Resolve."""
    if os.path.getsize(path) > 16 * 1024 * 1024:
        raise ValueError('The .srt beside this video is too large.')
    with open(path, encoding='utf-8-sig') as handle:
        blocks = re.split(r'\n\s*\n', handle.read().replace('\r\n', '\n').strip())
    lines = []
    for block in blocks:
        rows = block.split('\n')
        timing = next((i for i, row in enumerate(rows) if SRT_TIME.search(row)), None)
        if timing is None:
            continue
        t = [int(v) for v in SRT_TIME.search(rows[timing]).groups()]
        start = t[0] * 3600 + t[1] * 60 + t[2] + t[3] / 1000
        end = t[4] * 3600 + t[5] * 60 + t[6] + t[7] / 1000
        words = ' '.join(rows[timing + 1:]).split()
        if words and end > start:
            lines.append((start, end, [(word, None, None) for word in words]))
    return lines


def timecode_frames(label, rate):
    match = re.fullmatch(r'(\d{2}):([0-5]\d):([0-5]\d):(\d{2,3})', label or '')
    if not match:
        raise ValueError('Resolve reported a start timecode this helper cannot place (' + str(label) + ').')
    hours, minutes, seconds, frames = (int(v) for v in match.groups())
    return ((hours * 60 + minutes) * 60 + seconds) * rate + frames


def timecode_label(frames, rate):
    seconds = frames // rate
    return '{:02d}:{:02d}:{:02d}:{:02d}'.format(seconds // 3600, seconds // 60 % 60, seconds % 60, frames % rate)


def transcript_segments(lines, fps, start_label, duration):
    """Clip-relative seconds to Resolve timecode from the clip's start, ascending and non-overlapping."""
    rate = round(fps) if math.isfinite(fps) else 0
    if fps <= 0 or fps > 240 or abs(fps - rate) > .001:
        raise ValueError('Transcripts need a whole-number frame rate; Resolve reported ' + str(fps) + '.')
    origin, last_frame = timecode_frames(start_label, rate), max(1, math.floor(duration * fps + 1e-7))

    def frame(seconds):
        return min(last_frame, max(0, math.floor(seconds * fps + 1e-7)))

    segments, previous = [], 0
    for start, end, words in sorted(lines, key=lambda line: line[0]):
        first = max(frame(start), previous)
        if first >= last_frame:
            continue
        last = min(max(first + 1, frame(end)), last_frame)
        entries, cursor = [], first
        for text, word_start, word_end in words:
            entry = {'text': text}
            if word_start is not None:
                a = min(max(frame(word_start), cursor), last - 1)
                b = min(max(a + 1, frame(word_end)), last)
                entry['start'], entry['end'] = timecode_label(origin + a, rate), timecode_label(origin + b, rate)
                cursor = b
            entries.append(entry)
        segments.append({'start': timecode_label(origin + first, rate), 'end': timecode_label(origin + last, rate),
                         'text': ' '.join(e['text'] for e in entries), 'words': entries})
        previous = last
    # Resolve builds its lines from the pauses (a second or more starts a new one), joining
    # nearer lines word to word, so every word but the last carries its space as Resolve's own do.
    words = [word for segment in segments for word in segment['words']]
    for word in words[:-1]:
        word['text'] += ' '
    return segments


def plan_transcript(item, data, media_path, properties):
    """What Apply does with this clip's transcript: set (only when it has none), keep, or none."""
    if not callable(getattr(item, 'GetTranscription', None)) or not callable(getattr(item, 'SetTranscription', None)):
        return {'action': 'none', 'line': 'Transcript: none. ' + NEEDS_RESOLVE}
    if has_transcript(item.GetTranscription()):
        return {'action': 'keep', 'line': 'Transcript: kept. This clip already has one in Resolve.'}
    srt = os.path.splitext(media_path)[0] + '.srt'
    lines, source = history_lines(data), 'the companion'
    if lines is None and os.path.isfile(srt):
        lines, source = srt_lines(srt), os.path.basename(srt)
    if lines == [] and source != 'the companion':
        # Virtual Cut writes an empty .srt when the clip has no game dialogue (VC-236).
        return {'action': 'none', 'line': 'Transcript: none. The game dialogue .srt is empty: no dialogue in this clip.'}
    if not lines:
        return {'action': 'none', 'line': 'Transcript: none. No game dialogue .srt or transcript history beside this video.'}
    duration = data['verified']['actual']['end'] - data['verified']['actual']['start']
    segments = transcript_segments(lines, float(properties.get('FPS', 0)), properties.get('Start TC'), duration)
    if not segments:
        return {'action': 'none', 'line': 'Transcript: none. No game dialogue inside this clip.'}
    timed = any('start' in word for segment in segments for word in segment['words'])
    return {'action': 'set', 'segments': segments,
            'line': 'Transcript: set from {} ({} lines{}).'.format(source, len(segments), ', word timing' if timed else '')}


def apply_transcript(plan):
    """Sets the planned transcript if the clip still has none. Returns True when it was set."""
    transcript = plan.get('transcript') or {}
    if transcript.get('action') != 'set':
        return False
    item = plan['item']
    properties = item.GetClipProperty() or {}
    if item.GetMediaId() != plan['mediaId'] or properties.get('File Path') != plan['path']:
        raise ValueError(plan['name'] + ': the clip changed after the check. Check again.')
    if has_transcript(item.GetTranscription()):
        raise ValueError(plan['name'] + ': a transcript appeared in Resolve after the check; kept it.')
    if plan_transcript(item, plan['data'], plan['path'], properties).get('segments') != transcript['segments']:
        raise ValueError(plan['name'] + ': its transcript source or timing changed after the check. Check again.')
    if not item.SetTranscription({'segments': copy.deepcopy(transcript['segments'])}):
        raise RuntimeError(plan['name'] + ': Resolve refused the transcript.')
    if not has_transcript(item.GetTranscription()):
        raise RuntimeError(plan['name'] + ': Resolve did not keep the transcript.')
    return True


def plan_clip(item, verified=None):
    properties = item.GetClipProperty()
    media_path = properties.get('File Path')
    if not media_path or not os.path.isfile(media_path):
        raise ValueError('Select an online media-pool video with its adjacent .vcut.json file.')
    key = os.path.normcase(os.path.abspath(media_path))
    if verified is None:
        data = load_companion(media_path)
    else:
        if key not in verified:
            verified[key] = load_companion(media_path)
        data = verified[key]
    fps = float(properties.get('FPS', 0))
    snapshot = copy.deepcopy(item.GetMarkers() or {})
    changes, conflicts = plan_markers(data, fps, snapshot)
    try:
        transcript = plan_transcript(item, data, media_path, properties)
    except (ValueError, OSError, UnicodeDecodeError) as error:
        transcript = {'action': 'none', 'line': 'Transcript: none. ' + str(error)}
    return {'item': item, 'mediaId': item.GetMediaId(), 'name': item.GetName(), 'path': media_path,
            'data': data, 'fps': fps, 'snapshot': snapshot, 'changes': changes, 'conflicts': conflicts,
            'companionHash': digest(data), 'transcript': transcript}


def add(item, frame, marker):
    return item.AddMarker(frame, marker.get('color', 'Blue'), marker.get('name', ''),
                          marker.get('note', ''), marker.get('duration', 1), marker.get('customData', ''))


def apply_clip(plan):
    item = plan['item']
    if plan['conflicts']:
        raise ValueError('Resolve conflicts must be reviewed before applying this clip.')
    if item.GetMediaId() != plan['mediaId'] or item.GetClipProperty().get('File Path') != plan['path']:
        raise ValueError('The selected media changed. Check the plan again.')
    if digest(load_companion(plan['path'])) != plan['companionHash'] or item.GetMarkers() != plan['snapshot']:
        raise ValueError('Metadata or markers changed after planning. Check the plan again.')
    touched = []
    try:
        for change in plan['changes']:
            frame = change['frame']
            # Track before deletion too, so a failed AddMarker can restore it.
            touched.append(change)
            if change['before'] is not None and not item.DeleteMarkerAtFrame(frame):
                raise RuntimeError('Resolve refused to replace a matching chapter.')
            if change['after'] is None:
                if frame in (item.GetMarkers() or {}):
                    raise RuntimeError('Resolve refused to remove the generated chapter.')
                continue
            if not add(item, frame, change['after']):
                raise RuntimeError('Resolve refused a marker update.')
            actual = (item.GetMarkers() or {}).get(frame)
            if not actual or fields(actual, frame) != fields(change['after'], frame) or actual.get('customData') != change['after']['customData']:
                raise RuntimeError('Resolve did not retain the intended marker fields.')
        return len(plan['changes'])
    except Exception as error:
        failures = []
        for change in reversed(touched):
            frame = change['frame']
            actual = (item.GetMarkers() or {}).get(frame)
            if actual is not None and actual != change['before'] and not item.DeleteMarkerAtFrame(frame):
                failures.append(str(frame)); continue
            if change['before'] is not None and (item.GetMarkers() or {}).get(frame) != change['before'] and not add(item, frame, change['before']):
                failures.append(str(frame))
        if item.GetMarkers() != plan['snapshot']:
            failures.append('snapshot differs')
        if failures:
            raise RuntimeError(str(error) + ' Recovery needs manual review: ' + ', '.join(failures)) from error
        raise RuntimeError(str(error) + ' Original markers restored.') from error


def check_summary(scanned, checked, matching, seconds, changes, errors, plans, total):
    actions = [plan['transcript']['action'] for plan in plans]
    return ('{} items scanned, {} companion locations checked, {} matching clips in {:.2f}s. {} marker changes, {} conflicts/errors. '
            '{} transcripts to set, {} kept, {} with none. Total with file verification: {:.2f}s.').format(
        scanned, checked, matching, seconds, changes, errors, actions.count('set'), actions.count('keep'), actions.count('none'), total)


def apply_summary(markers, transcripts, problems):
    done = ' and {} transcripts set ({})'.format(len(transcripts), ', '.join(transcripts)) if transcripts else ' and no transcripts set'
    return (str(markers) + ' marker changes applied' + done + '; project saved.'
            + (' Not set: ' + ' '.join(problems) if problems else '')
            + ' Check again to verify; repeated apply adds no duplicates.')


def show_window(resolve, bmd):
    fusion = resolve.Fusion()
    ui = fusion.UIManager
    dispatcher = bmd.UIDispatcher(ui)
    window = dispatcher.AddWindow({'ID': 'VirtualCutMetadata', 'WindowTitle': 'Virtual Cut metadata', 'Geometry': [220, 180, 900, 680]}, ui.VGroup([
        ui.Label({'Text': 'Check the whole Media Pool to find supported video exports in every bin with an adjacent .vcut.json. No selection needed. Matching videos are fully verified; large exports can take time.', 'WordWrap': True, 'Weight': 0, 'MinimumSize': [0, 40]}),
        ui.Label({'Text': 'Marker names, notes, colors and range durations are applied. Clips with no transcript get the game dialogue transcript from the export; existing transcripts are never replaced. Clip notes and recording context stay in the companion; bins, files and timelines are untouched.', 'WordWrap': True, 'Weight': 0, 'MinimumSize': [0, 58]}),
        ui.TextEdit({'ID': 'Plan', 'ReadOnly': True, 'PlainText': 'No plan checked yet.'}),
        ui.Label({'ID': 'Status', 'Text': 'Plan first, then apply.', 'WordWrap': True, 'Weight': 0, 'MinimumSize': [0, 58]}),
        ui.HGroup({'Weight': 0}, [ui.Button({'ID': 'Check', 'Text': 'Check whole Media Pool'}), ui.Button({'ID': 'Selected', 'Text': 'Check selected clips'}), ui.Button({'ID': 'Apply', 'Text': 'Apply markers and transcripts', 'Enabled': False}), ui.Button({'ID': 'Close', 'Text': 'Close'})]),
    ]))
    items = window.GetItems()
    state = {'plans': [], 'project': None}

    def check(_event, selected_only=False):
        started = time.perf_counter()
        state['plans'] = []
        items['Apply'].Enabled = False
        current = resolve.GetProjectManager().GetCurrentProject()
        state['project'] = current.GetUniqueId() if current else None
        if not current:
            items['Status'].Text = 'Open a Resolve project first.'; return
        try:
            pool = current.GetMediaPool()
            selected, scanned, checked = discover_companions((pool.GetSelectedClips() or []) if selected_only else pool_items(pool))
        except Exception as error:
            items['Status'].Text = 'Media Pool scan failed: ' + str(error); return
        discovery_seconds = time.perf_counter() - started
        verified = {}
        lines, errors = [], []
        for item in selected:
            try:
                plan = plan_clip(item, verified)
                state['plans'].append(plan)
                lines.append(item.GetName() + '\n' + plan['path'])
                for change in plan['changes']:
                    target = change['after']
                    if target is None:
                        lines.append('  ' + change['action'] + ' at frame ' + str(change['frame'])); continue
                    lines.append('  ' + change['action'] + ' at frame ' + str(change['frame']) + ': ' + target['name'] + ' (' + str(target['duration']) + ' frames) [' + target['color'] + ']\n    ' + target['note'].replace('\n', '\n    '))
                for conflict in plan['conflicts']:
                    errors.append(conflict); lines.append('  CONFLICT: ' + conflict)
                if not plan['changes'] and not plan['conflicts']:
                    lines.append('  Already up to date; no changes.')
                lines.append('  ' + plan['transcript']['line'])
                lines.append('')
            except Exception as error:
                errors.append(str(error)); lines.append(item.GetName() + ': ' + str(error))
        items['Plan'].PlainText = '\n'.join(lines) or 'No matching video companions found beside imported videos.'
        count = sum(len(plan['changes']) for plan in state['plans'])
        items['Status'].Text = check_summary(scanned, checked, len(selected), discovery_seconds, count, len(errors), state['plans'], time.perf_counter() - started)
        items['Apply'].Enabled = bool((count or any(plan['transcript']['action'] == 'set' for plan in state['plans'])) and not errors)

    def apply(_event):
        items['Apply'].Enabled = False
        current = resolve.GetProjectManager().GetCurrentProject()
        if not current or current.GetUniqueId() != state['project']:
            items['Status'].Text = 'The project changed. Check the plan again.'; return
        count, transcripts, problems = 0, [], []
        try:
            present = {item.GetMediaId(): item for item in pool_items(current.GetMediaPool())}
            for plan in state['plans']:
                if plan['mediaId'] not in present:
                    raise ValueError('A planned clip left the Media Pool. Check the plan again.')
                plan['item'] = present[plan['mediaId']]
            for plan in state['plans']:
                if plan['changes']:
                    count += apply_clip(plan)
                # A transcript problem is reported for its clip and never undoes markers.
                try:
                    if apply_transcript(plan):
                        transcripts.append(plan['name'])
                except Exception as error:
                    problems.append(str(error))
            if not resolve.GetProjectManager().SaveProject():
                raise RuntimeError('Changes applied, but Resolve could not save the project. Save it manually.')
            items['Status'].Text = apply_summary(count, transcripts, problems)
        except Exception as error:
            items['Status'].Text = '{} marker changes and {} transcripts completed before this error: {}'.format(count, len(transcripts), error)

    window.On.Check.Clicked = check
    window.On.Selected.Clicked = lambda event: check(event, True)
    window.On.Apply.Clicked = apply
    window.On.Close.Clicked = lambda _event: dispatcher.ExitLoop()
    window.On.VirtualCutMetadata.Close = lambda _event: dispatcher.ExitLoop()
    window.Show()
    dispatcher.RunLoop()
    window.Hide()


if __name__ == '__main__':
    import DaVinciResolveScript as bmd
    show_window(bmd.scriptapp('Resolve'), bmd)
