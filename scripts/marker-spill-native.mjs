// VC-208: a clip's companion and chapters carry only its own markers. Outward keyframe cuts pad
// a clip with footage that belongs to its neighbours; markers in that padding used to spill in
// ("Distress Transmission" at frame 0 of Eden Prime, "Drop Briefing" at 0:00.85, a duplicated
// "Class Selection" in the first Mass Effect batch). The fixture is synthetic: 60 fps with a
// keyframe every 2 s, so every clip edge below sits between keyframes like the real batch.
// Set VIRTUAL_CUT_TEST_EXECUTABLE to a packaged Virtual Cut.exe to run it against that build.
import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const packaged = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const modules = packaged
  ? path.join(path.dirname(packaged), 'resources/app/dist-electron')
  : path.resolve('dist-electron');
const { ProjectService } = require(path.join(modules, 'project-service.cjs'));
const root = testPath('marker-spill');
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-')),
  source = path.join(dir, 'spill-fixture.mkv');
const run = (tool, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('exit', (code) => (code ? reject(Error(err)) : resolve(out)));
  });
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
  ffprobe = process.env.VIRTUAL_CUT_FFPROBE || 'ffprobe';
await run(ffmpeg, [
  ...['-v', 'error', '-nostdin'],
  ...['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=60:duration=12'],
  ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=12'],
  ...['-f', 'lavfi', '-i', 'sine=frequency=880:duration=12'],
  ...['-map', '0:v', '-map', '1:a', '-map', '2:a'],
  ...['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '120', '-keyint_min', '120'],
  ...['-sc_threshold', '0', '-c:a', 'flac', '-y', source],
]);

const service = new ProjectService(path.join(dir, 'profile'), path.join(dir, 'tools'));
const file = path.join(dir, 'spill.vcut');
let p = await service.open(file, {
  name: 'VC-208 marker spill',
  destination: dir,
  cache: path.join(dir, 'cache'),
});
const id = p.project.id;
async function settled() {
  for (let deadline = Date.now() + 90000; Date.now() < deadline;) {
    const s = await service.snapshot();
    if (!s.jobs.some((j) => ['queued', 'running'].includes(j.state))) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Media jobs did not settle');
}
const report = { dir, source, build: packaged || 'worktree dist-electron', runs: [] };
try {
  await service.importFiles(id, p.activeBatchId, [source], { game: 1, mic: 2 });
  p = await settled();
  const rid = p.model.recordings[0].id;
  const keys = [...service.store.frameIndex(rid).keys].sort((a, b) => a - b);
  assert.deepEqual(
    keys.map((k) => Math.round(k * 1000) / 1000),
    [0, 2, 4, 6, 8, 10],
    'The fixture has a keyframe every 2 s',
  );
  // Three neighbouring clips with every edge between keyframes, as in the real batch.
  const edenIn = 2.7,
    edenOut = 6.3;
  const before = structuredClone(p.model),
    after = structuredClone(before);
  const base = after.clips[0];
  after.clips = [
    { ...base, id: 'normandy', start: 0.5, end: edenIn, name: 'Normandy' },
    { ...base, id: 'eden', start: edenIn, end: edenOut, name: 'Eden Prime' },
    { ...base, id: 'creation', start: edenOut, end: 9.5, name: 'Character creation' },
  ].map((c) => ({ ...c, folder: '_Review' }));
  const marker = (id, time, end, name) => ({
    id,
    time,
    ...(end == null ? {} : { end }),
    name,
    color: 'Blue',
    category: 'Context',
    topic: '',
  });
  after.markers[rid] = [
    // Ends 0.38 s into Eden Prime, like the real one (1063.08 vs a 1062.7 clip end).
    marker('distress', 1.2, edenIn + 0.38, 'Distress Transmission'),
    // Starts exactly at Eden Prime's in-point.
    marker('drop', edenIn, null, 'Drop Briefing'),
    // Belongs to the next clip, but sits inside Eden Prime's outward keyframe padding.
    marker('class', edenOut + 0.4, null, 'Class Selection'),
    // Inside Eden Prime, close to its in-point but its own, however short.
    marker('short', edenIn + 0.1, edenIn + 0.55, 'Short beat'),
    marker('survey', 3.5, 4.5, 'Survey'),
    // Spans all three clips.
    marker('mission', 1, 9, 'Mission'),
  ];
  await service.save(id, before, after);
  await service.checkpoint(id);
  const fps = 60;
  for (const container of ['mp4', 'mkv']) {
    const companions = {},
      clips = [];
    for (const clip of after.clips) {
      const plan = await service.exportPlan(id, clip.id, container);
      const output = path.join(dir, clip.name.replace(/ /g, '-') + '.' + container);
      await service.startExport(id, plan.id, output, true);
      await settled();
      const record = service.store.exports().find((e) => e.plan.id === plan.id);
      assert.equal(record.state, 'verified', record.message);
      const data = JSON.parse(await readFile(output + '.vcut.json', 'utf8'));
      const chapters = JSON.parse(
        await run(ffprobe, ['-v', 'error', '-show_chapters', '-of', 'json', output]),
      ).chapters.map((c) => ({ title: c.tags?.title, start: Number(c.start_time) }));
      companions[clip.id] = data;
      clips.push({
        name: clip.name,
        requested: data.requested,
        actual: data.verified.actual,
        markers: data.markers.map((m) => ({
          name: m.name,
          clipTime: m.clipTime,
          clipEnd: m.clipEnd,
          frame: Math.floor(m.clipTime * fps + 1e-7),
        })),
        chapters,
      });
    }
    report.runs.push({ container, clips });

    const names = (clip) => companions[clip].markers.map((m) => m.name);
    const find = (clip, name) => companions[clip].markers.find((m) => m.name === name);
    const eden = companions.eden;
    assert.equal(eden.version, 4, 'The receipt version does not change');
    assert(eden.verified.actual.start < edenIn - 0.5, 'Eden Prime starts on an earlier keyframe');
    assert.deepEqual(
      names('eden').sort(),
      ['Drop Briefing', 'Mission', 'Short beat', 'Survey'],
      'Eden Prime carries only its own markers',
    );
    assert.equal(
      find('eden', 'Drop Briefing').clipTime,
      0,
      'A marker at the in-point is at frame 0',
    );
    assert.equal(
      find('eden', 'Mission').clipTime,
      0,
      'A range clipped at the in-point is at frame 0',
    );
    assert(
      Math.abs(find('eden', 'Mission').clipEnd - (edenOut - eden.verified.actual.start)) < 1e-6,
      'A range is clipped to the clip end',
    );
    assert(
      Math.abs(find('eden', 'Survey').clipTime - (3.5 - eden.verified.actual.start)) < 1e-6,
      'A marker inside the clip keeps its true position',
    );
    for (const m of eden.markers)
      assert(
        Math.abs(
          m.containerTime -
            m.clipTime -
            (eden.verified.actual.start + eden.source.videoStart + eden.verified.timestampShift),
        ) < 1e-6,
        'containerTime follows clipTime',
      );
    assert.deepEqual(
      names('normandy').sort(),
      ['Distress Transmission', 'Mission'],
      'Distress Transmission stays with the clip it mostly belongs to',
    );
    assert(
      Math.abs(
        find('normandy', 'Distress Transmission').clipEnd -
          (edenIn - companions.normandy.verified.actual.start),
      ) < 1e-6,
      'and is clipped to that clip end',
    );
    assert.deepEqual(names('creation').sort(), ['Class Selection', 'Mission']);
    const allNames = Object.values(companions).flatMap((c) => c.markers.map((m) => m.name));
    assert.equal(
      allNames.filter((n) => n === 'Class Selection').length,
      1,
      'Class Selection is not duplicated',
    );
    // Chapters (what Resolve shows before the helper runs) match the companion.
    for (const clip of clips) {
      const own = new Set(clip.markers.map((m) => m.name));
      for (const chapter of clip.chapters.filter((c) => c.title !== 'Clip start'))
        assert(
          own.has(chapter.title),
          `${clip.name}: chapter ${chapter.title} is one of its markers`,
        );
    }
    assert.equal(
      clips[1].chapters.find((c) => c.title === 'Drop Briefing')?.start,
      0,
      'The Drop Briefing chapter is at 0',
    );
  }
  await writeFile(path.join(dir, 'companions.json'), JSON.stringify(report, null, 2));
  console.log('Marker spill checks passed:', dir);
} finally {
  await service.close();
}
