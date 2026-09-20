import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageItems, itemById, itemLabel } from '../src/items.js';
import { buildQuestion, distractors, isCorrectAnswer } from '../src/questions.js';
import { pocket, distance, shortestDistance, ARCS } from '../src/wheel.js';

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

test('stage 2 has 37 sector-membership items and 20 sector-edge items', () => {
  const items = stageItems(2);
  assert.equal(items.filter((i) => i.kind === 'sectorMember').length, 37);
  assert.equal(items.filter((i) => i.kind === 'sectorEdge').length, 20);
});

test('sector-edge items are split evenly between CW and CCW', () => {
  const edges = stageItems(2).filter((i) => i.kind === 'sectorEdge');
  assert.equal(edges.filter((i) => i.dir === 'CW').length, 10);
  assert.equal(edges.filter((i) => i.dir === 'CCW').length, 10);
});

test('sector membership is not introduced one whole sector at a time', () => {
  const firstSix = stageItems(2).filter((i) => i.kind === 'sectorMember').slice(0, 6);
  const sectors = new Set(firstSix.map((i) => pocket(i.n).sectors.find((s) => s !== 'zerospiel')));
  assert.equal(sectors.size, 3);
});

test('stage 3 trains every in-arc neighbor pair in both directions, never across a junction', () => {
  const steps = stageItems(3).filter((i) => i.kind === 'arcStep');
  assert.equal(steps.length, (37 - 9) * 2);
  for (const s of steps) {
    assert.equal(distance(s.from, s.to, s.dir), 1);
    assert.equal(pocket(s.from).arc, pocket(s.to).arc);
  }
});

test('stage 3 has a missing-number item per pocket and a complete-the-arc item per arc and direction', () => {
  const items = stageItems(3);
  assert.equal(items.filter((i) => i.kind === 'arcMissing').length, 37);
  assert.equal(items.filter((i) => i.kind === 'arcComplete').length, 18);
});

test('item ids are unique and resolvable', () => {
  const all = [...stageItems(2), ...stageItems(3)];
  assert.equal(new Set(all.map((i) => i.id)).size, all.length);
  assert.deepEqual(itemById(all[5].id), all[5]);
  assert.equal(itemById('nope'), null);
});

test('itemLabel gives a readable weak-spot label', () => {
  const stepItem = stageItems(3).find((i) => i.kind === 'arcStep' && i.from === 27 && i.dir === 'CW');
  assert.equal(itemLabel(stepItem), '27 → 13');
});

test('distractors are unique near neighbors (within 4 pockets) or same-color numbers', () => {
  const rng = seededRng(7);
  for (let n = 0; n <= 36; n++) {
    const prompt = pocket(n).previous;
    const d = distractors(n, [prompt], rng, 3);
    assert.equal(d.length, 3);
    assert.equal(new Set(d).size, 3);
    for (const x of d) {
      assert.notEqual(x, n);
      assert.notEqual(x, prompt);
      const near = shortestDistance(n, x).pockets <= 4;
      const sameColor = pocket(x).color === pocket(n).color;
      assert.ok(near || sameColor, `${x} is a fair distractor for ${n}`);
    }
  }
});

test('arcStep multiple choice: 4 options including the answer, prompt number revealed only', () => {
  const item = stageItems(3).find((i) => i.kind === 'arcStep' && i.from === 17 && i.dir === 'CW');
  const q = buildQuestion(item, { recall: false, rng: seededRng(1) });
  assert.equal(q.answerType, 'choice');
  assert.equal(q.options.length, 4);
  assert.ok(q.options.some((o) => o.value === 34));
  assert.equal(q.answer, 34);
  assert.deepEqual(q.wheel.revealed, [17]);
  assert.equal(q.wheel.view, 'arc');
  assert.ok(q.prompt.some((p) => p.dir === 'CW'), 'direction is labelled in the prompt');
});

test('arcStep recall uses the keypad and offers no options', () => {
  const item = stageItems(3).find((i) => i.kind === 'arcStep' && i.from === 34 && i.dir === 'CCW');
  const q = buildQuestion(item, { recall: true, rng: seededRng(1) });
  assert.equal(q.answerType, 'keypad');
  assert.equal(q.options, null);
  assert.equal(q.answer, 17);
});

test('sectorMember always offers the three main sectors and never a color', () => {
  const q = buildQuestion(itemById('sm:17'), { recall: true, rng: seededRng(1) });
  assert.equal(q.answerType, 'choice');
  assert.deepEqual(q.options.map((o) => o.value).sort(), ['orphelins', 'tiers', 'voisins']);
  assert.equal(q.answer, 'orphelins');
});

test('sectorEdge: first number of Tiers going CW is 27, going CCW is 33', () => {
  const edges = stageItems(2).filter((i) => i.kind === 'sectorEdge' && i.sector === 'tiers' && i.edge === 'first');
  const cw = buildQuestion(edges.find((i) => i.dir === 'CW'), { recall: false, rng: seededRng(3) });
  const ccw = buildQuestion(edges.find((i) => i.dir === 'CCW'), { recall: false, rng: seededRng(3) });
  assert.equal(cw.answer, 27);
  assert.equal(ccw.answer, 33);
  assert.equal(cw.wheel.view, 'full');
  assert.equal(cw.wheel.band.length, 12);
});

test('arcMissing hides exactly the answer inside its arc', () => {
  const q = buildQuestion(itemById('am:21'), { recall: false, rng: seededRng(5) });
  assert.equal(q.answer, 21);
  assert.deepEqual(q.wheel.unknown, [21]);
  assert.deepEqual([...q.wheel.revealed].sort((a, b) => a - b), [2, 4, 19, 25]);
});

test('arcComplete recall expects the rest of the arc in order, CW and CCW', () => {
  const cw = buildQuestion(itemById('ac:A4:CW'), { recall: true, rng: seededRng(2) });
  assert.equal(cw.answerType, 'sequence');
  assert.deepEqual(cw.answer, [4, 21, 2, 25]);
  assert.deepEqual(cw.wheel.revealed, [19]);
  const ccw = buildQuestion(itemById('ac:A4:CCW'), { recall: true, rng: seededRng(2) });
  assert.deepEqual(ccw.answer, [2, 21, 4, 19]);
  assert.deepEqual(ccw.wheel.revealed, [25]);
});

test('arcComplete multiple choice offers distinct orderings including the right one, for every arc', () => {
  for (const arc of ARCS) {
    const q = buildQuestion(itemById(`ac:${arc.id}:CW`), { recall: false, rng: seededRng(9) });
    assert.equal(q.answerType, 'choice');
    assert.equal(q.options.length, 4, arc.id);
    const keys = q.options.map((o) => o.value.join(','));
    assert.equal(new Set(keys).size, 4);
    assert.ok(keys.includes(arc.numbers.slice(1).join(',')));
  }
});

test('isCorrectAnswer compares numbers, sector ids and sequences', () => {
  assert.ok(isCorrectAnswer({ answer: 34 }, 34));
  assert.ok(!isCorrectAnswer({ answer: 34 }, 17));
  assert.ok(isCorrectAnswer({ answer: 'tiers' }, 'tiers'));
  assert.ok(isCorrectAnswer({ answer: [4, 21] }, [4, 21]));
  assert.ok(!isCorrectAnswer({ answer: [4, 21] }, [21, 4]));
});

test('no question ever asks about or offers a color', () => {
  const rng = seededRng(11);
  for (const item of [...stageItems(2), ...stageItems(3)]) {
    for (const recall of [false, true]) {
      const text = JSON.stringify(buildQuestion(item, { recall, rng })).toLowerCase();
      assert.ok(!/colou?r|"red"|"black"|"green"/.test(text), item.id);
    }
  }
});

test('feedback lights the pockets involved and states the relation', () => {
  const item = stageItems(3).find((i) => i.kind === 'arcStep' && i.from === 17 && i.dir === 'CW');
  const q = buildQuestion(item, { recall: false, rng: seededRng(1) });
  assert.deepEqual(q.feedback.highlight, [17, 34]);
  assert.deepEqual(q.feedback.relation.filter((p) => p.n !== undefined).map((p) => p.n), [17, 34]);
});
