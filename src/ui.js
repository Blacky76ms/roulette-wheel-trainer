// UI helpers: DOM builder and the chips that keep number shading consistent everywhere.

import { SECTORS, pocket } from './wheel.js';

export const STAGES = Object.freeze([
  { n: 1, title: 'Explore', note: 'Drag the wheel, tap numbers' },
  { n: 2, title: 'Sectors', note: 'Voisins · Tiers · Orphelins' },
  { n: 3, title: 'Arcs', note: 'Nine arcs, both directions' },
  { n: 4, title: 'Junctions & full ring', note: 'Coming in the next update' },
  { n: 5, title: 'Distance', note: 'Coming in the next update' },
  { n: 6, title: 'Position', note: 'Coming in the next update' },
  { n: 7, title: 'Segment recognition', note: 'Coming later' },
  { n: 8, title: 'Slow rotation', note: 'Coming later' },
]);
export const PLAYABLE_STAGES = Object.freeze([1, 2, 3]);

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  });
  children.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

// The only way a number is ever shown outside the wheel: always in its own shade.
export function numberChip(n) {
  return h('span', { class: `chip shade-${pocket(n).color}` }, n);
}

export function dirBadge(dir) {
  return h('span', { class: `dir dir-${dir.toLowerCase()}` }, dir === 'CW' ? '↻ CW' : '↺ CCW');
}

export function renderParts(parts) {
  return parts.map((part) => {
    if (typeof part === 'string') return part;
    if (part.n !== undefined) return numberChip(part.n);
    if (part.dir) return dirBadge(part.dir);
    if (part.sector) return h('span', { class: 'sector-name' }, SECTORS[part.sector].short);
    return '';
  });
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function percent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}
