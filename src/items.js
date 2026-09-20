// Items: the catalog of things the scheduler tracks, generated from the wheel model.
// Catalog order is introduction order: chunk by chunk, never one answer many times in a row.

import { ARCS, SECTORS, MAIN_SECTORS, DIRECTIONS, pocket } from './wheel.js';

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

const CATALOG = Object.freeze({
  2: Object.freeze([...sectorMemberItems(), ...sectorEdgeItems()]),
  3: Object.freeze(ARCS.flatMap(arcItems)),
});

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
    case 'arcStep': return item.dir === 'CW'
      ? `${item.from} ${ARROW.CW} ${item.to}`
      : `${item.to} ${ARROW.CCW} ${item.from}`;
    case 'arcMissing': return `${item.n} · in arc ${pocket(item.n).arc}`;
    case 'arcComplete': return `Arc ${item.arc} · ${item.dir}`;
    default: return item.id;
  }
}
