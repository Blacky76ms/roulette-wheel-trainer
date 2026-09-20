import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemById, studyChunk } from '../src/items.js';
import { defaultProgress, markIntroduced, isIntroduced, migrate } from '../src/progress.js';

const NOW = 1_800_000_000_000;

test('a sector question is preceded by a study card of that whole sector, in ring order', () => {
  const chunk = studyChunk(itemById('sm:17'));
  assert.equal(chunk.id, 'sector:orphelins');
  assert.equal(chunk.title, 'Orphelins');
  assert.deepEqual(chunk.runs, [[17, 34, 6], [1, 20, 14, 31, 9]]);
  assert.equal(chunk.view, 'full');
  assert.equal(studyChunk(itemById('se:tiers:0:first:CW')).id, 'sector:tiers');
});

test('arc questions share one study card per arc', () => {
  const ids = ['as:19>4', 'am:21', 'ac:A4:CCW'].map((id) => studyChunk(itemById(id)).id);
  assert.deepEqual(ids, ['arc:A4', 'arc:A4', 'arc:A4']);
  const chunk = studyChunk(itemById('am:21'));
  assert.deepEqual(chunk.runs, [[19, 4, 21, 2, 25]]);
  assert.equal(chunk.view, 'arc');
  assert.equal(chunk.focus, 21);
});

test('a junction card shows both arcs it joins, the same card for both directions', () => {
  const cw = studyChunk(itemById('js:7>28'));
  const ccw = studyChunk(itemById('js:28>7'));
  assert.equal(cw.id, ccw.id);
  assert.deepEqual(cw.runs, [[22, 18, 29, 7, 28, 12, 35, 3]]);
  assert.deepEqual(cw.mark, [7, 28]);
});

test('items without a chunk (distance, position) have no study card', () => {
  assert.equal(studyChunk(itemById('dc:5')), null);
  assert.equal(studyChunk(itemById('pt:5')), null);
});

test('introduced chunks are remembered, immutably, and old saves simply have none', () => {
  const p0 = defaultProgress(NOW);
  const p1 = markIntroduced(p0, 'arc:A4');
  assert.equal(isIntroduced(p0, 'arc:A4'), false);
  assert.equal(isIntroduced(p1, 'arc:A4'), true);
  assert.equal(markIntroduced(p1, 'arc:A4'), p1);
  const { introduced, ...oldSave } = p1;
  assert.deepEqual(migrate(oldSave, NOW).introduced, []);
});
