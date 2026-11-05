# 0022. Agents may look at pictures Virtual Cut renders, per app, off until allowed

- Status: Proposed
- Amends: [0014](0014-agent-access-boundary.md) ("never media bytes") for pictures only
- Sources: VC-172, VC-195, the visual data spike ([Seeing the Footage](https://claude.ai/artifact/6BTWRqTrFwK4WbS5noepvJ), D5, October 10), Connor's shape of October 7 (18:31 UTC), the Sprint 12 refinement (S12-172, S12-CROPS, S12-GUIDE, S12-MEASURE, accepted 2026-11-05)

## Context

Text answers (transcripts, picture events, screen text) settle most questions, but some need eyes: what happened in a scene, a name the screen text misread, whether a Split sits on the right frame, a pattern across scenes. Agent apps have no video input, so pictures are the only way, and their cost follows pixels: about one token per started 28 px cell across and down. In the spike, pictures caught a Split heard as "Spoiler" in 10 of 12 runs against 3 of 19 with text alone, at 3 to 8 times the agent input. Decision 0014 kept every media byte out of MCP; pictures leave Connor's PC and are kept by the agent app under its own data settings, so the choice must be his, per app.

## Decision

- **One tool, `look`, and only while allowed.** Every call first goes through `AgentAccess.checkPictures` for the calling pairing, which reads its Allow pictures setting (off for new and older pairings, changed only by the user in the Agent panel, VC-195). When off, the call is refused with a message saying who turns pictures on, and Activity lists it as refused.
- **Rendered images, never files.** Virtual Cut decodes the pictures into memory and sends them as MCP image blocks (JPEG). No file path, media URL or video ever goes out, and nothing is written: no picture files, no picture cache. Strip tiles come from the recording's existing filmstrip tile file ([0013](0013-filmstrip-tile-files.md)) when it holds the keyframe; otherwise FFmpeg decodes on the CPU at normal priority, never with the picture pass's NVIDIA decoder.
- **Three kinds of moment, up to 8 a call:** a strip (a range as up to 16 tiles of 252x140 with the time burned into each, from the nearest keyframe when it lies within half the tile spacing and 2 s, else the exact frame), frames (720p by default, up to 6 a call; 1080p, up to 2 a call; Lanczos scaling; recordings that are not 16:9 fit inside the same box) and crops (a `get_screen_text` box padded by half its text height, or a box in fractions of the frame, at full source detail). No named regions for any game.
- **Caps per call:** at most 16 pictures, about 8,000 image tokens, 1988 px on any side (clear of the 2000 px rule for conversations over 20 images), text under 100,000 characters. A request over a cap is fitted and the answer says how: frames over a size's count step down a size, strips give up tiles (down to 2) before the last pictures are left out, and the largest frame or crop steps down until the tokens fit. Sizes fill whole 28 px cells (a 4K frame at 720p is 1288x724, 1,196 tokens), crops grow to whole cells where the frame allows, and nothing is enlarged.
- **Each picture follows a text line** naming the recording, its time (clock and seconds) and its size. A picture nearly the same as one already in the call (same kind and size, a 64x36 grey hash within 1.5 levels on average and 12 in any cell) is left out and named in the answer.
- **Activity:** one line per call with the recording and the times asked, plus the picture count and estimated image tokens. Never the pictures.
- **Intent guide v4:** an app with pictures allowed reads three sentences about looking in the guide's general section; an app with pictures off reads v4 without them.

## Alternatives considered

- **File paths or media URLs for the agent to open:** rejected by 0014, and an agent app would keep or upload whole files.
- **Pictures in every answer (frames beside transcript lines):** the spike's cost came from extra turns re-reading a large context; pictures only on request keep text the default.
- **Named crops per game (the October 7 shape):** game-specific, which the every-game design rule rules out; a screen text box or fraction box covers the same need.
- **1440p whole frames:** 2560 px is over the 1988 px limit; a crop gives that detail where it matters.
- **A strip as one contact sheet:** the same tokens as separate tiles, but the agent could not be told each tile's time on its own line, and one large image counts once against the 16-picture cap while hiding how many tiles it holds.

## Consequences

- MCP answers can now carry image blocks, from this one tool only, and only for pairings the user allowed. Every later picture tool must call `checkPictures` first and record `{ images, imageTokens }`.
- Pictures leave the PC under the agent app's own retention (Claude Code also saves a copy on disk); [agent apps](../agent-apps.md) says so.
- Exact frames decode from the previous keyframe on the CPU, so a 4K AV1 frame costs up to a few seconds; strips mostly reuse filmstrip tiles. Timings are in VC-172's evidence.
- Whether pictures improve agent results, and at what cost, is measured separately on Connor's go (VC-172 measure runs).
