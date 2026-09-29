# Library, glossary, and Resolve handoff

Research and UI decisions, September 29, 2026. These are proposals and inspected capabilities, not completed integrations.

## A shared library model

Store a stable entity ID for each character, location, mechanic, story topic, or other glossary term. Names, aliases, definitions, and pronunciation hints are editable attributes. Markers, clips, recordings, notes, and timelines also need stable identities. A connection stores its endpoints, relationship type, provenance, and review state.

The glossary and graph present the same entities. Search should find canonical names and aliases. Transcript correction can use approved glossary context while retaining the original transcription and the correction history. An alias must not automatically rename original files or silently rewrite every occurrence of an ambiguous word.

Start with explicit user connections and existing metadata. Agent-inferred relationships can be proposals later. No agent is needed to navigate known links or show frames associated with known markers.

Useful relation examples:

- Cai → Peter / Tialla: friend.
- Cai → Dagsion: explores; Dagsion → exploration clip: shown in.
- Cai → Blaze Arts: unlocks; Leda → Blaze Arts: route examples.
- Blaze Arts → actual mechanic footage: shown in. Preserve the actual performer, such as Theodora, separately from the route protagonist.
- Note → marker: cites; marker → clip: inside; glossary entity → marker: labels.

Graph links supplement the existing folder hierarchy. They do not require moving footage into a new taxonomy. A local focus with one or two links of depth should be the starting view, with selectable nodes and exact-footage drill-down. Obsidian's [official Graph documentation](https://help.obsidian.md/plugins/graph) is useful precedent for local depth, filters, and groups. A graph, relationship columns, and topic board can offer different views of the same data.

## Notes and timestamps

Keep local note IDs, original/source timestamps, and source-to-retained-clip mappings. A Notion page URL is a reference, not proof that a note has been published or synchronized. Linking a note to several clips or markers should create several relationships without duplicating its text. Deleted source audio does not prevent text references from resolving to retained video ranges.

A future Notion connector must distinguish local changes from published revisions and report failures. The current UI demonstration edits local draft text and relationships only.

## Smart Bins: metadata first

Blackmagic describes Smart Bins as automatically organizing media based on metadata in its [official Edit page documentation](https://www.blackmagicdesign.com/products/davinciresolve/edit). That makes approved metadata a plausible bridge from Virtual Cut topics to Resolve collections.

The installed official Resolve scripting SDK inspected on this workstation exposes `MediaPoolItem.GetMetadata` and `SetMetadata`, plus third-party metadata methods. No direct Smart Bin creation or rule-management method was found in the inspected `DaVinciResolveScript.pyi` or scripting README. This is a limit of the inspected surface, not a claim about every Resolve version or future release.

Proposed first integration:

1. Match the retained clip to an existing media-pool item.
2. Read its current metadata.
3. Show a proposed keyword/metadata merge for user review, preserving existing values.
4. Apply only validated writable fields.
5. Let corresponding Smart Bin rules collect the media in Resolve.

Validate the installed version's writable fields, keyword encoding, metadata matching rules, and refresh behavior before promising an end-to-end connector. A graph relationship cannot necessarily be represented as a Smart Bin rule. Directory bins and metadata-driven Smart Bins are separate concepts.

## Selects and appending timelines

The installed SDK declares dictionary-based `MediaPool.AppendToTimeline` clip specifications with media-pool item, source start/end frames, media type, track index, and record frame. It also exposes timeline creation/import, start/end frame information, media-pool contents, and object identity methods. These support a plausible explicit append workflow.

Proposed design:

- Store Resolve project/timeline identity after a deliberate association. Display names for human confirmation. A matching name alone is insufficient; missing or ambiguous matches require a chooser.
- Reuse verified media-pool items and preserve the existing timeline. Preview append position, clip count, source ranges, and skipped duplicates before executing.
- Maintain a handoff manifest linking sequence entries to source/retained-clip IDs, ranges, and created Resolve items. Detect identical appended ranges; do not silently deduplicate merely overlapping ranges.
- Convert rational source/timeline frame rates explicitly. Verify end-frame conventions, timecode bases, handles, audio mapping, and frame-rate conversion with disposable test timelines.
- Re-read destination state immediately before applying a plan. Preserve subsequent human changes and fail clearly if the target no longer matches.
- Offer a separate new-timeline path. Interchange-file fallback can be evaluated using formats supported by the installed import API.

The interactive demo simulates these decisions with local timeline data. No live Resolve session was changed or used to validate an append.

## Thumbnails without an agent

Use this priority: user-pinned frame, a frame near an approved marker/intent timestamp inside the clip, then a representative frame from within the retained range. Avoid black/loading frames when possible. Cache small thumbnails and regenerate only when the source or chosen timestamp changes.

FFmpeg's [thumbnail filter](https://ffmpeg.org/ffmpeg-filters.html#thumbnail) selects a representative frame from a batch; larger batches use more memory. Representative appearance does not establish narrative importance. A marker supplies known context; a manual pin resolves the remaining ambiguity without an agent.

The design demo uses small silent excerpts and still images for responsiveness. These are demonstration assets, not the deferred production proxy feature. Original source files and folder structure were read without modification, and dot-prefixed directories were excluded from enumeration.

## Implementation order

1. Validate the interaction model using the separate demo, including glossary/graph navigation and Review expansion.
2. Implement shared project/batch/source/clip/marker IDs and reliable source-to-clip time mapping.
3. Add transport and the combined Cut timeline; validate keyframe and reverse behavior with the existing media engine.
4. Implement persisted User Review and verified filing.
5. Add glossary entities, explicit relationships, and local note references; make search and drill-down work before larger graph layouts.
6. Implement a dry-run metadata/timeline adapter against disposable Resolve projects, then review the first real handoff.

Use the existing React/TypeScript/CSS Modules app stack. A separate graph database or language migration is not justified by this UI study; an ordinary local relational model can store entities and edges initially.
