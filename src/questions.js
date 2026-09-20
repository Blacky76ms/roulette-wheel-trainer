// QuestionEngine: turns a catalog item into a concrete question (prompt, options, wheel
// presentation, feedback). Pure; all randomness comes in through rng.
// Prompt parts are strings or tokens: { n } number chip, { dir } direction badge, { sector } label.

import {
  SEQUENCE, SECTORS, MAIN_SECTORS, pocket, arcById, shortestDistance,
} from './wheel.js';

const NEAR_MAX = 4;
const SAME_SHADE_MAX = 9;
const OPTION_COUNT = 4;

export function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomRotorAngle(rng) {
  return Math.floor(rng() * 360);
}

// Wrong options: near neighbors (within 4 pockets) plus a same-shade number. Never random.
export function distractors(answer, exclude, rng, count) {
  const blocked = new Set([answer, ...exclude]);
  const shade = pocket(answer).color;
  const candidates = SEQUENCE.filter((n) => !blocked.has(n));
  const gap = (n) => shortestDistance(answer, n).pockets;
  const near = shuffled(candidates.filter((n) => gap(n) <= NEAR_MAX), rng);
  const sameShade = shuffled(
    candidates.filter((n) => gap(n) > NEAR_MAX && gap(n) <= SAME_SHADE_MAX && pocket(n).color === shade),
    rng,
  );
  const picked = [...near.slice(0, count - 1), ...sameShade.slice(0, 1)];
  const spare = near.slice(count - 1);
  return [...picked, ...spare].slice(0, count);
}

function numberOptions(answer, exclude, rng) {
  const values = [answer, ...distractors(answer, exclude, rng, OPTION_COUNT - 1)];
  return shuffled(values, rng).map((value) => ({ value, label: [{ n: value }] }));
}

function numberQuestion(base, { answer, exclude, recall, rng }) {
  return {
    ...base,
    answer,
    answerType: recall ? 'keypad' : 'choice',
    options: recall ? null : numberOptions(answer, exclude, rng),
  };
}

function ringRelation(from, to, dir) {
  return dir === 'CW' ? [{ n: from }, ' → ', { n: to }] : [{ n: to }, ' ← ', { n: from }];
}

function sectorMemberQuestion(item) {
  const answer = MAIN_SECTORS.find((id) => SECTORS[id].numbers.includes(item.n));
  const run = SECTORS[answer].runs.find((r) => r.includes(item.n));
  return {
    answer,
    answerType: 'choice',
    options: MAIN_SECTORS.map((id) => ({ value: id, label: [{ sector: id }] })),
    prompt: ['Which sector holds ', { n: item.n }, '?'],
    wheel: { view: 'full', focus: item.n, revealed: [item.n], band: [], unknown: [] },
    feedback: { highlight: run, relation: [{ n: item.n }, ' · ', { sector: answer }] },
  };
}

function sectorEdgeQuestion(item, { recall, rng }) {
  const run = SECTORS[item.sector].runs[item.run];
  const startsAtHead = (item.edge === 'first') === (item.dir === 'CW');
  const answer = startsAtHead ? run[0] : run.at(-1);
  const base = {
    prompt: [{ sector: item.sector }, `: ${item.edge} number going `, { dir: item.dir }],
    wheel: { view: 'full', focus: answer, revealed: [], band: run, unknown: [answer] },
    feedback: {
      highlight: [answer],
      relation: [{ sector: item.sector }, ` ${item.edge} `, { dir: item.dir }, ' · ', { n: answer }],
    },
  };
  return numberQuestion(base, { answer, exclude: [], recall, rng });
}

function arcStepQuestion(item, { recall, rng }) {
  const base = {
    prompt: ['Next ', { dir: item.dir }, ' of ', { n: item.from }],
    wheel: { view: 'arc', focus: item.from, revealed: [item.from], band: [], unknown: [item.to] },
    feedback: {
      highlight: item.dir === 'CW' ? [item.from, item.to] : [item.to, item.from],
      relation: ringRelation(item.from, item.to, item.dir),
    },
  };
  return numberQuestion(base, { answer: item.to, exclude: [item.from], recall, rng });
}

function arcMissingQuestion(item, { recall, rng }) {
  const arc = arcById(item.arc);
  const others = arc.numbers.filter((n) => n !== item.n);
  const base = {
    prompt: ['Which number is missing?'],
    wheel: { view: 'arc', focus: arc.numbers[Math.floor(arc.numbers.length / 2)], revealed: others, band: [], unknown: [item.n] },
    feedback: { highlight: arc.numbers, relation: arc.numbers.flatMap((n, i) => (i ? [' ', { n }] : [{ n }])) },
  };
  return numberQuestion(base, { answer: item.n, exclude: others, recall, rng });
}

function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

// Wrong orderings first; if the arc is too short for three, swap in a near neighbor from outside.
function sequenceDistractors(answer, start, rng) {
  const key = (seq) => seq.join(',');
  const reordered = shuffled(permutations(answer).filter((p) => key(p) !== key(answer)), rng);
  const outside = distractors(answer.at(-1), [start, ...answer], rng, OPTION_COUNT);
  const substituted = outside.map((n) => [...answer.slice(0, -1), n]);
  return [...reordered, ...substituted].slice(0, OPTION_COUNT - 1);
}

function arcCompleteQuestion(item, { recall, rng }) {
  const arc = arcById(item.arc);
  const ordered = item.dir === 'CW' ? arc.numbers : [...arc.numbers].reverse();
  const [start, ...answer] = ordered;
  const options = recall ? null : shuffled([answer, ...sequenceDistractors(answer, start, rng)], rng)
    .map((value) => ({ value, label: value.flatMap((n, i) => (i ? [' ', { n }] : [{ n }])) }));
  return {
    answer,
    answerType: recall ? 'sequence' : 'choice',
    options,
    prompt: ['Complete the arc from ', { n: start }, ' going ', { dir: item.dir }],
    wheel: { view: 'arc', focus: arc.numbers[Math.floor(arc.numbers.length / 2)], revealed: [start], band: arc.numbers, unknown: [] },
    feedback: { highlight: arc.numbers, relation: arc.numbers.flatMap((n, i) => (i ? [' ', { n }] : [{ n }])) },
  };
}

const BUILDERS = {
  sectorMember: sectorMemberQuestion,
  sectorEdge: sectorEdgeQuestion,
  arcStep: arcStepQuestion,
  arcMissing: arcMissingQuestion,
  arcComplete: arcCompleteQuestion,
};

export function buildQuestion(item, { recall, rng }) {
  const build = BUILDERS[item.kind];
  if (!build) throw new RangeError(`No question builder for item kind: ${item.kind}`);
  return { itemId: item.id, kind: item.kind, dir: item.dir, ...build(item, { recall, rng }) };
}

export function isCorrectAnswer(question, given) {
  if (Array.isArray(question.answer)) {
    return Array.isArray(given)
      && given.length === question.answer.length
      && given.every((n, i) => n === question.answer[i]);
  }
  return given === question.answer;
}
