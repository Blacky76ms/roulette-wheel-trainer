// Blank Wheel benchmark: one anchor is given, every other number is placed once, in random order.

import { SEQUENCE } from './wheel.js';
import { shuffled } from './questions.js';

export function benchmarkOrder(rng) {
  const anchor = SEQUENCE[Math.floor(rng() * SEQUENCE.length)];
  return { anchor, order: shuffled(SEQUENCE.filter((n) => n !== anchor), rng) };
}
