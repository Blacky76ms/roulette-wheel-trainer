import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageItems, itemById, itemLabel } from '../src/items.js';
import { buildQuestion, isCorrectAnswer } from '../src/questions.js';
import { pocket, distance, shortestDistance, step, JUNCTIONS } from '../src/wheel.js';
import {
  defaultProgress, recordAnswer, recordBenchmark, benchmarkBest, masteryBars, benchmarkAvailable, level1Mastered,
} from '../src/progress.js';
import { benchmarkOrder } from '../src/benchmark.js';

const NOW = 1_800_000_000_000;
function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}
const kinds = (stage, kind) => stageItems(stage).filter((i) => i.kind === kind);

test('stage 4 trains all nine junctions in both directions plus chains from every number', () => {
  const steps = kinds(4, 'junctionStep');
  assert.equal(steps.length, 18);
  for (const j of JUNCTIONS) assert.ok(steps.some((s) => s.from === j.from && s.to === j.to && s.dir === 'CW'));
  for (const s of steps) assert.notEqual(pocket(s.from).arc, pocket(s.to).arc);
  assert.equal(kinds(4, 'chain').length, 74);
});

test('a chain question asks for 2 to 5 following numbers in the stated direction', () => {
  const rng = seededRng(4);
  for (const item of kinds(4, 'chain')) {
    const q = buildQuestion(item, { recall: true, rng });
    assert.equal(q.answerType, 'sequence');
    assert.ok(q.answer.length >= 2 && q.answer.length <= 5, `chain length for ${item.id}`);
    q.answer.forEach((n, i) => assert.equal(n, step(item.n, i + 1, item.dir)));
  }
  assert.equal(itemLabel(itemById('ch:9:CW')), 'Chain from 9 CW');
});

test('chain multiple choice has four distinct orderings including the right one', () => {
  const q = buildQuestion(itemById('ch:7:CW'), { recall: false, rng: seededRng(8) });
  assert.equal(q.options.length, 4);
  assert.ok(q.options.some((o) => isCorrectAnswer(q, o.value)));
});

test('stage 5 distance-step: n is 2..4 for near items and 5..9 for far items, both directions', () => {
  const rng = seededRng(5);
  const items = kinds(5, 'distStep');
  assert.equal(items.length, 37 * 2 * 2);
  for (const item of items) {
    const q = buildQuestion(item, { recall: false, rng });
    const k = distance(item.n, q.answer, item.dir);
    assert.ok(item.band === 'near' ? k >= 2 && k <= 4 : k >= 5 && k <= 9, `${item.id} gave ${k}`);
    assert.deepEqual(q.wheel.revealed, [item.n]);
  }
});

test('distance-count answer is the shortest distance and its direction; target stays hidden', () => {
  const rng = seededRng(6);
  for (const item of kinds(5, 'distCount')) {
    const q = buildQuestion(item, { recall: false, rng });
    const target = q.prompt.filter((p) => p.n !== undefined)[1].n;
    const { pockets, direction } = shortestDistance(item.n, target);
    assert.equal(q.answer, `${pockets}:${direction}`);
    assert.ok(pockets >= 2 && pockets <= 9);
    assert.equal(q.options.length, 4);
    assert.ok(!q.wheel.revealed.includes(target));
  }
  const recall = buildQuestion(kinds(5, 'distCount')[0], { recall: true, rng });
  assert.equal(recall.options.length, 16);
});

test('±4 neighbors: eight correct numbers among near distractors, order does not matter', () => {
  const q = buildQuestion(itemById('nb:0'), { recall: false, rng: seededRng(7) });
  assert.equal(q.answerType, 'multi');
  assert.deepEqual([...q.answer].sort((a, b) => a - b), [3, 12, 15, 19, 26, 32, 35, 4].sort((a, b) => a - b));
  assert.equal(q.options.length, 14);
  for (const o of q.options) assert.ok(shortestDistance(0, o.value).pockets <= 8);
  assert.ok(isCorrectAnswer(q, [4, 19, 15, 32, 26, 3, 35, 12]));
  assert.ok(!isCorrectAnswer(q, [4, 19, 15, 32, 26, 3, 35]));
});

test('stage 6 position: one visible anchor that is never the asked pocket; tap questions use the wheel', () => {
  const rng = seededRng(9);
  assert.equal(kinds(6, 'posName').length, 37);
  assert.equal(kinds(6, 'posTap').length, 37);
  for (const item of stageItems(6)) {
    const q = buildQuestion(item, { recall: true, rng });
    assert.equal(q.wheel.view, 'full');
    assert.equal(q.wheel.revealed.length, 1);
    assert.notEqual(q.wheel.revealed[0], item.n);
    assert.equal(q.answer, item.n);
    assert.equal(q.answerType, item.kind === 'posTap' ? 'tap' : 'keypad');
  }
});

test('benchmark order: every number except the anchor exactly once', () => {
  const { anchor, order } = benchmarkOrder(seededRng(3));
  assert.equal(order.length, 36);
  assert.equal(new Set(order).size, 36);
  assert.ok(!order.includes(anchor));
});

test('benchmark is available once stage 4 is unlocked and keeps history with a personal best', () => {
  let p = defaultProgress(NOW);
  assert.equal(benchmarkAvailable(p), false);
  p = { ...p, unlocked: [1, 2, 3, 4] };
  assert.equal(benchmarkAvailable(p), true);
  p = recordBenchmark(p, { at: NOW, ms: 300_000, errors: 6 });
  p = recordBenchmark(p, { at: NOW + 1, ms: 250_000, errors: 2 });
  p = recordBenchmark(p, { at: NOW + 2, ms: 200_000, errors: 4 });
  assert.equal(p.benchmark.length, 3);
  assert.deepEqual(benchmarkBest(p), { at: NOW + 1, ms: 250_000, errors: 2 });
});

test('level 1 is mastered only with a benchmark of at most 2 errors and stage 8 passed', () => {
  let p = recordBenchmark(defaultProgress(NOW), { at: NOW, ms: 1, errors: 2 });
  assert.equal(level1Mastered(p), false);
  p = { ...p, completed: [8] };
  assert.equal(level1Mastered(p), true);
  assert.equal(level1Mastered({ ...p, benchmark: [{ at: NOW, ms: 1, errors: 3 }] }), false);
});

test('mastery bars: wheel mastery, CW, CCW, distance, spatial — and nothing about shades', () => {
  let p = defaultProgress(NOW);
  p = recordAnswer(p, { item: itemById('ds:0:CW:near'), stage: 5, ok: true, latencyMs: 1, now: NOW });
  p = recordAnswer(p, { item: itemById('ds:0:CW:near'), stage: 5, ok: false, latencyMs: 1, now: NOW });
  p = recordAnswer(p, { item: itemById('pt:17'), stage: 6, ok: true, latencyMs: 1, now: NOW });
  const bars = masteryBars(p);
  assert.deepEqual(bars.map((b) => b.label), ['Wheel mastery', 'CW recognition', 'CCW recognition', 'Distance', 'Spatial recognition']);
  assert.equal(bars[3].value, 0.5);
  assert.equal(bars[4].value, 1);
  assert.equal(bars[0].value, 0);
});
