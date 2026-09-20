// Items: the catalog of things the scheduler tracks, generated from the wheel model.
// Catalog order is introduction order: chunk by chunk, never one answer many times in a row.

import { ARCS, SECTORS, MAIN_SECTORS, DIRECTIONS, JUNCTIONS, SEQUENCE, pocket } from './wheel.js';

const ARROW = { CW: '→', CCW: '←' };

function interleave(lists) {
  const longest = Math.max(...lists.map((l) => l.length));
  return Array.from({ length: longest }, (_, i) => lists.map((l) => l[i]))
    .flat()
    .filter((x) => x !== undefined);
}

function sectorMemberItems() {
  const bySector = MAIN_SECTORS.map((id) => SECTORS[id].numbers);
  return interleave(bySector).map((n) => ({ id: `sm:${n}`, kind: 'sectorMember', dir: null, n }));
}

function sectorEdgeItems() {
  return Object.values(SECTORS).flatMap((sector) => sector.runs.flatMap((_, run) => (
    ['first', 'last'].flatMap((edge) => DIRECTIONS.map((dir) => ({
      id: `se:${sector.id}:${run}:${edge}:${dir}`, kind: 'sectorEdge', dir, sector: sector.id, run, edge,
    })))
  )));
}

function arcItems(arc) {
  const pairs = arc.numbers.slice(0, -1).map((n, i) => [n, arc.numbers[i + 1]]);
  const steps = pairs.flatMap(([a, b]) => [
    { id: `as:${a}>${b}`, kind: 'arcStep', dir: 'CW', from: a, to: b },
    { id: `as:${b}>${a}`, kind: 'arcStep', dir: 'CCW', from: b, to: a },
  ]);
  const missing = arc.numbers.map((n) => ({ id: `am:${n}`, kind: 'arcMissing', dir: null, n, arc: arc.id }));
  const complete = DIRECTIONS.map((dir) => ({ id: `ac:${arc.id}:${dir}`, kind: 'arcComplete', dir, arc: arc.id }));
  return [...steps, ...missing, ...complete];
}

function junctionItems() {
  return JUNCTIONS.flatMap((j) => [
    { id: `js:${j.from}>${j.to}`, kind: 'junctionStep', dir: 'CW', from: j.from, to: j.to },
    { id: `js:${j.to}>${j.from}`, kind: 'junctionStep', dir: 'CCW', from: j.to, to: j.from },
  ]);
}

// Chains start at the junctions (where arcs must fuse), then everywhere else.
function chainItems() {
  const junctionFirst = [...new Set([...JUNCTIONS.map((j) => j.from), ...SEQUENCE])];
  return junctionFirst.flatMap((n) => DIRECTIONS.map((dir) => ({ id: `ch:${n}:${dir}`, kind: 'chain', dir, n })));
}

function distanceItems() {
  const steps = ['near', 'far'].flatMap((band) => SEQUENCE.flatMap((n) => DIRECTIONS.map((dir) => (
    { id: `ds:${n}:${dir}:${band}`, kind: 'distStep', dir, n, band }))));
  const counts = SEQUENCE.map((n) => ({ id: `dc:${n}`, kind: 'distCount', dir: null, n }));
  const around = SEQUENCE.map((n) => ({ id: `nb:${n}`, kind: 'neighbors', dir: null, n }));
  const nearCount = SEQUENCE.length * DIRECTIONS.length;
  return [...interleave([steps.slice(0, nearCount), counts, around]), ...steps.slice(nearCount)];
}

function positionItems() {
  return interleave([
    SEQUENCE.map((n) => ({ id: `pn:${n}`, kind: 'posName', dir: null, n })),
    SEQUENCE.map((n) => ({ id: `pt:${n}`, kind: 'posTap', dir: null, n })),
  ]);
}

const CATALOG = Object.freeze({
  2: Object.freeze([...sectorMemberItems(), ...sectorEdgeItems()]),
  3: Object.freeze(ARCS.flatMap(arcItems)),
  4: Object.freeze([...junctionItems(), ...chainItems()]),
  5: Object.freeze(distanceItems()),
  6: Object.freeze(positionItems()),
});

export const DISTANCE_KINDS = Object.freeze(['distStep', 'distCount', 'neighbors']);
export const SPATIAL_KINDS = Object.freeze(['posName', 'posTap']);

export function allItems() {
  return Object.values(CATALOG).flat();
}

const BY_ID = new Map(Object.values(CATALOG).flat().map((item) => [item.id, item]));

export function stageItems(stage) {
  return CATALOG[stage] ?? [];
}

export function itemById(id) {
  return BY_ID.get(id) ?? null;
}

export function itemLabel(item) {
  switch (item.kind) {
    case 'sectorMember': return `${item.n} · sector`;
    case 'sectorEdge': return `${SECTORS[item.sector].short} · ${item.edge} ${item.dir}`;
    // Written in ring order, so a CCW step from 13 to 27 reads "27 ← 13".
    case 'junctionStep':
    case 'arcStep': return item.dir === 'CW'
      ? `${item.from} ${ARROW.CW} ${item.to}`
      : `${item.to} ${ARROW.CCW} ${item.from}`;
    case 'arcMissing': return `${item.n} · in arc ${pocket(item.n).arc}`;
    case 'arcComplete': return `Arc ${item.arc} · ${item.dir}`;
    case 'chain': return `Chain from ${item.n} ${item.dir}`;
    case 'distStep': return `${item.n} · ${item.band} ${item.dir}`;
    case 'distCount': return `Distance from ${item.n}`;
    case 'neighbors': return `±4 of ${item.n}`;
    case 'posName': return `Name pocket ${item.n}`;
    case 'posTap': return `Find pocket ${item.n}`;
    default: return item.id;
  }
}
