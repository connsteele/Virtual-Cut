export const fast = [
  'transcript-domain.test.mjs',
  'project-context.test.mjs',
  'coverage-pipeline.test.mjs',
  'save-policy.test.mjs',
  'media.test.mjs',
  'source-folders.test.mjs',
  'timeline-viewport.test.mjs',
  'scan-playback.test.mjs',
  'audio-sync.test.mjs',
  'filmstrip-memory.test.mjs',
  'marker-timing.test.mjs',
  'review-order.test.mjs',
  'game-library.test.mjs',
  'agent-tools.test.mjs',
  'agent-proposals.test.mjs',
  'agent-changes.test.mjs',
  'batch-record.test.mjs',
  'intent-score.test.mjs',
  'split-snap.test.mjs',
  'proposal-previews.test.mjs',
  'job-lanes.test.mjs',
  'visual-events.test.mjs',
  'screen-text.test.mjs',
  'script-paths.test.mjs',
  'screen-text-runtime.test.mjs',
  'agent-access.test.mjs',
  'look-plan.test.mjs',
  'heard-as.test.mjs',
  'release-notes.test.mjs',
  'proxy-record.test.mjs',
  'clip-gaps.test.mjs',
  'proxy-make.test.mjs',
];
export const native = [
  'stitched-export-native.mjs',
  'speech-setup-checks.mjs',
  'screen-text-setup-checks.mjs',
  'transcript-storage-checks.mjs',
  'project-deletion-checks.mjs',
  'range-markers-native.mjs',
  'marker-spill-native.mjs',
  'srt-sources-native.mjs',
  'resolve-helper-checks.mjs',
  'filing-native-checks.mjs',
  'save-policy-native.mjs',
  'project-recovery-checks.mjs',
  'project-native-checks.mjs',
  'feedback-native-checks.mjs',
  'recording-removal-checks.mjs',
  'intake-zoom-native-checks.mjs',
  'export-native-checks.mjs',
  'export-feedback-native.mjs',
  'lossless-audio-native.mjs',
  'filmstrip-checks.mjs',
  'review-planning-native.mjs',
  'project-capacity-checks.mjs',
  'job-lanes-native.mjs',
  'proxy-native.mjs',
  'visual-pass-native.mjs',
  'screen-text-native.mjs',
];
export const desktop = [
  'clip-color-ui.mjs',
  'proxy-ui.mjs',
  'speech-setup-ui.mjs',
  'screen-text-setup-ui.mjs',
  'crash-diagnostics-checks.mjs',
  'transcription-review-ui.mjs',
  'dropped-lines-ui.mjs',
  'heard-as-ui.mjs',
  'transcription-ui-checks.mjs',
  'project-deletion-ui.mjs',
  'range-markers-ui.mjs',
  'filing-ui-checks.mjs',
  'save-policy-ui.mjs',
  'project-recovery-ui.mjs',
  'smoke.mjs',
  'project-ui-checks.mjs',
  'timing-checks.mjs',
  'feedback-ui-checks.mjs',
  'playback-ui-checks.mjs',
  'intake-zoom-ui-checks.mjs',
  'review-fixes-checks.mjs',
  'export-ui-checks.mjs',
  'filmstrip-ui-checks.mjs',
  'filmstrip-reuse-checks.mjs',
  'review-planning-ui.mjs',
  'agent-access-ui.mjs',
  'agent-pictures-ui.mjs',
  'agent-proposals-ui.mjs',
  'agent-changes-ui.mjs',
  'whats-new-ui.mjs',
  'split-snap-ui.mjs',
  'split-clipless-ui.mjs',
  'proposal-preview-ui.mjs',
  'combined-transcript-ui.mjs',
  'visual-pass-ui.mjs',
  'screen-text-ui.mjs',
  'look-ui.mjs',
  'proxy-switch-ui.mjs',
  'follow-dblclick-ui.mjs',
  'gaps-ui.mjs',
];
export const dependencies = {
  'gaps-ui.mjs': ['stitched-export-native.mjs'],
  'speech-setup-ui.mjs': ['transcript-storage-checks.mjs'],
  'screen-text-setup-ui.mjs': ['transcript-storage-checks.mjs'],
  'transcription-review-ui.mjs': ['transcript-storage-checks.mjs'],
  'dropped-lines-ui.mjs': ['transcript-storage-checks.mjs'],
  'heard-as-ui.mjs': ['transcript-storage-checks.mjs'],
  'transcription-ui-checks.mjs': ['transcript-storage-checks.mjs'],
  'agent-proposals-ui.mjs': ['transcript-storage-checks.mjs'],
  'agent-changes-ui.mjs': ['transcript-storage-checks.mjs'],
  'proposal-preview-ui.mjs': ['transcript-storage-checks.mjs'],
  'combined-transcript-ui.mjs': ['transcript-storage-checks.mjs'],
  'project-deletion-ui.mjs': ['project-deletion-checks.mjs'],
  'range-markers-ui.mjs': ['range-markers-native.mjs'],
  'clip-color-ui.mjs': ['marker-spill-native.mjs'],
  'proxy-ui.mjs': ['proxy-native.mjs'],
  'filing-ui-checks.mjs': ['filing-native-checks.mjs'],
  'save-policy-ui.mjs': ['feedback-native-checks.mjs'],
  'project-recovery-ui.mjs': ['project-recovery-checks.mjs'],
  'project-ui-checks.mjs': ['project-native-checks.mjs'],
  'timing-checks.mjs': ['project-native-checks.mjs'],
  'recording-removal-checks.mjs': ['feedback-native-checks.mjs'],
  'feedback-ui-checks.mjs': ['feedback-native-checks.mjs'],
  'playback-ui-checks.mjs': ['feedback-native-checks.mjs'],
  'review-fixes-checks.mjs': ['feedback-native-checks.mjs'],
  'intake-zoom-ui-checks.mjs': ['intake-zoom-native-checks.mjs'],
  'export-feedback-native.mjs': ['export-native-checks.mjs'],
  'export-ui-checks.mjs': ['export-native-checks.mjs'],
  'filmstrip-ui-checks.mjs': ['filmstrip-checks.mjs'],
  'filmstrip-reuse-checks.mjs': ['filmstrip-checks.mjs'],
  'review-planning-ui.mjs': ['review-planning-native.mjs'],
  'follow-dblclick-ui.mjs': ['transcript-storage-checks.mjs'],
};
// With --jobs above 1, these run with nothing beside them: they measure real decoding and
// timers while seeking or playing.
export const exclusive = ['timing-checks.mjs', 'playback-ui-checks.mjs', 'review-fixes-checks.mjs'];
// Checks that open, or copy, the same fixture project run one after another in this order.
// Projects take a .lock and use SQLite WAL, so a copy taken while another check has the
// project open can miss its latest writes.
export const sharedFixtures = [
  ['save-policy-ui.mjs', 'feedback-ui-checks.mjs', 'playback-ui-checks.mjs'],
  ['filmstrip-ui-checks.mjs', 'filmstrip-reuse-checks.mjs'],
];
// The suite stops a check after three minutes (the slowest, review-fixes, takes under one).
// A check that needs longer is named here with its own limit in milliseconds.
export const checkTimeout = 3 * 60 * 1000;
export const longerTimeouts = {};
// Explicit inventory: a new test script must join a gate or receive a reason here.
export const other = {
  'playback-speed-study.mjs':
    'Measures painted frames, gaps and decode load at each J/K/L speed on a copied project; manual, needs real footage.',
  'transcript-render-study.mjs':
    'Times the Transcript window main thread while the playhead moves on a dense Both page with many corrections (VC-29 note 28); manual study on a suite run.',
  'proxy-study.mjs':
    'Generates H.264 NVENC playback-proxy candidates from a copied recording and records time and size; needs an NVIDIA GPU.',
  'scrub-timing-study.mjs':
    'Times timeline scrubbing (pointer-to-frame, frames per second of drag, rest and release to the exact frame) on a copied project; manual, needs real footage.',
  'scrub-cache-study.mjs':
    'Times scrubbing from a WebCodecs frame cache with the scrub-timing-study drag on a copied recording (VC-202, VC-147); manual study.',
  'proxy-candidates-study.mjs':
    'Makes the VC-16 proxy candidates (H.264, all-intra H.264, ProRes, DNxHR at 1080p and 720p) from copied recordings and records time, size, CPU and GPU load; needs an NVIDIA GPU.',
  'viewer-probe-study.mjs':
    'VC-16 probe outside the app: decodes ProRes or DNxHR proxies with FFmpeg and draws them on a WebGL canvas, timing seeks, drags and streaming; manual, needs proxies made from copies.',
  'underflow-study.mjs':
    'VC-16: finds why the app falls short at 4× and 8× on H.264 proxies by changing one thing at a time against a bare player; manual, needs copies and a free GPU.',
  'reverse-cache-study.mjs':
    'Measures reverse playback from a WebCodecs frame cache on a copied recording; manual study.',
  'resolve-subtitle-fixture.mjs':
    'Makes the timed video and SRT pair for checking subtitle import in Resolve by hand (VC-154); not a test.',
  'look-timing.mjs':
    'Times the look tool decoding strips, frames and crops on a copied recording (VC-172); manual, needs real footage.',
  'look-study.mjs':
    'Makes look calls through the real MCP pipe on a copied recording and saves the pictures (VC-172); manual, needs real footage.',
  'intent-score.mjs':
    'Scores proposals and decisions against tagged mic notes (VC-128); on demand, reads only the files it is given.',
  'cue-accuracy-study.mjs':
    'Scores spoken-cue recognition against labelled recordings (VC-128); copies them, needs a local speech engine.',
  'hint-guard-study.mjs':
    'Checks vocabulary hints and their guard against tagged notes (VC-164); copies the recording, needs a local speech engine and the GPU.',
  'heard-as-study.mjs':
    'Runs heard-as rows over saved transcripts and lists every word they change (VC-194); on demand, reads only the files it is given.',
  'dropped-lines-study.mjs':
    'Checks dropped microphone lines against tagged notes (VC-166); copies the recording, needs a local speech engine and the GPU.',
  'job-lanes-ui.mjs':
    'Desktop check with the real speech engine (VC-145): import and exports beside a transcription, pause and cancel, screenshots; needs disposable copies.',
  'job-lanes-study.mjs':
    'Real recognition beside a real import and exports (VC-145): start delays and slowdown; needs the local speech engine and disposable copies.',
  'transcription-device-study.mjs':
    'Real CPU/GPU and bounded speech-batch comparison on explicitly supplied disposable samples; requires local runtime.',
  'transcription-sample-study.mjs':
    'Real copied-audio comparison with and without vocabulary hints; requires explicit samples and local runtime.',
  'transcription-native-checks.mjs':
    'Real DJI speech integration measurement; requires an explicitly supplied local ASR runtime and disposable audio sample.',
  'transcription-worker-checks.mjs':
    'Real ASR lifecycle measurement; requires the local model and copied speech fixture.',
  'resolve-live-fixture.mjs':
    'Disposable media generator for live Resolve acceptance; no Resolve connection or user project edits.',
  'project-checks.mjs': 'Legacy wrapper; constituent checks are maintained above.',
  'feedback-checks.mjs': 'Legacy wrapper; constituent checks are maintained above.',
  'export-checks.mjs': 'Legacy wrapper; synthetic checks are maintained above.',
  'intake-zoom-checks.mjs': 'Legacy wrapper; constituent checks are maintained above.',
  'review-planning-checks.mjs': 'Focused wrapper; constituent checks are maintained above.',
  'filmstrip-native-run.mjs': 'Focused wrapper for maintained filmstrip native checks.',
  'project-long-checks.mjs': 'Manual extended recording fixture; not a synthetic CI gate.',
  'export-real-check.mjs': 'Manual copied real-footage export evidence; requires explicit fixture.',
  'workflow-smoke.mjs': 'Historical prototype/sample-only UI walkthrough.',
  'iteration-03-checks.mjs': 'Historical prototype/sample-only animation evidence.',
  'overlap-checks.mjs':
    'Historical sample-only layout study; clip trim checks remain in desktop gates.',
  'transport-fixture.mjs': 'Manual copied 4K gameplay fixture for extended playback checks.',
  'transport-regression-checks.mjs': 'Manual 4K fixture; retain for M230 hardware playback review.',
  'media-card-review-checks.mjs': 'Manual 4K fixture for source switch/card-date review.',
  'transport-delivery-checks.mjs': 'Exploratory Chromium playback delivery measurements.',
  'transport-investigation.mjs': 'Exploratory Chromium versus app transport measurements.',
  'audio-speed-study.mjs': 'Exploratory track-selection playback benchmark.',
};
