// WheelRenderer: one SVG, two layers. The rotor layer turns with a single rotorAngle;
// the stationary layer never rotates (marker now; diamonds and ball track in later levels).

import { POCKETS, POCKET_ANGLE, pocket } from './wheel.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const R_RIM = 200;
const R_NUM_OUT = 186;
const R_NUM_IN = 140;
const R_POCKET_IN = 98;
const R_TEXT = 163;
const ARC_VIEW_SIZE = 250;
const FULL_VIEW = `${-R_RIM - 6} ${-R_RIM - 6} ${2 * R_RIM + 12} ${2 * R_RIM + 12}`;
const TAP_SLOP_PX = 8;

const toRad = (deg) => ((deg - 90) * Math.PI) / 180;
const polar = (r, deg) => [r * Math.cos(toRad(deg)), r * Math.sin(toRad(deg))];

function svgEl(name, attrs, parent) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (parent) parent.appendChild(node);
  return node;
}

function wedgePath(rOuter, rInner, a0, a1) {
  const [x0, y0] = polar(rOuter, a0);
  const [x1, y1] = polar(rOuter, a1);
  const [x2, y2] = polar(rInner, a1);
  const [x3, y3] = polar(rInner, a0);
  return `M${x0} ${y0}A${rOuter} ${rOuter} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${rInner} ${rInner} 0 0 0 ${x3} ${y3}Z`;
}

function drawPocket(rotor, p) {
  const a0 = p.angle - POCKET_ANGLE / 2;
  const a1 = p.angle + POCKET_ANGLE / 2;
  const g = svgEl('g', { class: `pocket shade-${p.color}`, 'data-n': p.value }, rotor);
  svgEl('path', { class: 'pocket-num', d: wedgePath(R_NUM_OUT, R_NUM_IN, a0, a1) }, g);
  svgEl('path', { class: 'pocket-well', d: wedgePath(R_NUM_IN, R_POCKET_IN, a0, a1) }, g);
  // Radial numerals: the foot of each digit points at the hub, as on a real rotor.
  const text = svgEl('text', { class: 'numeral', transform: `rotate(${p.angle}) translate(0 ${-R_TEXT})` }, g);
  text.textContent = p.value;
  const hidden = svgEl('text', { class: 'numeral-unknown', transform: `rotate(${p.angle}) translate(0 ${-R_TEXT})` }, g);
  hidden.textContent = '?';
  return g;
}

export function createWheel(container, { onTap, onRotate }) {
  const svg = svgEl('svg', { class: 'wheel', viewBox: FULL_VIEW, role: 'img', 'aria-label': 'European roulette wheel' }, container);
  const stationaryBack = svgEl('g', { class: 'layer-stationary' }, svg);
  svgEl('circle', { class: 'rim', r: R_RIM }, stationaryBack);
  const rotor = svgEl('g', { class: 'layer-rotor' }, svg);
  const pockets = new Map(POCKETS.map((p) => [p.value, drawPocket(rotor, p)]));
  svgEl('circle', { class: 'hub', r: R_POCKET_IN }, rotor);
  svgEl('circle', { class: 'hub-cap', r: 30 }, rotor);
  [0, 90, 180, 270].forEach((a) => svgEl('line', { class: 'hub-spoke', x1: 0, y1: -30, x2: 0, y2: -R_POCKET_IN + 8, transform: `rotate(${a})` }, rotor));
  const stationaryFront = svgEl('g', { class: 'layer-stationary' }, svg);
  const marker = svgEl('path', { class: 'marker', d: `M0 ${-R_NUM_OUT + 4}L-7 ${-R_RIM - 4}L7 ${-R_RIM - 4}Z`, visibility: 'hidden' }, stationaryFront);

  let rotorAngle = 0;
  let view = { mode: 'full', focus: 0 };

  function applyView() {
    if (view.mode === 'full') return svg.setAttribute('viewBox', FULL_VIEW);
    const [cx, cy] = polar(R_TEXT - 18, pocket(view.focus).angle + rotorAngle);
    svg.setAttribute('viewBox', `${cx - ARC_VIEW_SIZE / 2} ${cy - ARC_VIEW_SIZE / 2} ${ARC_VIEW_SIZE} ${ARC_VIEW_SIZE}`);
  }

  function setRotorAngle(angle) {
    rotorAngle = ((angle % 360) + 360) % 360;
    rotor.setAttribute('transform', `rotate(${rotorAngle})`);
    applyView();
  }

  function setView(mode, focus) {
    view = { mode, focus: focus ?? view.focus };
    svg.classList.toggle('is-arc', mode === 'arc');
    applyView();
  }

  // Presentation: which numerals show, which pockets carry a band, "?" or highlight.
  function present({ hideNumbers = false, revealed = [], band = [], unknown = [], highlight = [], wrong = [] }) {
    pockets.forEach((g, n) => {
      g.classList.toggle('is-hidden', hideNumbers && !revealed.includes(n));
      g.classList.toggle('is-band', band.includes(n));
      g.classList.toggle('is-unknown', unknown.includes(n));
      g.classList.toggle('is-lit', highlight.includes(n));
      g.classList.toggle('is-wrong', wrong.includes(n));
    });
  }

  function pointerAngle(event) {
    const ctm = svg.getScreenCTM();
    const x = (event.clientX - ctm.e) / ctm.a;
    const y = (event.clientY - ctm.f) / ctm.d;
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  let drag = null;
  svg.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, startPointer: pointerAngle(event), startRotor: rotorAngle, moved: false };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > TAP_SLOP_PX) drag.moved = true;
    if (!drag.moved || !onRotate) return;
    setRotorAngle(drag.startRotor + pointerAngle(event) - drag.startPointer);
    onRotate(rotorAngle);
  });
  svg.addEventListener('pointerup', (event) => {
    const wasTap = drag && !drag.moved;
    drag = null;
    if (!wasTap || !onTap) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.pocket');
    if (hit) onTap(Number(hit.dataset.n));
  });
  svg.addEventListener('pointercancel', () => { drag = null; });

  return {
    setRotorAngle,
    setView,
    present,
    getRotorAngle: () => rotorAngle,
    showMarker: (visible) => marker.setAttribute('visibility', visible ? 'visible' : 'hidden'),
  };
}
