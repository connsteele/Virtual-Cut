# State of the Realm: The Grand Cast reference

September 29, 2026. Design research for the next Library discussion; proposals below are not implemented or approved requirements.

## Reference and method

Connor supplied [1st used the State of the Realm | Final Fantasy XVI](https://www.youtube.com/watch?v=XDhNnDYRhos), uploaded by PanyapiN Gaming on June 25, 2023. This is the intended character-map reference, superseding the earlier assumption that Active Time Lore was the primary inspiration.

Downloaded with yt-dlp at Connor's request. Local reference: `G:\GPT\Work\virtual-cut\state-of-the-realm\reference.mp4` (1920×1080, approximately 16:01). The download, metadata and extracted frames stay on G: and outside the repository. Visual analysis used timestamped frames across the whole recording, with denser sampling of the Grand Cast opening and navigation. It does not establish the game's internal layout algorithm or every supported interaction.

The Grand Cast occupies roughly 00:35–10:45; the later section demonstrates the separate geographical Situation Map.

## Observed layout and behavior

| Reference | Visible behavior | Design value |
| --- | --- | --- |
| [00:40–00:55](https://www.youtube.com/watch?v=XDhNnDYRhos&t=40s) | A selected portrait can open a larger biography card over the still-visible, blurred map. The profile includes an image and text; paging changes the entry's story-era information. | Recognition, inspection and broader map context coexist. |
| [01:00–01:30](https://www.youtube.com/watch?v=XDhNnDYRhos&t=60s) | Portraits occupy a navigable canvas with colored regions and group labels. The view pans and changes scale. Roles appear beneath portraits; the selected name and profile action appear beside the selected node. More relationship text is visible in closer views. | A broad overview can become readable detail without replacing the entire spatial context. |
| [01:45–02:10](https://www.youtube.com/watch?v=XDhNnDYRhos&t=105s) | Switching the bottom story timeline changes the event summary, cast and relationships. A later state is much denser than the initial one. | The displayed network is scoped to a particular state. This is separate from video playback time. |
| [02:40–03:30](https://www.youtube.com/watch?v=XDhNnDYRhos&t=160s) | Named faction regions contain portraits. Connectors cross region boundaries, use arrows where direction matters, and carry small icons and short relationship labels. | Group membership and relationships between individual people are conveyed separately. |
| [09:00–09:30](https://www.youtube.com/watch?v=XDhNnDYRhos&t=540s) | A dense, close view still explains individual connections through relationship text and symbols. Some longer lines pass around other nodes. | The graph communicates why entries connect, beyond showing that they connect. |

The circular composition includes a central protagonist region and surrounding faction sectors. Its border and event summary occupy substantial space; in some close views, portraits and connections extend behind the summary or beyond the visible area. Those presentation choices suit the game's setting more than a compact desktop work area.

## Recommended translation to Virtual Cut

### 1. Keep Connor's concept folders and make their contents spatial

Retain Characters, Locations and nested Mechanics groups, linked to real footage folders. Use the folder tab and a restrained background/border to identify each group on a pan-and-zoom canvas. Place recognizable portrait or image nodes within these regions. The group is a container; it is not automatically an entity with a relationship to every other group.

Use the wide rectangular workspace. A rigid circular arrangement is unnecessary for groups that grow and expand. Keep the initial four relevant nodes per group, with an explicit remaining count and expansion. Preserve selection, camera and nearby positions when opening a group as far as the available space permits.

### 2. Draw and explain relationships between entries

The current prototype draws focus-to-folder curves and exposes relationship labels in its detail panel. A useful next experiment would also draw selected node-to-node relationships directly on the canvas, including connections among visible neighbors.

Use short labels and arrows for directional relationships. Highlight the selected node's connections; dim unrelated ones. At distant zoom levels, reduce labels; restore relevant labels on selection or closer inspection. Category color should continue to mean the same thing across Virtual Cut. Relationship meaning needs words or symbols rather than an unexplained second color system.

Keep explicit relationships distinct from co-occurrence in footage. Two characters appearing in one clip establishes shared evidence, not friendship or allegiance. Agent suggestions, if added later, require a visible review state.

### 3. Separate inspecting an entry from changing the graph focus

Proposed mouse behavior:

- Single click selects a node, emphasizes its relationships and opens its glossary/evidence details.
- A visible **Focus here** action recenters the exploration on that entry. Double-click could be an additional shortcut.
- Drag empty space to pan; zoom around the pointer; offer Fit and Back.
- Closing details returns the available canvas space without discarding the camera or selection.

The distinction matters because the current prototype changes graph focus on every node click. Reading several nearby entries should not require repeatedly rebuilding the visible neighborhood.

### 4. Make the connection itself useful for finding footage

For the agreed example, display Cai and Leda in Characters and Blaze Arts in Mechanics → Combat. Their connections to Blaze Arts explain the shared mechanic. Selecting one of those connections should expose the supporting clips, marker times and related notes. Selecting the mechanic should collect both characters' relevant evidence, while preserving its glossary definition and aliases.

Each entry needs a clear name and editable visual. Character portraits can be tighter crops than footage thumbnails; clip thumbnails should continue to show the complete frame as Connor requested.

### 5. Start with scope filters; reconsider changing story states later

The game's historical state selector is significant, but it implies maintaining dated versions of relationships, roles and biographies. That is a separate feature and remains deferred. Batch, act/chapter and evidence-type filters are a smaller first step for Virtual Cut's footage workflow.

If story-state views are added later, distinguish **when a relationship is true in the story** from **when a source file was recorded** and **the timestamp inside a clip**. Filtering footage is not sufficient to reconstruct historical relationship states.

## Suggested next design experiment

A wide map with softly bounded folder groups, editable image nodes, labeled connections, pan/zoom and an inspect-without-refocus detail panel. Keep top-four expansion and nested mechanics from Connor's mockup. Compare it against the current folder-card arrangement using Cai, Peter, Tialla, Castor, Centurio, Bertrand, Leda, Dagsion and Blaze Arts.

Success would mean Connor can recognize a person, understand a relationship, and reach the relevant footage or note without losing his place. This research does not change the app or commit to a graph library, story-versioning system or layout engine.
