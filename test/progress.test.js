import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION, defaultProgress, migrate, recordAnswer, recordExplored, stagePassed,
  isRecallBlock, reactionTimeActive, serialize, parseImport, backupIsStale, stageAccuracy,
} from '../src/progress.js';
import { DAY_MS } from '../src/scheduler.js';

const NOW = 1_800_000_000_000;
const item = (dir = 'CW', id = 'as:17>34', kind = 'arcStep') => ({ id, kind, dir });

function answerMany(progress, n, ok, it = item(), stage = 3) {
  let p = progress;
  for (let i = 0; i < n; i++) p = recordAnswer(p, { item: it, stage, ok, latencyMs: 1000, now: NOW });
  return p;
}

test('default progress: schema version, stage 1 unlocked, sound off, 5 minute sessions', () => {
  const p = defaultProgress(NOW);
  assert.equal(p.schema, SCHEMA_VERSION);
  assert.deepEqual(p.unlocked, [1]);
  assert.equal(p.settings.sound, false);
  assert.equal(p.settings.sessionMin, 5);
  assert.equal(p.xp, 0);
});

test('a correct answer gives +10 XP, extends the streak and schedules the item', () => {
  const p = recordAnswer(defaultProgress(NOW), { item: item(), stage: 3, ok: true, latencyMs: 800, now: NOW });
  assert.equal(p.xp, 10);
  assert.equal(p.streak, 1);
  assert.equal(p.items['as:17>34'].box, 2);
  assert.deepEqual(p.items['as:17>34'].lat, [800]);
});

test('a wrong answer gives no XP and resets the streak but keeps the best streak', () => {
  const p = answerMany(answerMany(defaultProgress(NOW), 3, true), 1, false);
  assert.equal(p.xp, 30);
  assert.equal(p.streak, 0);
  assert.equal(p.bestStreak, 3);
  assert.equal(p.items['as:17>34'].errors, 1);
});

test('recordAnswer does not mutate the previous progress object', () => {
  const p0 = defaultProgress(NOW);
  const snapshot = JSON.stringify(p0);
  recordAnswer(p0, { item: item(), stage: 3, ok: true, latencyMs: 800, now: NOW });
  assert.equal(JSON.stringify(p0), snapshot);
});

test('CW and CCW answers are tracked separately', () => {
  let p = answerMany(defaultProgress(NOW), 4, true, item('CW'));
  p = answerMany(p, 2, false, item('CCW', 'as:34>17'));
  assert.deepEqual(p.dirStats.CW, { attempts: 4, correct: 4 });
  assert.deepEqual(p.dirStats.CCW, { attempts: 2, correct: 0 });
});

test('stage is not passed before 20 answers', () => {
  const p = answerMany(defaultProgress(NOW), 19, true);
  assert.equal(stagePassed(p, 3), false);
});

test('stage passes at 85% over the last 20 with both directions at 80% and unlocks the next stage', () => {
  let p = defaultProgress(NOW);
  p = answerMany(p, 9, true, item('CW'));
  p = answerMany(p, 1, false, item('CW'));
  p = answerMany(p, 9, true, item('CCW', 'as:34>17'));
  p = answerMany(p, 1, false, item('CCW', 'as:34>17'));
  assert.equal(stagePassed(p, 3), true);
  assert.ok(p.unlocked.includes(4));
  assert.ok(p.completed.includes(3));
});

test('stage does not pass when one direction is below 80% even if the total is 85%', () => {
  let p = defaultProgress(NOW);
  p = answerMany(p, 14, true, item('CW'));
  p = answerMany(p, 3, true, item('CCW', 'as:34>17'));
  p = answerMany(p, 3, false, item('CCW', 'as:34>17'));
  assert.equal(stageAccuracy(p, 3), 0.85);
  assert.equal(stagePassed(p, 3), false);
});

test('only the last 20 answers of a stage count', () => {
  const p = answerMany(answerMany(defaultProgress(NOW), 10, false), 20, true);
  assert.equal(stageAccuracy(p, 3), 1);
});

test('a block switches to recall at 80% over its last 10 answers and stays there', () => {
  let p = answerMany(defaultProgress(NOW), 9, true);
  assert.equal(isRecallBlock(p, 'arcStep'), false);
  p = answerMany(p, 1, false);
  assert.equal(isRecallBlock(p, 'arcStep'), true);
  p = answerMany(p, 5, false);
  assert.equal(isRecallBlock(p, 'arcStep'), true);
});

test('reaction time is logged from the first answer but only active at 85% stage accuracy', () => {
  let p = answerMany(defaultProgress(NOW), 5, true);
  assert.equal(p.items['as:17>34'].lat.length, 5);
  assert.equal(reactionTimeActive(p, 3), false);
  p = answerMany(p, 15, true);
  assert.equal(reactionTimeActive(p, 3), true);
});

test('exploring 15 distinct numbers unlocks stage 2', () => {
  let p = defaultProgress(NOW);
  for (let n = 0; n < 14; n++) p = recordExplored(p, n);
  p = recordExplored(p, 3);
  assert.ok(!p.unlocked.includes(2));
  p = recordExplored(p, 20);
  assert.ok(p.unlocked.includes(2));
});

test('migrate upgrades a pre-versioned save without discarding its data', () => {
  const legacy = { xp: 120, items: { 'as:17>34': { box: 3, due: 5, attempts: 4, correct: 3, errors: 1, lat: [] } } };
  const p = migrate(legacy, NOW);
  assert.equal(p.schema, SCHEMA_VERSION);
  assert.equal(p.xp, 120);
  assert.equal(p.items['as:17>34'].box, 3);
  assert.deepEqual(p.unlocked, [1]);
});

test('migrate keeps unknown fields and refuses saves from a newer app version', () => {
  const p = migrate({ ...defaultProgress(NOW), futureField: { a: 1 } }, NOW);
  assert.deepEqual(p.futureField, { a: 1 });
  assert.throws(() => migrate({ schema: SCHEMA_VERSION + 1 }, NOW), /newer/i);
});

test('export and import round-trip; bad files are rejected with a clear error', () => {
  const p = answerMany(defaultProgress(NOW), 3, true);
  assert.deepEqual(parseImport(serialize(p, NOW), NOW), p);
  assert.throws(() => parseImport('not json', NOW), /not a valid/i);
  assert.throws(() => parseImport('{"hello":1}', NOW), /not a roulette wheel trainer/i);
});

test('backup reminder shows after 7 days, and not for a brand-new user', () => {
  const fresh = defaultProgress(NOW);
  assert.equal(backupIsStale(fresh, NOW + 30 * DAY_MS), false);
  const trained = answerMany(fresh, 1, true);
  assert.equal(backupIsStale(trained, NOW + 6 * DAY_MS), false);
  assert.equal(backupIsStale(trained, NOW + 8 * DAY_MS), true);
  assert.equal(backupIsStale({ ...trained, lastBackup: NOW + 5 * DAY_MS }, NOW + 8 * DAY_MS), false);
});

test('older saves gain new settings with their defaults and keep the ones they had', () => {
  const p = migrate({ schema: 1, settings: { sound: true, sessionMin: 3 } }, NOW);
  assert.deepEqual(p.settings, { sound: true, sessionMin: 3, autoNext: true });
});
