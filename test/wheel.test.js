import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEQUENCE, POCKETS, ARCS, SECTORS, JUNCTIONS, pocket,
  neighbors, distance, shortestDistance, step, sectorRuns,
} from '../src/wheel.js';

const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

test('sequence has 37 unique numbers 0..36 starting 0, 32 and ending 26', () => {
  assert.equal(SEQUENCE.length, 37);
  assert.equal(new Set(SEQUENCE).size, 37);
  assert.deepEqual(SEQUENCE.slice(0, 3), [0, 32, 15]);
  assert.equal(SEQUENCE[36], 26);
});

test('pocket model is circular: 26 is followed by 0, 0 by 32', () => {
  assert.equal(pocket(26).next, 0);
  assert.equal(pocket(0).previous, 26);
  assert.equal(pocket(0).next, 32);
});

test('colors: 0 green, listed reds red, all others black', () => {
  assert.equal(pocket(0).color, 'green');
  for (const p of POCKETS) {
    if (p.value === 0) continue;
    assert.equal(p.color, RED.includes(p.value) ? 'red' : 'black', `color of ${p.value}`);
  }
});

test('colors alternate around the ring apart from zero', () => {
  for (const p of POCKETS) {
    if (p.value === 0 || p.next === 0) continue;
    assert.notEqual(p.color, pocket(p.next).color, `${p.value} vs ${p.next}`);
  }
});

test('angle is index * 360/37', () => {
  assert.equal(pocket(0).angle, 0);
  assert.ok(Math.abs(pocket(32).angle - 360 / 37) < 1e-9);
});

test('sector sizes: Voisins 17, Tiers 12, Orphelins 8, Zero-Spiel 7', () => {
  const size = (id) => POCKETS.filter((p) => p.sectors.includes(id)).length;
  assert.equal(size('voisins'), 17);
  assert.equal(size('tiers'), 12);
  assert.equal(size('orphelins'), 8);
  assert.equal(size('zerospiel'), 7);
});

test('every pocket has exactly one main sector; zero-spiel is a subset of voisins', () => {
  for (const p of POCKETS) {
    const main = p.sectors.filter((s) => s !== 'zerospiel');
    assert.equal(main.length, 1, `main sector of ${p.value}`);
    if (p.sectors.includes('zerospiel')) assert.ok(p.sectors.includes('voisins'));
  }
  assert.ok(SECTORS.orphelins.name.length > 0);
});

test('sector runs are derived from the sequence, clockwise', () => {
  assert.deepEqual(sectorRuns('voisins').map((r) => [r[0], r.at(-1)]), [[22, 25]]);
  assert.deepEqual(sectorRuns('tiers').map((r) => [r[0], r.at(-1)]), [[27, 33]]);
  assert.deepEqual(sectorRuns('orphelins').map((r) => [r[0], r.at(-1)]), [[17, 6], [1, 9]]);
  assert.deepEqual(sectorRuns('zerospiel').map((r) => [r[0], r.at(-1)]), [[12, 15]]);
});

test('nine arcs partition the ring and lie inside one sector each', () => {
  assert.equal(ARCS.length, 9);
  assert.deepEqual(ARCS.find((a) => a.id === 'A4').numbers, [19, 4, 21, 2, 25]);
  assert.deepEqual(ARCS.find((a) => a.id === 'A9').numbers, [1, 20, 14, 31, 9]);
  assert.equal(ARCS.flatMap((a) => a.numbers).length, 37);
  for (const a of ARCS) {
    for (const n of a.numbers) {
      assert.equal(pocket(n).arc, a.id);
      assert.ok(pocket(n).sectors.includes(a.sector), `${n} in ${a.sector}`);
    }
  }
});

test('junctions are the nine arc boundaries, e.g. 7|28, 25|17, 9|22', () => {
  assert.equal(JUNCTIONS.length, 9);
  const has = (a, b) => JUNCTIONS.some((j) => j.from === a && j.to === b);
  assert.ok(has(7, 28));
  assert.ok(has(25, 17));
  assert.ok(has(9, 22));
});

test('neighbors returns n numbers per side, CCW side ordered nearest-last', () => {
  assert.deepEqual(neighbors(17, 1), { ccw: [25], cw: [34] });
  assert.deepEqual(neighbors(0, 2), { ccw: [3, 26], cw: [32, 15] });
});

test('distance counts pockets in the given direction', () => {
  assert.equal(distance(0, 32, 'CW'), 1);
  assert.equal(distance(0, 32, 'CCW'), 36);
  assert.equal(distance(26, 0, 'CW'), 1);
  assert.equal(distance(5, 5, 'CW'), 0);
});

test('shortestDistance gives pockets and direction', () => {
  assert.deepEqual(shortestDistance(0, 26), { pockets: 1, direction: 'CCW' });
  assert.deepEqual(shortestDistance(0, 15), { pockets: 2, direction: 'CW' });
});

test('step walks n pockets CW or CCW with wrap-around', () => {
  assert.equal(step(26, 1, 'CW'), 0);
  assert.equal(step(0, 1, 'CCW'), 26);
  assert.equal(step(17, 4, 'CW'), 13);
  assert.equal(step(17, 37, 'CCW'), 17);
});

test('unknown numbers are rejected', () => {
  assert.throws(() => pocket(37), /unknown/i);
  assert.throws(() => step(17, 1, 'UP'), /direction/i);
});
