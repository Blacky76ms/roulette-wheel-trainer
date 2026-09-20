// Wheel: data + geometry for the European single-zero wheel.
// Everything below is generated from SEQUENCE; nothing else is hand-coded per pocket.

export const SEQUENCE = Object.freeze([
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]);

export const POCKET_COUNT = SEQUENCE.length;
export const POCKET_ANGLE = 360 / POCKET_COUNT;
export const DIRECTIONS = Object.freeze(['CW', 'CCW']);

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// Sectors and arcs are declared as clockwise runs: [first number, length].
const SECTOR_SPANS = {
  voisins: { name: 'Voisins du Zéro', short: 'Voisins', spans: [[22, 17]] },
  tiers: { name: 'Tiers du Cylindre', short: 'Tiers', spans: [[27, 12]] },
  orphelins: { name: 'Orphelins', short: 'Orphelins', spans: [[17, 3], [1, 5]] },
  zerospiel: { name: 'Zero-Spiel', short: 'Zero-Spiel', spans: [[12, 7]] },
};
export const MAIN_SECTORS = Object.freeze(['voisins', 'tiers', 'orphelins']);

const ARC_START = 22;
const ARC_LENGTHS = [4, 4, 4, 5, 3, 4, 4, 4, 5];

const mod = (n) => ((n % POCKET_COUNT) + POCKET_COUNT) % POCKET_COUNT;
const INDEX_OF = new Map(SEQUENCE.map((value, index) => [value, index]));

function indexOf(value) {
  const index = INDEX_OF.get(value);
  if (index === undefined) throw new RangeError(`Unknown wheel number: ${value}`);
  return index;
}

function run(first, length) {
  const start = indexOf(first);
  return Array.from({ length }, (_, i) => SEQUENCE[mod(start + i)]);
}

function sign(direction) {
  if (direction === 'CW') return 1;
  if (direction === 'CCW') return -1;
  throw new RangeError(`Unknown direction: ${direction}`);
}

export const SECTORS = Object.freeze(Object.fromEntries(
  Object.entries(SECTOR_SPANS).map(([id, s]) => {
    const runs = s.spans.map(([first, length]) => run(first, length));
    return [id, Object.freeze({ id, name: s.name, short: s.short, runs, numbers: runs.flat() })];
  }),
));

export function sectorRuns(sectorId) {
  const sector = SECTORS[sectorId];
  if (!sector) throw new RangeError(`Unknown sector: ${sectorId}`);
  return sector.runs;
}

function mainSectorOf(value) {
  return MAIN_SECTORS.find((id) => SECTORS[id].numbers.includes(value));
}

export const ARCS = Object.freeze((() => {
  let first = indexOf(ARC_START);
  return ARC_LENGTHS.map((length, i) => {
    const numbers = run(SEQUENCE[first], length);
    first = mod(first + length);
    return Object.freeze({ id: `A${i + 1}`, numbers, sector: mainSectorOf(numbers[0]) });
  });
})());

export const JUNCTIONS = Object.freeze(ARCS.map((arc, i) => {
  const nextArc = ARCS[(i + 1) % ARCS.length];
  return Object.freeze({ from: arc.numbers.at(-1), to: nextArc.numbers[0], arcs: [arc.id, nextArc.id] });
}));

function colorOf(value) {
  if (value === 0) return 'green';
  return RED_NUMBERS.has(value) ? 'red' : 'black';
}

export const POCKETS = Object.freeze(SEQUENCE.map((value, index) => Object.freeze({
  value,
  index,
  angle: index * POCKET_ANGLE,
  color: colorOf(value),
  previous: SEQUENCE[mod(index - 1)],
  next: SEQUENCE[mod(index + 1)],
  arc: ARCS.find((a) => a.numbers.includes(value)).id,
  sectors: Object.keys(SECTORS).filter((id) => SECTORS[id].numbers.includes(value)),
})));

export function pocket(value) {
  return POCKETS[indexOf(value)];
}

export function arcById(id) {
  const arc = ARCS.find((a) => a.id === id);
  if (!arc) throw new RangeError(`Unknown arc: ${id}`);
  return arc;
}

export function step(value, n, direction) {
  return SEQUENCE[mod(indexOf(value) + sign(direction) * n)];
}

export function neighbors(value, n) {
  const cw = Array.from({ length: n }, (_, i) => step(value, i + 1, 'CW'));
  const ccw = Array.from({ length: n }, (_, i) => step(value, n - i, 'CCW'));
  return { ccw, cw };
}

export function distance(a, b, direction) {
  return mod(sign(direction) * (indexOf(b) - indexOf(a)));
}

export function shortestDistance(a, b) {
  const cw = distance(a, b, 'CW');
  const ccw = distance(a, b, 'CCW');
  return cw <= ccw ? { pockets: cw, direction: 'CW' } : { pockets: ccw, direction: 'CCW' };
}
