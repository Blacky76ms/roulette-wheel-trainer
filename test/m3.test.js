import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageItems, itemById, itemLabel } from '../src/items.js';
import { buildQuestion, rotationAnswer, SEGMENT_LEVELS, ROTATION_SECONDS } from '../src/questions.js';
import { pocketAtMarker, step, distance, POCKET_ANGLE } from '../src/wheel.js';
import {
  defaultProgress, recordAnswer, adaptLevel, stageLevel, isFastAnswer, migrate, XP_PER_CORRECT, XP_FAST_BONUS,
} from '../src/progress.js';

const NOW = 1_800_000_000_000;
function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

test('pocketAtMarker reads the number under the fixed 12 o’clock marker for any rotor angle', () => {
  assert.equal(pocketAtMarker(0), 0);
  assert.equal(pocketAtMarker(-POCKET_ANGLE), 32);
  assert.equal(pocketAtMarker(POCKET_ANGLE), 26);
  assert.equal(pocketAtMarker(360 + POCKET_ANGLE * 0.4), 0);
  assert.equal(pocketAtMarker(POCKET_ANGLE * 0.6), 26);
});

test('when the ring turns clockwise the numbers arriving at the marker are the CCW neighbors', () => {
  assert.equal(rotationAnswer({ atMarker: 0, ahead: 0, rotation: 'CW' }), 0);
  assert.equal(rotationAnswer({ atMarker: 0, ahead: 2, rotation: 'CW' }), step(0, 2, 'CCW'));
  assert.equal(rotationAnswer({ atMarker: 0, ahead: 3, rotation: 'CCW' }), step(0, 3, 'CW'));
});

test('stage 8 has marker and arrive-in-n items for both rotation directions', () => {
  const items = stageItems(8);
  assert.equal(items.filter((i) => i.kind === 'rotMarker').length, 2);
  const arrive = items.filter((i) => i.kind === 'rotArrive');
  assert.equal(arrive.length, 8);
  assert.ok(arrive.every((i) => i.ahead >= 1 && i.ahead <= 4 && ['CW', 'CCW'].includes(i.dir)));
  assert.equal(itemLabel(itemById('ra:CCW:3')), 'Arrives in 3 · ring CCW');
  assert.deepEqual(ROTATION_SECONDS, [6, 5, 4, 3]);
});

test('stage 7 shows a 3 to 5 pocket segment with hidden numbers; harder levels hide two and shorten exposure', () => {
  const rng = seededRng(12);
  assert.equal(stageItems(7).length, 37);
  for (const item of stageItems(7)) {
    for (const level of [0, SEGMENT_LEVELS.length - 1]) {
      const q = buildQuestion(item, { recall: true, rng, level });
      const segment = [...q.wheel.revealed, ...q.wheel.unknown];
      assert.ok(segment.length >= 3 && segment.length <= 5);
      assert.ok(segment.includes(item.n));
      assert.equal(q.wheel.unknown.length, SEGMENT_LEVELS[level].hidden);
      assert.equal(q.exposureMs, SEGMENT_LEVELS[level].exposureMs);
      const given = Array.isArray(q.answer) ? q.answer : [q.answer];
      assert.deepEqual([...given].sort((a, b) => a - b), [...q.wheel.unknown].sort((a, b) => a - b));
      if (given.length === 2) assert.ok(distance(given[0], given[1], 'CW') < 5, 'two answers are asked in CW order');
    }
  }
  assert.equal(SEGMENT_LEVELS[0].exposureMs, null);
  assert.ok(SEGMENT_LEVELS.at(-1).exposureMs < SEGMENT_LEVELS[1].exposureMs);
  assert.equal(SEGMENT_LEVELS.at(-1).band, false);
});

test('difficulty steps up after 85% over 10 answers, down below 70%, and stays inside its range', () => {
  let s = { level: 0, recent: [] };
  for (let i = 0; i < 10; i++) s = adaptLevel(s, true, 3);
  assert.deepEqual(s, { level: 1, recent: [] });
  for (let i = 0; i < 10; i++) s = adaptLevel(s, i < 6, 3);
  assert.equal(s.level, 0);
  for (let i = 0; i < 10; i++) s = adaptLevel(s, false, 3);
  assert.equal(s.level, 0);
  let top = { level: 3, recent: [] };
  for (let i = 0; i < 10; i++) top = adaptLevel(top, true, 3);
  assert.equal(top.level, 3);
});

test('only stages 7 and 8 adapt; the level is persisted per stage and old saves start at 0', () => {
  let p = defaultProgress(NOW);
  for (let i = 0; i < 10; i++) p = recordAnswer(p, { item: itemById('sg:17'), stage: 7, ok: true, latencyMs: 900, now: NOW });
  assert.equal(stageLevel(p, 7), 1);
  assert.equal(stageLevel(p, 8), 0);
  p = recordAnswer(p, { item: itemById('sm:17'), stage: 2, ok: true, latencyMs: 900, now: NOW });
  assert.equal(stageLevel(p, 2), 0);
  const { levels, kindLat, rt, ...old } = p;
  assert.equal(stageLevel(migrate(old, NOW), 7), 0);
});

test('fast bonus: +5 only when reaction time is active (85% over 20) and the answer beats the own median', () => {
  let p = defaultProgress(NOW);
  const answer = (latencyMs, ok = true) => {
    p = recordAnswer(p, { item: itemById('as:17>34'), stage: 3, ok, latencyMs, now: NOW });
  };
  for (let i = 0; i < 19; i++) answer(2000);
  assert.equal(isFastAnswer(p, itemById('as:17>34'), 3, 500), false, 'not active before 20 answers');
  answer(2000);
  assert.equal(p.xp, 20 * XP_PER_CORRECT);
  assert.equal(isFastAnswer(p, itemById('as:17>34'), 3, 500), true);
  assert.equal(isFastAnswer(p, itemById('as:17>34'), 3, 2500), false);
  answer(500);
  assert.equal(p.xp, 21 * XP_PER_CORRECT + XP_FAST_BONUS);
  answer(100, false);
  assert.equal(p.xp, 21 * XP_PER_CORRECT + XP_FAST_BONUS, 'a fast wrong answer earns nothing');
});

test('best and average reaction time are kept for correct answers only', () => {
  let p = defaultProgress(NOW);
  p = recordAnswer(p, { item: itemById('as:17>34'), stage: 3, ok: true, latencyMs: 1000, now: NOW });
  p = recordAnswer(p, { item: itemById('as:17>34'), stage: 3, ok: true, latencyMs: 3000, now: NOW });
  p = recordAnswer(p, { item: itemById('as:17>34'), stage: 3, ok: false, latencyMs: 10, now: NOW });
  assert.deepEqual(p.rt, { best: 1000, sum: 4000, count: 2 });
});

test('a segment with two hidden numbers still shows at least two anchors', () => {
  const rng = seededRng(21);
  for (const item of stageItems(7)) {
    const q = buildQuestion(item, { recall: true, rng, level: SEGMENT_LEVELS.length - 1 });
    assert.ok(q.wheel.revealed.length >= 2, item.id);
  }
});
