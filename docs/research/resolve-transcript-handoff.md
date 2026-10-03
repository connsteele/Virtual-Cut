# Reusing Virtual Cut transcripts in Resolve

October 3, 2026. Documentation/API research only; no user Resolve project was opened
or changed. Connor's latest review reports usable subtitle timing after manual timeline
alignment, and requests native searchable clip transcripts without retranscribing.

## Native transcript import exists

The installed Resolve 21.1 reference manual, PDF page 1009, documents importing SRT
through **Transcription window > Options > Import Subtitles**. Use the intended clip's
transcription context, import the matching file, then open its native transcription.
This is a different route from dragging SRT into a timeline's subtitle track.

Blackmagic's [Resolve 19 feature guide, page 25](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_19_New_Features_Guide.pdf)
also documents **Media Pool > Audio Transcription > Import from Subtitles**, followed
by opening the clip's transcription. It expressly requires matching clip/SRT timecode.
The current installed manual uses the window's Options menu; validate the actual menu
in Connor's installed version rather than relying solely on the older recipe.

This supports the requested native transcript reuse without another recognition run.
It does not establish exact imported word anchors, speaker preservation or batch UI
behavior. SRT contains timed phrases, not the original per-word timing/confidence and
correction provenance retained in Virtual Cut.

## Automatic batch attachment is not exposed by the inspected API

The installed Studio 21.1.1 `DaVinciResolveScript.pyi` and the native API lookup expose:

- `MediaPoolItem.TranscribeAudio(...)`: generate recognition.
- `MediaPoolItem.GetTranscription(...)`: read existing transcription.
- `MediaPoolItem.ClearTranscription(...)`: clear it.
- Folder transcription/clear and timeline subtitle generation.

No public import/set-transcription method appeared in the inspected API. This is a
capability finding for this version, not proof that Blackmagic will never expose one.
Generating recognition again would defeat the request; writing private project data
would be brittle and is not recommended. Embedding transcript JSON in `.vcut.json`
does not itself populate Resolve's native transcription store.

## Proposed implementation

| Step           | Delivery                                                                                                                  | Boundary                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| M3 VC-94       | Explicit transcript option in video export and Review filing; video-named SRT; richer versioned companion transcript data | Produces files; does not claim native Resolve attachment                        |
| Existing VC-40 | Validate native SRT import, clip matching and reimport protection; helper can discover and report matching files          | Later native/batch integration; automatic import remains constrained by the API |
| Early M4 VC-24 | Export explicitly reviewed terminology corrections alongside original recognition provenance                              | No silent rewriting or new recognition required                                 |

Reuse `electron/transcript-export.ts` for verified clip-relative timing. The current
standalone exporter clamps intersecting phrases/words to the selected actual range,
retains originals/corrections in JSON, and shifts SRT to clip start. The new video
option must derive its scope from the verified outward cut, not requested in/out.
Original-container timestamp offsets and a Resolve clip's start timecode must not be
conflated with elapsed clip time.

Game dialogue and microphone notes should have distinct roles/files. A finished clip
usually contains only game audio; do not silently attach Mic recognition as its dialogue.
The portable companion can retain richer word timing, identities, language, revisions,
corrections and provenance for Virtual Cut/later tools. Resolve's SRT importer still
uses the exported phrases. Published videos, SRTs and companions must remain protected
from project cleanup and unrelated-file overwrite.

## Focused next review

1. Use a disposable completed clip with known phrases, a nonzero requested start and
   an outward keyframe cut. Export its completed-clip SRT; note actual start/timecode.
2. Select that clip in Resolve and use the native transcription importer. Check the
   first/later phrases, gaps and crossing-boundary speech; search and seek the text.
3. Test a nonzero clip start timecode and an existing transcript/reimport case. Establish
   whether an import-specific offset is needed; do not assume all containers start at zero.
4. Judge word-selection usefulness from imported phrase timing and record limitations.
   Do not promise that SRT transfers our exact word anchors or speaker data.

M324 in the review guide covers this native-import path separately from M323's existing
standalone export naming/scope check. Connor's successful subtitle observation remains
valid evidence; native transcription import has not yet been tested in this turn.

## Primary evidence

- Installed manual: `C:\Program Files\Blackmagic Design\DaVinci Resolve\Documents\DaVinci Resolve.pdf`,
  PDF page 1009, Import and Export Transcriptions using SRT Files.
- Installed API: `C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\DaVinciResolveScript.pyi`,
  MediaPoolItem transcription methods. Read-only native API lookup confirmed these names.
- [Blackmagic Resolve 19 feature guide](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_19_New_Features_Guide.pdf),
  page 25; [Blackmagic support/manuals](https://www.blackmagicdesign.com/support).
