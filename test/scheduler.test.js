import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newItemState, review, pickNext, requeueMissed, weakSpots, DAY_MS } from '../src/scheduler.js';

const NOW = 1_800_000_000_000;
const rngOf = (...values) => { let i = 0; return () => values[i++ % values.length]; };

test('a new item starts in box 1 and is due immediately', () => {
  const s = newItemState();
  assert.equal(s.box, 1);
  assert.ok(s.due <= NOW);
  assert.equal(s.attempts, 0);
});

test('a correct answer moves the item up one box and schedules it days ahead', () => {
  const s1 = review(newItemState(), true, NOW, 1200);
  assert.equal(s1.box, 2);
  assert.equal(s1.due, NOW + 1 * DAY_MS);
  const s2 = review(s1, true, NOW, 900);
  assert.equal(s2.box, 3);
  assert.equal(s2.due, NOW + 3 * DAY_MS);
});

test('box never exceeds 5 and box 5 comes back after 14 days', () => {
  let s = newItemState();
  for (let i = 0; i < 8; i++) s = review(s, true, NOW, 1000);
  assert.equal(s.box, 5);
  assert.equal(s.due, NOW + 14 * DAY_MS);
});

test('a wrong answer returns the item to box 1, due now, and counts the error', () => {
  const high = review(review(newItemState(), true, NOW, 1000), true, NOW, 1000);
  const s = review(high, false, NOW, 3000);
  assert.equal(s.box, 1);
  assert.equal(s.due, NOW);
  assert.equal(s.errors, 1);
  assert.equal(s.attempts, 3);
  assert.equal(s.correct, 2);
});

test('review does not mutate its input and logs latency (last 10 kept)', () => {
  const s0 = newItemState();
  const frozen = Object.freeze({ ...s0, lat: Object.freeze([...s0.lat]) });
  let s = review(frozen, true, NOW, 1500);
  assert.deepEqual(s.lat, [1500]);
  for (let i = 0; i < 12; i++) s = review(s, true, NOW, i);
  assert.equal(s.lat.length, 10);
  assert.equal(s.lat.at(-1), 11);
});

test('a missed item is requeued 3 to 5 questions later', () => {
  assert.deepEqual(requeueMissed([], 'x', 10, rngOf(0)), [{ id: 'x', at: 13 }]);
  assert.deepEqual(requeueMissed([], 'x', 10, rngOf(0.99)), [{ id: 'x', at: 15 }]);
  const q = requeueMissed([{ id: 'x', at: 12 }], 'x', 10, rngOf(0));
  assert.equal(q.length, 1, 'no duplicate queue entries');
});

test('pickNext serves a requeued miss once its turn has come', () => {
  const ids = ['a', 'b', 'c'];
  const queue = [{ id: 'c', at: 5 }];
  const early = pickNext({ ids, states: {}, now: NOW, queue, asked: 4, lastId: null, rng: rngOf(0) });
  assert.equal(early, 'a');
  const onTime = pickNext({ ids, states: {}, now: NOW, queue, asked: 5, lastId: null, rng: rngOf(0) });
  assert.equal(onTime, 'c');
});

test('pickNext prefers due seen items (lowest box first) over new items', () => {
  const ids = ['new1', 'seenHigh', 'seenLow'];
  const states = {
    seenHigh: { ...newItemState(), box: 3, due: NOW - 1, attempts: 4 },
    seenLow: { ...newItemState(), box: 1, due: NOW - 1, attempts: 2 },
  };
  assert.equal(pickNext({ ids, states, now: NOW, queue: [], asked: 0, lastId: null, rng: rngOf(0) }), 'seenLow');
});

test('pickNext introduces new items in catalog order when nothing is due', () => {
  const ids = ['a', 'b'];
  const states = { a: { ...newItemState(), box: 2, due: NOW + DAY_MS, attempts: 1 } };
  assert.equal(pickNext({ ids, states, now: NOW, queue: [], asked: 0, lastId: null, rng: rngOf(0) }), 'b');
});

test('pickNext falls back to the earliest-due item and avoids repeating the last one', () => {
  const ids = ['a', 'b'];
  const states = {
    a: { ...newItemState(), box: 2, due: NOW + DAY_MS, attempts: 1 },
    b: { ...newItemState(), box: 3, due: NOW + 3 * DAY_MS, attempts: 1 },
  };
  const args = { ids, states, now: NOW, queue: [], asked: 0, rng: rngOf(0) };
  assert.equal(pickNext({ ...args, lastId: null }), 'a');
  assert.equal(pickNext({ ...args, lastId: 'a' }), 'b');
});

test('weakSpots lists the items with the most errors first', () => {
  const states = {
    a: { ...newItemState(), errors: 1 },
    b: { ...newItemState(), errors: 3 },
    c: { ...newItemState(), errors: 0 },
  };
  assert.deepEqual(weakSpots(states, 5), [{ id: 'b', errors: 3 }, { id: 'a', errors: 1 }]);
});
