import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceFolders, inSourceFolder } from '../src/workflow/sourceFolderTree.ts';
const record = (sourcePath) => ({ sourcePath });
test('branched Windows drive hides empty ancestors and retains real filtering paths', () => {
  const records = [
    record('I:\\OBS Videos\\a.mp4'),
    record('I:\\YouTube\\Project\\Video\\_Unsorted\\Cai\\b.mp4'),
    record('I:\\YouTube\\Project\\Video\\_Unsorted\\Cai\\c.mp4'),
  ];
  const tree = sourceFolders(records);
  assert.deepEqual(
    tree.map((n) => [n.label, n.total]),
    [
      ['OBS Videos', 1],
      ['Cai', 2],
    ],
  );
  assert.equal(tree[1].path, 'I:/YouTube/Project/Video/_Unsorted/Cai');
  assert(!inSourceFolder(records[0], tree[1].path));
  assert(inSourceFolder(records[2], tree[1].path));
});
test('a useful common ancestor retains descendants, counts and sibling filtering', () => {
  const records = [
    record('I:\\Project\\Video\\General Gameplay\\Dagsion\\a.mp4'),
    record('I:\\Project\\Video\\Systems\\b.mp4'),
  ];
  const [tree] = sourceFolders(records);
  assert.equal(tree.label, 'Video');
  assert.equal(tree.total, 2);
  assert.deepEqual(
    tree.children.map((n) => n.label),
    ['General Gameplay', 'Systems'],
  );
  assert(inSourceFolder(records[0], tree.path));
  assert(inSourceFolder(records[0], tree.children[0].path));
  assert(!inSourceFolder(records[1], tree.children[0].path));
});
test('drive-root recordings and UNC shares remain reachable', () => {
  const records = [
    record('I:\\root.mp4'),
    record('I:\\OBS Videos\\a.mp4'),
    record('\\\\host\\share\\Media\\a.mp4'),
  ];
  const tree = sourceFolders(records);
  assert(tree.some((n) => n.path === 'I:' && n.count === 1 && n.total === 2));
  assert(tree.some((n) => n.path === '//host/share/Media' && n.total === 1));
});
