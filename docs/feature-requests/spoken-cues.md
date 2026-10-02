# Microphone cues: Mark, Cut, Note

Recorded September 28, 2026. Requested product direction, with proposed behavior for the first implementation.

**October 2 implementation update:** The 0.4.0 review includes microphone-only, reviewed Mark/Note/Cut candidates, original recognition, manual corrections, continuation across pauses, timed local notes and reversible marker/split actions. See [M3 implementation](../m3-implementation.md) and [M3 review](../m3-review.md). Automatic semantic context interpretation, relative visual cut targeting, agent rewriting and Notion publication remain future work. The requirements below retain the broader requested direction; they are not a claim that every acceptance item has shipped.

## Connor's requested meanings

| Cue | Meaning |
| --- | --- |
| **Mark** | The following spoken thought becomes a point marker. |
| **Cut** | The recording should be split at this point. |
| **Note** | The following spoken thought becomes a note associated with the clip and timecode, with Notion as a likely destination. |
| **No cue** | Freeform microphone speech gives recording context: why this footage is being captured, what it demonstrates, and how it may be used. Make this available for naming and organization suggestions. |

For Mark, Note, and uncued recording context, retain the original recognized transcript. Offer independent, optional agent actions to correct it using context and to abbreviate or restructure the thought for easier searching. Neither operation replaces the original record.

These cues come from the designated microphone-note track. They supplement existing OBS point markers; they do not change the rule that imported chapters are points rather than automatic cut instructions.

### Uncued recording context — confirmed September 29, 2026

Connor generally speaks without a cue to explain why he is recording. Treat uncued microphone thoughts as recording context by default, rather than dropping them or requiring a fourth spoken keyword. A recording-context record is distinct from an explicit Mark, Cut, or Note.

- Keep the original speech span and source timestamp even when the thought describes the overall recording. Its timestamp locates the evidence; it does not automatically create a point marker or cut boundary.
- Use context as evidence for suggested clip names, descriptions, tags, destinations, and capture intent. Retain the wording behind a suggestion and keep uncertain or tentative observations tentative.
- A following explanation already attached to Mark or Note belongs to that item. A pause inside a thought does not automatically turn its continuation into recording context. Ambiguous boundaries remain reviewable.
- Preserve source context when creating subclips, with relevant source/clip links. Do not assume every thought applies equally to every range, especially when the user changes what they are recording. Explicit clip intent and human edits take precedence over inferred scope.
- Uncued context is locally searchable. It does not automatically become a Notion note; deliberate Note cues and configured publication remain the route for that handoff.

## Proposed first-version behavior

### Timing and split intent

- Anchor each cue to the estimated source-media time at the beginning of the spoken command word. Keep the command's time separate from the following explanation's spoken span. Word alignment is an estimate to validate on recordings, not a frame-accuracy claim.
- Allow the user to adjust an anchor while retaining its originally detected time. Do not silently guess that an observation referred to footage several seconds earlier. If a consistent lead-in offset proves useful, make it an explicit later setting.
- Mark creates a point even if the following explanation lasts a long time. The explanation's duration does not create a footage range.
- Cut creates a split boundary in the editable cut plan. It does not itself choose what to discard, export files, stop OBS, or delete source material. The existing export and review workflow applies.
- Preserve the requested split time separately from verified export boundaries. With outward keyframe cuts enabled, the preceding range may end after the requested split and the following range may start before it. Show the resulting overlap; do not promise adjacent lossless clips will meet at one exact frame.
- A Cut can include a target description, such as "in the black area between clips" or "before this transition." Preserve that wording separately from the spoken cue time. Resolving the described visual boundary is a reviewable operation; do not automatically export at the command timestamp when its wording specifies another point.
- Note associates a thought with its source and anchor. Its speech span is provenance, not an automatically inferred range of relevant footage. Allow explicit links to other markers or ranges later.

### Recognizing commands and delimiting thoughts

- Run detection after explicitly requested local microphone transcription. This requires no continuous listener and does not change the requirement to terminate the speech worker after its job.
- Use an inspectable local parser over the original recognized text and timing. An agent is not required to recognize the three cues or create searchable annotations.
- Treat a command at the start of a distinct mic utterance as a candidate. A matching word elsewhere in conversation is insufficient. Never scan game dialogue for these commands.
- A new independently spoken cue, a speech pause, or the end of the recording can suggest a thought boundary. Pause duration and continuation behavior need recorded examples before selecting thresholds. Longer notes may cross pauses and transcription chunks; preserve the full transcript and provide merge/split controls in review.
- A standalone Cut can be a complete command. A Mark or Note with no following content remains an incomplete item to review; do not invent its text.
- Ambiguous uses such as “I might cut this later,” game-audio bleed, or a character called Mark must remain reviewable. Single common words cannot guarantee intent from recognition alone. Do not treat an agent's rewritten phrasing as evidence of a newly spoken command.
- The September 29 sample exposed cue substitutions such as Note → no/now and Cut → but, and word timestamps attached to the preceding utterance across long silence. Preserve speech-activity spans and source offsets; reject or flag cue timestamps outside the supporting utterance. A second recognition pass with cue vocabulary may propose a correction, but its use of an expected keyword does not establish that the keyword was actually spoken.
- The initial Copilot workflow presents detected cues for correction and acceptance. A user-started Agent workflow can populate the reversible cut plan within its authorized scope, with human audit before final organization. Neither mode treats an uncertain cue as authorization to destroy media.

### Original, corrected, and searchable text

Keep three independently inspectable representations:

1. **Original transcript:** the local recognizer's unmodified output and source spans. This is recognition output, not a guarantee of a word-perfect transcription.
2. **Context-corrected text:** optional, reviewable corrections using the project glossary and supplied context. Preserve the original meaning and uncertainty; do not add unsupported game facts or dialogue.
3. **Searchable version:** optional concise title, summary, structured bullets, and relevant tags. For a marker, use a short title with the full thought available in its details. For a note, retain enough detail to support later writing.

Correction and restructuring are separate actions. Either can be skipped. Record which version the agent used and mark derivatives for review if that version changes. Editing a title or summary must not move the cue or fabricate word-level timing. Index original and accepted derived text so both the spoken wording and corrected game names can find the same annotation.

## Review presentation

Proposed shared annotation list: type (including Recording context), source time, title, and review state, with click-to-seek. Details expose original wording, optional correction, and optional condensed version. Allow changing the type, adjusting its anchor, joining or splitting thoughts, and accepting or rejecting a candidate without deleting the underlying transcript.

On the Cut page, distinguish point markers, proposed split boundaries, and notes visually. A Cut cue is not merely a differently named point marker. Reprocessing a transcript must reconcile with existing candidates and preserve human decisions rather than create duplicates.

## Clip links and Notion

- Keep stable annotation and source identities, the designated audio stream, cue time, speech spans, transcript revision, derived text provenance, and review state.
- Map source anchors onto verified exported ranges. Preserve source time and clip-relative time separately; an annotation may have several clip links when exports overlap.
- Keep the note locally even if Notion is unavailable. Notion publication is a separate configured action using the selected text version, source/clip context, and a timestamp link once app linking is implemented. Track the destination block/page so retrying does not create duplicate notes or overwrite unrelated page content.
- If the relevant footage was not retained, keep its original reference and indicate that playback is unavailable. Do not link it to an unrelated surviving clip merely to supply a playable target.
- Existing retention policy still applies: exported video contains game audio only. Keep the original until wanted mic transcription is saved and reviewed, or explicitly discarded. After source retirement, retain transcript/notes and lineage, without a separate mic-audio archive.

## Build in pieces

1. Implement explicit mic-track selection, local timed transcription, saved transcript records, and verified worker shutdown.
2. Add cue candidates, uncued recording-context records, and a review list using original transcript spans. Validate anchor quality and phrase boundaries before selecting automatic defaults.
3. Connect accepted Mark, Cut, and Note records to markers, the reversible cut plan, and local project notes. Verify source-to-export mappings.
4. Add independent optional correction and restructuring actions with reviewable text versions.
5. Add configured Notion publication and stable playback links after local records and links work.

## Focused validation before release

Use a consented disposable sample with clear cues, natural mentions of the same words, pauses within a note, successive commands, silent audio, microphone/game bleed, and a cue split across transcription chunks. Check missed/false cues, source-time alignment, duplicate-free reruns, and preservation of edited items. Test a spoken Cut between keyframes, overlapping exports, and notes surviving source retirement. No detection accuracy or timing accuracy is established yet.

September 29, 2026: a one-off local review of Connor's 7:55 recording exercised the speech engine outside the app. It recovered the commentary and all three cue types, while exposing ambiguous command words and alignment failures that require review. This is exploratory evidence, not an accepted cue-detection benchmark or an implemented in-app feature.

Also verify uncued context at the start and middle of a recording, a change of recording purpose, and continuation after a pause within an explicit note. Check that context informs names without creating unwanted markers or Notion notes, and remains linked when a source is split.

## Examples

- “I'm recording this because I want an example of how the inventory menu works.” → recording context available for naming and organization; no point marker, split, or published note is implied.
- “Mark. Cai's reaction when the gate opens.” → a point marker at the start of Mark; preserve the following explanation.
- “Cut.” → a requested split at the start of Cut; choose verified export boundaries later.
- “Note. I think the game is teaching this mechanic through the enemy placement, although I need to compare it with the earlier map.” → a timestamped note. A proposed concise title could be “Teaching through enemy placement”; preserve the tentative claim and the comparison still to do.
