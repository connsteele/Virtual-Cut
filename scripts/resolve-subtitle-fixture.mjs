// Makes a timed fixture for checking SRT import in DaVinci Resolve by hand (VC-154):
// a 20 s video whose embedded timecode starts at 01:00:00:00, with the clip time and the
// timecode burned into the picture, and the same three cues as two SRT files:
//   Timecode fixture.srt           clip-relative times, exactly what Virtual Cut writes
//   Timecode fixture.timecode.srt  the same cues shifted to the embedded timecode (+1 hour)
// Importing each one shows which timing Resolve expects; nothing here touches Resolve.
// Usage: node scripts/resolve-subtitle-fixture.mjs <output folder>
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { subtitleTime } from '../dist-electron/transcript-export.js';

const out = process.argv[2];
if (!out)
  throw new Error('Choose an output folder: node scripts/resolve-subtitle-fixture.mjs <folder>');
await mkdir(out, { recursive: true });
const name = 'Timecode fixture',
  fps = 30,
  seconds = 20;
const cues = [
  { start: 2, end: 4, text: 'Cue A · clip 00:02 · timecode 01:00:02:00' },
  { start: 8, end: 10, text: 'Cue B · clip 00:08 · timecode 01:00:08:00' },
  { start: 14, end: 16, text: 'Cue C · clip 00:14 · timecode 01:00:14:00' },
];
const srt = (shift) =>
  cues
    .map(
      (c, i) =>
        `${i + 1}\n${subtitleTime(c.start + shift)} --> ${subtitleTime(c.end + shift)}\n${c.text}\n`,
    )
    .join('\n');
const font = process.platform === 'win32' ? "fontfile='C\\:/Windows/Fonts/consola.ttf':" : '';
const text = (expr, y) =>
  `drawtext=${font}text='${expr}':x=60:y=${y}:fontsize=64:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=12`;
await new Promise((resolve, reject) => {
  const child = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=1280x720:rate=${fps}:duration=${seconds}`,
      '-f',
      'lavfi',
      '-i',
      // A short beep at each cue start, so the audio lines up with the picture too.
      `aevalsrc='0.3*sin(2*PI*880*t)*(lt(mod(t,6)-2,0.15)*gte(mod(t,6)-2,0))':s=48000:d=${seconds}`,
      '-vf',
      [
        text('clip %{pts\\:hms}', 60),
        `drawtext=${font}timecode='01\\:00\\:00\\:00':rate=${fps}:x=60:y=160:fontsize=64:fontcolor=yellow:box=1:boxcolor=black@0.7:boxborderw=12`,
      ].join(','),
      '-timecode',
      '01:00:00:00',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-g',
      String(fps),
      '-c:a',
      'aac',
      '-shortest',
      path.join(out, `${name}.mp4`),
    ],
    { stdio: 'inherit' },
  );
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code})`)),
  );
});
await writeFile(path.join(out, `${name}.srt`), srt(0), 'utf8');
await writeFile(path.join(out, `${name}.timecode.srt`), srt(3600), 'utf8');
console.log(`Resolve subtitle fixture written to ${out}`);
