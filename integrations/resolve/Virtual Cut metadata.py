"""Explicit marker enrichment for already imported media. No imports or timeline edits.

Run from Resolve's Workspace > Scripts > Utility menu. Plan is read-only; Apply
checks the selected clips, file identity and marker snapshot again before writing.
"""
import copy
import hashlib
import json
import math
import os
import re

COLORS = {'Blue', 'Cyan', 'Green', 'Yellow', 'Red', 'Pink', 'Purple', 'Fuchsia',
          'Rose', 'Lavender', 'Sky', 'Mint', 'Lemon', 'Sand', 'Cocoa', 'Cream'}
PREFIX = 'virtual-cut-marker:'


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
    if data.get('schema') != 'virtual-cut-export' or data.get('version') not in (1, 2):
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
        target = {'name': name, 'note': note, 'color': color, 'duration': 1}
        target['customData'] = PREFIX + json.dumps({'export': export_id, 'marker': marker_id,
                                                  'signature': digest(fields(target, frame))}, sort_keys=True)
        if old and fields(old, frame) == fields(target, frame) and old.get('customData') == target['customData']:
            continue
        changes.append({'frame': frame, 'before': copy.deepcopy(old), 'after': target,
                        'action': 'Enrich chapter' if old else 'Add marker'})
    # Never partially apply a same-frame conflict; callers block the entire clip.
    return changes, conflicts


def plan_clip(item):
    properties = item.GetClipProperty()
    media_path = properties.get('File Path')
    if not media_path or not os.path.isfile(media_path):
        raise ValueError('Select an online media-pool video with its adjacent .vcut.json file.')
    data = load_companion(media_path)
    fps = float(properties.get('FPS', 0))
    snapshot = copy.deepcopy(item.GetMarkers() or {})
    changes, conflicts = plan_markers(data, fps, snapshot)
    return {'item': item, 'mediaId': item.GetMediaId(), 'name': item.GetName(), 'path': media_path,
            'data': data, 'fps': fps, 'snapshot': snapshot, 'changes': changes, 'conflicts': conflicts,
            'companionHash': digest(data)}


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


def show_window(resolve, bmd):
    fusion = resolve.Fusion()
    ui = fusion.UIManager
    dispatcher = bmd.UIDispatcher(ui)
    window = dispatcher.AddWindow({'ID': 'VirtualCutMetadata', 'WindowTitle': 'Virtual Cut metadata', 'Geometry': [220, 180, 850, 600]}, ui.VGroup([
        ui.Label({'Text': 'Select imported videos in the Media Pool, then check the plan. Companions must sit beside their videos.', 'WordWrap': True, 'Weight': 0}),
        ui.Label({'Text': 'Only marker names, notes and colors are applied. Clip notes and recording context stay in the companion; bins, files and timelines are untouched.', 'WordWrap': True, 'Weight': 0}),
        ui.TextEdit({'ID': 'Plan', 'ReadOnly': True, 'PlainText': 'No plan checked yet.'}),
        ui.Label({'ID': 'Status', 'Text': 'Plan first, then apply.', 'WordWrap': True, 'Weight': 0}),
        ui.HGroup({'Weight': 0}, [ui.Button({'ID': 'Check', 'Text': 'Check selected clips'}), ui.Button({'ID': 'Apply', 'Text': 'Apply marker metadata', 'Enabled': False}), ui.Button({'ID': 'Close', 'Text': 'Close'})]),
    ]))
    items = window.GetItems()
    state = {'plans': [], 'project': None, 'selection': []}

    def check(_event):
        state['plans'] = []
        items['Apply'].Enabled = False
        current = resolve.GetProjectManager().GetCurrentProject()
        selected = current.GetMediaPool().GetSelectedClips() if current else []
        selected = selected or []
        state['project'] = current.GetUniqueId() if current else None
        state['selection'] = [item.GetMediaId() for item in selected]
        lines, errors = [], []
        for item in selected:
            try:
                plan = plan_clip(item)
                state['plans'].append(plan)
                lines.append(item.GetName() + '\n' + plan['path'])
                for change in plan['changes']:
                    target = change['after']
                    lines.append('  ' + change['action'] + ' at frame ' + str(change['frame']) + ': ' + target['name'] + ' [' + target['color'] + ']\n    ' + target['note'].replace('\n', '\n    '))
                for conflict in plan['conflicts']:
                    errors.append(conflict); lines.append('  CONFLICT: ' + conflict)
                if not plan['changes'] and not plan['conflicts']:
                    lines.append('  Already up to date; no changes.')
                lines.append('')
            except Exception as error:
                errors.append(str(error)); lines.append(item.GetName() + ': ' + str(error))
        items['Plan'].PlainText = '\n'.join(lines) or 'Select one or more imported videos in the Media Pool.'
        count = sum(len(plan['changes']) for plan in state['plans'])
        items['Status'].Text = str(count) + ' marker changes. ' + str(len(errors)) + ' conflicts/errors.'
        items['Apply'].Enabled = bool(count and not errors)

    def apply(_event):
        items['Apply'].Enabled = False
        current = resolve.GetProjectManager().GetCurrentProject()
        selected = current.GetMediaPool().GetSelectedClips() if current else []
        if not current or current.GetUniqueId() != state['project'] or [item.GetMediaId() for item in (selected or [])] != state['selection']:
            items['Status'].Text = 'The project or selection changed. Check the plan again.'; return
        count = 0
        try:
            for plan in state['plans']:
                count += apply_clip(plan)
            if not resolve.GetProjectManager().SaveProject():
                raise RuntimeError('Markers applied, but Resolve could not save the project. Save it manually.')
            items['Status'].Text = str(count) + ' marker changes applied and project saved. Check again to verify; repeated apply adds no duplicates.'
        except Exception as error:
            items['Status'].Text = str(count) + ' changes completed before this error: ' + str(error)

    window.On.Check.Clicked = check
    window.On.Apply.Clicked = apply
    window.On.Close.Clicked = lambda _event: dispatcher.ExitLoop()
    window.On.VirtualCutMetadata.Close = lambda _event: dispatcher.ExitLoop()
    window.Show()
    dispatcher.RunLoop()
    window.Hide()


if __name__ == '__main__':
    import DaVinciResolveScript as bmd
    show_window(bmd.scriptapp('Resolve'), bmd)
