// Scheduler: Leitner-style spaced repetition (5 boxes). Pure functions only.

export const DAY_MS = 86_400_000;
export const BOX_COUNT = 5;
// Days until an item in box N (1-based) comes back.
const BOX_INTERVAL_DAYS = [0, 1, 3, 7, 14];
const LATENCY_HISTORY = 10;
const REQUEUE_MIN = 3;
const REQUEUE_MAX = 5;

export function newItemState() {
  return { box: 1, due: 0, attempts: 0, correct: 0, errors: 0, lat: [] };
}

export function review(state, isCorrect, now, latencyMs) {
  const box = isCorrect ? Math.min(BOX_COUNT, state.box + 1) : 1;
  return {
    box,
    due: isCorrect ? now + BOX_INTERVAL_DAYS[box - 1] * DAY_MS : now,
    attempts: state.attempts + 1,
    correct: state.correct + (isCorrect ? 1 : 0),
    errors: state.errors + (isCorrect ? 0 : 1),
    lat: [...state.lat, latencyMs].slice(-LATENCY_HISTORY),
  };
}

// In-session requeue: a missed item reappears after 3 to 5 other questions.
export function requeueMissed(queue, id, asked, rng) {
  const gap = REQUEUE_MIN + Math.floor(rng() * (REQUEUE_MAX - REQUEUE_MIN + 1));
  return [...queue.filter((q) => q.id !== id), { id, at: asked + gap }];
}

export function pickNext({ ids, states, now, queue, asked, lastId }) {
  const candidates = ids.filter((id) => id !== lastId);
  const pool = candidates.length > 0 ? candidates : ids;
  const stateOf = (id) => states[id] ?? null;

  const ready = queue.filter((q) => q.at <= asked && pool.includes(q.id)).sort((a, b) => a.at - b.at);
  if (ready.length > 0) return ready[0].id;

  const seen = pool.filter((id) => stateOf(id) && stateOf(id).attempts > 0);
  const due = seen
    .filter((id) => stateOf(id).due <= now)
    .sort((a, b) => stateOf(a).box - stateOf(b).box || stateOf(b).errors - stateOf(a).errors);
  if (due.length > 0) return due[0];

  const fresh = pool.find((id) => !stateOf(id) || stateOf(id).attempts === 0);
  if (fresh !== undefined) return fresh;

  return [...seen].sort((a, b) => stateOf(a).due - stateOf(b).due)[0];
}

export function weakSpots(states, limit) {
  return Object.entries(states)
    .filter(([, s]) => s.errors > 0)
    .sort(([, a], [, b]) => b.errors - a.errors)
    .slice(0, limit)
    .map(([id, s]) => ({ id, errors: s.errors }));
}
