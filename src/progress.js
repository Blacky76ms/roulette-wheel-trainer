// ProgressManager (pure part): schema, migrations, scoring rules, export/import format.
// Storage I/O lives in storage.js. Nothing here mutates its input.

import { newItemState, review, DAY_MS } from './scheduler.js';
import { allItems, itemById, DISTANCE_KINDS, SPATIAL_KINDS } from './items.js';

export const SCHEMA_VERSION = 1;
export const APP_ID = 'roulette-wheel-trainer';
export const STAGE_COUNT = 8;
export const XP_PER_CORRECT = 10;
export const XP_FAST_BONUS = 5;
export const EXPLORE_UNLOCK_COUNT = 15;

const STAGE_WINDOW = 20;
const STAGE_PASS = 0.85;
const DIRECTION_PASS = 0.8;
const DIRECTION_MIN_ANSWERS = 5;
const BLOCK_WINDOW = 10;
const BLOCK_RECALL = 0.8;
const RECENT_KEPT = 40;
const BACKUP_STALE_DAYS = 7;
const SESSIONS_KEPT = 200;
// Stages whose difficulty adapts, with their highest level (see SEGMENT_LEVELS, ROTATION_SECONDS).
const ADAPTIVE_MAX_LEVEL = { 7: 4, 8: 3 };
const LEVEL_WINDOW = 10;
const LEVEL_UP = 0.85;
const LEVEL_DOWN = 0.7;
const KIND_LATENCIES_KEPT = 20;
const FAST_MIN_SAMPLES = 5;

export function defaultProgress(now) {
  return {
    schema: SCHEMA_VERSION,
    createdAt: now,
    xp: 0,
    streak: 0,
    bestStreak: 0,
    stage: 1,
    unlocked: [1],
    completed: [],
    explored: [],
    introduced: [],
    items: {},
    blocks: {},
    stages: {},
    dirStats: { CW: { attempts: 0, correct: 0 }, CCW: { attempts: 0, correct: 0 } },
    benchmark: [],
    sessions: [],
    levels: {},
    kindLat: {},
    rt: { best: null, sum: 0, count: 0 },
    lastBackup: null,
    settings: { sound: false, sessionMin: 5, autoNext: true },
  };
}

// One entry per schema step; each takes version N data and returns version N+1 data.
// Migrations only add or reshape. They never drop fields.
const MIGRATIONS = {
  0: (data) => ({ ...data, schema: 1 }),
};

export function migrate(data, now) {
  if (data === null || typeof data !== 'object') throw new TypeError('Progress data must be an object');
  let current = { ...data, schema: data.schema ?? 0 };
  if (current.schema > SCHEMA_VERSION) {
    throw new RangeError('This progress was saved by a newer app version. Update the app first.');
  }
  while (current.schema < SCHEMA_VERSION) current = MIGRATIONS[current.schema](current);
  const defaults = defaultProgress(now);
  return { ...defaults, ...current, settings: { ...defaults.settings, ...current.settings } };
}

const ratio = (list) => (list.length === 0 ? 0 : list.filter((r) => r.ok).length / list.length);
const stageWindow = (progress, stage) => (progress.stages[stage]?.recent ?? []).slice(-STAGE_WINDOW);

export function stageAccuracy(progress, stage) {
  return ratio(stageWindow(progress, stage));
}

export function stagePassed(progress, stage) {
  const recent = stageWindow(progress, stage);
  if (recent.length < STAGE_WINDOW || ratio(recent) < STAGE_PASS) return false;
  return ['CW', 'CCW'].every((dir) => {
    const answers = recent.filter((r) => r.dir === dir);
    return answers.length < DIRECTION_MIN_ANSWERS || ratio(answers) >= DIRECTION_PASS;
  });
}

export function reactionTimeActive(progress, stage) {
  const recent = stageWindow(progress, stage);
  return recent.length >= STAGE_WINDOW && ratio(recent) >= STAGE_PASS;
}

export function isRecallBlock(progress, kind) {
  return progress.blocks[kind]?.recall === true;
}

// Speed and exposure only tighten while accuracy holds, and ease off when it drops.
export function adaptLevel(state, ok, maxLevel) {
  const recent = [...state.recent, ok];
  if (recent.length < LEVEL_WINDOW) return { level: state.level, recent };
  const accuracy = recent.filter(Boolean).length / recent.length;
  if (accuracy >= LEVEL_UP) return { level: Math.min(maxLevel, state.level + 1), recent: [] };
  if (accuracy < LEVEL_DOWN) return { level: Math.max(0, state.level - 1), recent: [] };
  return { level: state.level, recent: recent.slice(1) };
}

export function stageLevel(progress, stage) {
  return progress.levels[stage]?.level ?? 0;
}

function median(list) {
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// "Fast" is relative to the learner's own median for that kind of question.
export function isFastAnswer(progress, item, stage, latencyMs) {
  const history = progress.kindLat[item.kind] ?? [];
  return reactionTimeActive(progress, stage) && history.length >= FAST_MIN_SAMPLES && latencyMs < median(history);
}

function withUnlock(progress, stage) {
  if (stage > STAGE_COUNT || progress.unlocked.includes(stage)) return progress;
  return { ...progress, unlocked: [...progress.unlocked, stage] };
}

function updatedBlock(block, ok) {
  const recent = [...(block?.recent ?? []), { ok }].slice(-BLOCK_WINDOW);
  const reached = recent.length >= BLOCK_WINDOW && ratio(recent) >= BLOCK_RECALL;
  return { recent, recall: block?.recall === true || reached };
}

export function recordAnswer(progress, { item, stage, ok, latencyMs, now }) {
  const streak = ok ? progress.streak + 1 : 0;
  const dir = item.dir;
  const dirStats = dir === null ? progress.dirStats : {
    ...progress.dirStats,
    [dir]: {
      attempts: progress.dirStats[dir].attempts + 1,
      correct: progress.dirStats[dir].correct + (ok ? 1 : 0),
    },
  };
  const recent = [...(progress.stages[stage]?.recent ?? []), { ok, dir }].slice(-RECENT_KEPT);
  const bonus = ok && isFastAnswer(progress, item, stage, latencyMs) ? XP_FAST_BONUS : 0;
  const maxLevel = ADAPTIVE_MAX_LEVEL[stage];
  const levels = maxLevel === undefined ? progress.levels
    : { ...progress.levels, [stage]: adaptLevel(progress.levels[stage] ?? { level: 0, recent: [] }, ok, maxLevel) };
  const rt = !ok ? progress.rt : {
    best: progress.rt.best === null ? latencyMs : Math.min(progress.rt.best, latencyMs),
    sum: progress.rt.sum + latencyMs,
    count: progress.rt.count + 1,
  };
  const kindLat = !ok ? progress.kindLat
    : { ...progress.kindLat, [item.kind]: [...(progress.kindLat[item.kind] ?? []), latencyMs].slice(-KIND_LATENCIES_KEPT) };
  const next = {
    ...progress,
    levels,
    rt,
    kindLat,
    xp: progress.xp + (ok ? XP_PER_CORRECT + bonus : 0),
    streak,
    bestStreak: Math.max(progress.bestStreak, streak),
    items: { ...progress.items, [item.id]: review(progress.items[item.id] ?? newItemState(), ok, now, latencyMs) },
    blocks: { ...progress.blocks, [item.kind]: updatedBlock(progress.blocks[item.kind], ok) },
    stages: { ...progress.stages, [stage]: { recent } },
    dirStats,
  };
  if (!stagePassed(next, stage)) return next;
  const completed = next.completed.includes(stage) ? next.completed : [...next.completed, stage];
  return withUnlock({ ...next, completed }, stage + 1);
}

export function recordExplored(progress, value) {
  if (progress.explored.includes(value)) return progress;
  const next = { ...progress, explored: [...progress.explored, value] };
  return next.explored.length >= EXPLORE_UNLOCK_COUNT ? withUnlock(next, 2) : next;
}

export function isIntroduced(progress, chunkId) {
  return progress.introduced.includes(chunkId);
}

export function markIntroduced(progress, chunkId) {
  if (isIntroduced(progress, chunkId)) return progress;
  return { ...progress, introduced: [...progress.introduced, chunkId] };
}

export function unlockStage(progress, stage) {
  return withUnlock(progress, stage);
}

export function recordSession(progress, session) {
  return { ...progress, sessions: [...progress.sessions, session].slice(-SESSIONS_KEPT) };
}

const BENCHMARK_FROM_STAGE = 4;
const BENCHMARK_MASTERY_ERRORS = 2;
const BENCHMARKS_KEPT = 100;
const MASTERED_BOX = 4;

export function benchmarkAvailable(progress) {
  return progress.unlocked.includes(BENCHMARK_FROM_STAGE);
}

export function recordBenchmark(progress, result) {
  return { ...progress, benchmark: [...progress.benchmark, result].slice(-BENCHMARKS_KEPT) };
}

export function benchmarkBest(progress) {
  return [...progress.benchmark].sort((a, b) => a.errors - b.errors || a.ms - b.ms)[0] ?? null;
}

export function level1Mastered(progress) {
  const best = benchmarkBest(progress);
  return best !== null && best.errors <= BENCHMARK_MASTERY_ERRORS && progress.completed.includes(STAGE_COUNT);
}

function kindAccuracy(progress, kindList) {
  const states = Object.entries(progress.items).filter(([id]) => kindList.includes(itemById(id)?.kind)).map(([, s]) => s);
  const attempts = states.reduce((sum, s) => sum + s.attempts, 0);
  return attempts === 0 ? 0 : states.reduce((sum, s) => sum + s.correct, 0) / attempts;
}

export function masteryBars(progress) {
  const dirRatio = (stat) => (stat.attempts === 0 ? 0 : stat.correct / stat.attempts);
  const mastered = Object.values(progress.items).filter((s) => s.box >= MASTERED_BOX).length;
  return [
    { label: 'Wheel mastery', value: mastered / allItems().length },
    { label: 'CW recognition', value: dirRatio(progress.dirStats.CW) },
    { label: 'CCW recognition', value: dirRatio(progress.dirStats.CCW) },
    { label: 'Distance', value: kindAccuracy(progress, DISTANCE_KINDS) },
    { label: 'Spatial recognition', value: kindAccuracy(progress, SPATIAL_KINDS) },
  ];
}

export function serialize(progress, now) {
  return JSON.stringify({ app: APP_ID, exportedAt: now, progress }, null, 2);
}

export function parseImport(text, now) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SyntaxError('This file is not a valid JSON backup.');
  }
  if (parsed?.app !== APP_ID || typeof parsed.progress !== 'object' || parsed.progress === null) {
    throw new TypeError('This file is not a Roulette Wheel Trainer backup.');
  }
  return migrate(parsed.progress, now);
}

export function backupIsStale(progress, now) {
  if (progress.xp === 0 && Object.keys(progress.items).length === 0) return false;
  return now - (progress.lastBackup ?? progress.createdAt) > BACKUP_STALE_DAYS * DAY_MS;
}
