// App: screens and the training loop. All rules live in the pure modules; this file wires them to the DOM.

import { pocket, neighbors, SECTORS, MAIN_SECTORS } from './wheel.js';
import { pickNext, requeueMissed, weakSpots } from './scheduler.js';
import { stageItems, itemById, itemLabel, studyChunk } from './items.js';
import { buildQuestion, isCorrectAnswer, randomRotorAngle } from './questions.js';
import {
  defaultProgress, recordAnswer, recordExplored, recordSession, unlockStage, isRecallBlock,
  stageAccuracy, parseImport, backupIsStale, EXPLORE_UNLOCK_COUNT,
  recordBenchmark, benchmarkBest, benchmarkAvailable, masteryBars, isIntroduced, markIntroduced,
} from './progress.js';
import { benchmarkOrder } from './benchmark.js';
import { loadProgress, saveProgress, clearProgress, requestDurableStorage, shareBackup } from './storage.js';
import { createWheel } from './renderer.js';
import { h, numberChip, renderParts, formatClock, percent, STAGES, PLAYABLE_STAGES } from './ui.js';

const SESSION_LENGTHS = [3, 5, 10];
const CORRECT_PAUSE_MS = 1100;
const WEAK_SPOT_LIMIT = 5;
const BENCHMARK_TREND_COUNT = 8;
const BENCHMARK_REVEAL_MS = 700;
const root = document.getElementById('app');

let progress = null;
let storageLocked = false;
let session = null;
let keyHandler = null;

function commit(next) {
  progress = next;
  if (!storageLocked) saveProgress(progress);
}

function isFresh() {
  return progress.xp === 0 && Object.keys(progress.items).length === 0 && progress.explored.length === 0;
}

function header() {
  return h('header', { class: 'app-header' },
    h('div', { class: 'brand' }, h('strong', {}, 'ROULETTE WHEEL TRAINER'), h('span', {}, 'Level 1 · Learn the Wheel')),
    h('div', { class: 'level' }, 'Level 1 / 10', h('div', { class: 'level-bar' },
      h('i', { style: `transform:scaleX(${progress.completed.length / STAGES.length})` }))));
}

function show(...nodes) {
  document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  root.replaceChildren(header(), ...nodes);
}

function onKeys(handler) {
  keyHandler = handler;
  document.addEventListener('keydown', keyHandler);
}

/* ---------- Home ---------- */

async function importFile(file) {
  try {
    commit(parseImport(await file.text(), Date.now()));
    showHome('Progress imported.');
  } catch (error) {
    showHome(error.message);
  }
}

function importButton(label, cls) {
  const input = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden',
    onChange: (event) => event.target.files[0] && importFile(event.target.files[0]) });
  return h('label', { class: `btn ${cls}` }, label, input);
}

async function saveBackup(after) {
  if (await shareBackup(progress, Date.now())) commit({ ...progress, lastBackup: Date.now() });
  after();
}

function stageRow(stage) {
  const unlocked = progress.unlocked.includes(stage.n);
  const playable = unlocked && PLAYABLE_STAGES.includes(stage.n);
  const done = progress.completed.includes(stage.n);
  const accuracy = stage.n > 1 && progress.stages[stage.n] ? percent(stageAccuracy(progress, stage.n)) : '';
  return h('button', { class: `stage-row${done ? ' is-done' : ''}`, disabled: !playable,
    onClick: () => (stage.n === 1 ? showExplore() : startSession(stage.n)) },
    h('span', { class: 'stage-n' }, done ? '✓' : unlocked ? stage.n : '🔒'),
    h('span', { class: 'stage-text' }, h('strong', {}, stage.title), h('small', {}, stage.note)),
    h('span', { class: 'stage-acc' }, accuracy));
}

function benchmarkRow() {
  const open = benchmarkAvailable(progress);
  const best = benchmarkBest(progress);
  const note = best ? `Best: ${best.errors} error${best.errors === 1 ? '' : 's'} · ${formatClock(best.ms)}` : 'Place all 37 numbers. Opens with stage 4.';
  return h('button', { class: 'stage-row benchmark-row', disabled: !open, onClick: showBenchmark },
    h('span', { class: 'stage-n' }, open ? '◎' : '🔒'),
    h('span', { class: 'stage-text' }, h('strong', {}, 'Blank Wheel benchmark'), h('small', {}, note)),
    h('span', { class: 'stage-acc' }, progress.benchmark.length ? `${progress.benchmark.length}×` : ''));
}

function showHome(message) {
  const lengths = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Session length' },
    SESSION_LENGTHS.map((min) => h('button', { class: progress.settings.sessionMin === min ? 'is-on' : '',
      onClick: () => { commit({ ...progress, settings: { ...progress.settings, sessionMin: min } }); showHome(); } }, `${min} min`)));
  show(h('main', { class: 'screen home' },
    message && h('p', { class: 'notice' }, message),
    storageLocked && h('p', { class: 'notice' }, 'Saved progress comes from a newer app version. It is untouched; nothing will be saved until the app updates.'),
    backupIsStale(progress, Date.now()) && h('div', { class: 'notice' }, 'Last backup is more than 7 days old. ',
      h('button', { class: 'link', onClick: () => saveBackup(() => showHome()) }, 'Save backup')),
    isFresh() && h('section', { class: 'welcome' }, h('p', {}, 'New here, or moved from another device?'),
      importButton('Import progress', 'btn-ghost')),
    h('div', { class: 'stat-line' }, h('span', {}, `${progress.xp} XP`), progress.streak > 1 && h('span', {}, `🔥 STREAK ${progress.streak}`)),
    h('section', { class: 'stage-list' }, STAGES.map(stageRow)),
    benchmarkRow(),
    h('div', { class: 'home-foot' }, h('span', { class: 'label' }, 'Session'), lengths,
      h('button', { class: 'btn btn-ghost', onClick: showSettings }, 'Settings'))));
}

/* ---------- Stage 1: Explore ---------- */

function showExplore() {
  const info = h('p', { class: 'explore-info' }, 'Drag to rotate. Tap a number.');
  const count = h('small', { class: 'explore-count' });
  const mount = h('div', { class: 'wheel-mount' });
  let mode = 'full';
  let selected = null;
  const wheel = createWheel(mount, {
    onRotate: () => {},
    onTap: (n) => {
      selected = n;
      const { ccw, cw } = neighbors(n, 1);
      wheel.present({ highlight: [ccw[0], n, cw[0]] });
      const p = pocket(n);
      const sector = SECTORS[MAIN_SECTORS.find((id) => p.sectors.includes(id))].name;
      const zero = p.sectors.includes('zerospiel') ? ' · Zero-Spiel' : '';
      info.replaceChildren(numberChip(n), ' sits between ', numberChip(ccw[0]), ' and ', numberChip(cw[0]),
        h('small', {}, `${sector}${zero} · Arc ${p.arc}`));
      commit(recordExplored(progress, n));
      updateCount();
    },
  });
  function updateCount() {
    const left = EXPLORE_UNLOCK_COUNT - progress.explored.length;
    count.textContent = progress.unlocked.includes(2) ? 'Sectors unlocked.' : `Explore ${left} more numbers to unlock Sectors.`;
  }
  const toggle = h('button', { class: 'btn btn-ghost', onClick: () => {
    mode = mode === 'full' ? 'arc' : 'full';
    wheel.setView(mode, selected ?? 0, { atTop: mode === 'arc' });
    toggle.textContent = mode === 'full' ? 'Arc view' : 'Full wheel';
  } }, 'Arc view');
  const sectorButtons = h('div', { class: 'segmented sector-tabs', role: 'group', 'aria-label': 'Show a sector' },
    Object.values(SECTORS).map((sector) => h('button', { onClick: () => {
      wheel.present({ highlight: sector.numbers });
      if (mode === 'arc') wheel.setView('arc', sector.runs[0][Math.floor(sector.runs[0].length / 2)], { atTop: true });
      info.replaceChildren(h('strong', { class: 'sector-name' }, `${sector.name} · ${sector.numbers.length}`),
        h('span', { class: 'run-list' }, sector.runs.map((run) => h('span', { class: 'run' }, run.map(numberChip)))));
    } }, sector.short)));
  updateCount();
  show(h('main', { class: 'screen train' }, mount, sectorButtons, info, count,
    h('div', { class: 'answers row' }, toggle,
      h('button', { class: 'btn', onClick: () => { commit(unlockStage(progress, 2)); showHome(); } },
        progress.unlocked.includes(2) ? 'Done' : 'Skip to Sectors'))));
}

/* ---------- Training session ---------- */

function startSession(stage) {
  session = { stage, startedAt: Date.now(), endsAt: Date.now() + progress.settings.sessionMin * 60_000,
    asked: 0, correct: 0, queue: [], lastId: null, latencies: [], misses: {} };
  commit({ ...progress, stage });
  nextQuestion();
}

function nextQuestion() {
  if (Date.now() >= session.endsAt) return showSummary();
  const id = pickNext({ ids: stageItems(session.stage).map((i) => i.id), states: progress.items, now: Date.now(),
    queue: session.queue, asked: session.asked, lastId: session.lastId });
  const item = itemById(id);
  const chunk = studyChunk(item);
  if (chunk && !isIntroduced(progress, chunk.id)) return showStudyCard(chunk);
  session.queue = session.queue.filter((q) => q.id !== id);
  const question = buildQuestion(item, { recall: isRecallBlock(progress, item.kind), rng: Math.random });
  showQuestion(item, question);
}

// Teach before testing: the first time a sector, arc or junction comes up, show it in full.
function showStudyCard(chunk) {
  const pausedAt = Date.now();
  const numbers = chunk.runs.flat();
  const mount = h('div', { class: 'wheel-mount' });
  const wheel = createWheel(mount, { onRotate: () => {} });
  wheel.setRotorAngle(randomRotorAngle(Math.random));
  wheel.setView(chunk.view, chunk.focus);
  wheel.present({ hideNumbers: true, revealed: numbers, band: numbers, highlight: chunk.mark });
  const done = () => {
    session.endsAt += Date.now() - pausedAt;
    commit(markIntroduced(progress, chunk.id));
    nextQuestion();
  };
  show(h('main', { class: 'screen train' },
    h('div', { class: 'stat-line' }, h('span', {}, 'STUDY · not scored, clock paused'), h('span', {}, 'Drag to turn')),
    mount,
    h('p', { class: 'prompt' }, h('strong', { class: 'sector-name' }, chunk.title),
      h('small', {}, `${numbers.length} numbers, clockwise. Read them in both directions.`)),
    h('div', { class: 'run-list' }, chunk.runs.map((run) => h('span', { class: 'run' }, run.map(numberChip)))),
    h('div', { class: 'answers' }, h('button', { class: 'btn btn-wide', onClick: done }, 'Got it · start questions'))));
  onKeys((event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); done(); } });
}

function keypad(question, submit) {
  const needed = Array.isArray(question.answer) ? question.answer.length : 1;
  const entered = [];
  let digits = '';
  const display = h('div', { class: 'keypad-display' });
  const redraw = () => display.replaceChildren(...entered.map(numberChip), h('span', { class: 'typing' }, digits || (entered.length ? '' : '–')));
  function press(key) {
    if (key === '⌫') digits = digits.slice(0, -1);
    else if (key === 'OK') {
      const value = Number(digits);
      if (digits === '' || value > 36) { digits = ''; return redraw(); }
      entered.push(value);
      digits = '';
      if (entered.length === needed) return submit(needed === 1 ? entered[0] : entered);
    } else if (digits.length < 2) digits += key;
    redraw();
  }
  redraw();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];
  const pad = h('div', { class: 'keypad' }, keys.map((k) => h('button', { class: k === 'OK' ? 'key key-ok' : 'key', onClick: () => press(k) }, k)));
  return { node: h('div', {}, display, pad), press };
}

function showQuestion(item, question) {
  const mount = h('div', { class: 'wheel-mount' });
  const wheel = createWheel(mount, { onTap: (n) => question.answerType === 'tap' && submit(n) });
  wheel.setRotorAngle(randomRotorAngle(Math.random));
  wheel.setView(question.wheel.view, question.wheel.focus);
  wheel.present({ hideNumbers: true, ...question.wheel });
  const clock = h('span', { class: 'clock' });
  const tick = setInterval(() => { clock.textContent = formatClock(session.endsAt - Date.now()); }, 500);
  clock.textContent = formatClock(session.endsAt - Date.now());
  const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
  const answers = h('div', { class: 'answers' });
  const shownAt = performance.now();
  let answered = false;

  function advance() { clearInterval(tick); nextQuestion(); }

  function submit(given) {
    if (answered) return;
    answered = true;
    const latencyMs = Math.round(performance.now() - shownAt);
    const ok = isCorrectAnswer(question, given);
    session.asked += 1;
    session.lastId = item.id;
    session.latencies.push(latencyMs);
    if (ok) session.correct += 1;
    else {
      session.queue = requeueMissed(session.queue, item.id, session.asked, Math.random);
      session.misses[item.id] = (session.misses[item.id] ?? 0) + 1;
    }
    commit(recordAnswer(progress, { item, stage: session.stage, ok, latencyMs, now: Date.now() }));
    const wrongPick = !ok && typeof given === 'number' ? [given] : [];
    wheel.present({ highlight: question.feedback.highlight, wrong: wrongPick, band: question.wheel.band });
    feedback.className = `feedback ${ok ? 'is-ok' : 'is-miss'}`;
    feedback.replaceChildren(h('strong', {}, ok ? '✓ ' : 'Not quite. Let’s lock this one in. '), ...renderParts(question.feedback.relation));
    answers.replaceChildren(h('button', { class: 'btn btn-wide', onClick: advance }, 'Next'));
    statBar.replaceChildren(...statParts());
    if (ok) setTimeout(() => answered && root.contains(answers) && advance(), CORRECT_PAUSE_MS);
  }

  let pad = null;
  if (question.answerType === 'tap') {
    answers.append(h('p', { class: 'hint' }, 'Tap the wheel.'));
  } else if (question.answerType === 'multi') {
    const picked = new Set();
    const confirm = h('button', { class: 'btn btn-wide', disabled: true, onClick: () => submit([...picked]) }, 'Check');
    const chips = question.options.map((o) => {
      const button = h('button', { class: 'btn choice pick', 'aria-pressed': 'false', onClick: () => {
        if (picked.has(o.value)) picked.delete(o.value); else picked.add(o.value);
        button.setAttribute('aria-pressed', String(picked.has(o.value)));
        confirm.disabled = picked.size !== question.answer.length;
        confirm.textContent = `Check (${picked.size}/${question.answer.length})`;
      } }, ...renderParts(o.label));
      return button;
    });
    answers.append(h('div', { class: 'pick-grid' }, chips), confirm);
  } else if (question.answerType === 'choice') {
    const layout = question.options.length > 4 ? 'grid-4' : question.options.length === 3 || Array.isArray(question.answer) ? 'stack' : 'grid';
    answers.classList.add(layout);
    answers.append(...question.options.map((o, i) => h('button', { class: 'btn choice', onClick: () => submit(o.value) },
      h('kbd', {}, i + 1), ...renderParts(o.label))));
  } else {
    pad = keypad(question, submit);
    answers.append(pad.node);
  }

  const statParts = () => [clock, h('span', {}, progress.streak > 1 ? `🔥 STREAK ${progress.streak}` : ''), h('span', {}, `${progress.xp} XP`),
    h('button', { class: 'link', onClick: () => { clearInterval(tick); showSummary(); } }, 'Stop')];
  const statBar = h('div', { class: 'stat-line' }, statParts());

  show(h('main', { class: 'screen train' }, statBar, mount,
    h('p', { class: 'prompt' }, renderParts(question.prompt),
      question.answerType !== 'choice' && h('small', {}, Array.isArray(question.answer) ? ' · type each number, OK after each' : ' · type the number')),
    feedback, answers));

  onKeys((event) => {
    if (answered) { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); advance(); } return; }
    if (pad) {
      if (/^\d$/.test(event.key)) pad.press(event.key);
      else if (event.key === 'Enter') pad.press('OK');
      else if (event.key === 'Backspace') pad.press('⌫');
    } else if (question.answerType === 'choice' && /^[1-4]$/.test(event.key) && question.options[event.key - 1]) submit(question.options[event.key - 1].value);
  });
}

/* ---------- Summary ---------- */

function showSummary() {
  const s = session;
  session = null;
  if (s.asked > 0) {
    commit(recordSession(progress, { at: s.startedAt, stage: s.stage, asked: s.asked, correct: s.correct,
      durationMs: Date.now() - s.startedAt }));
  }
  const accuracy = s.asked ? s.correct / s.asked : 0;
  const weak = weakSpots(progress.items, WEAK_SPOT_LIMIT).map(({ id, errors }) => ({ item: itemById(id), errors })).filter((w) => w.item);
  const bars = masteryBars(progress).map((bar) => h('div', { class: 'bar-row' }, h('span', {}, bar.label),
    h('div', { class: 'bar' }, h('i', { style: `transform:scaleX(${bar.value})` })), h('span', {}, percent(bar.value))));
  const unlockedNow = progress.completed.includes(s.stage);
  show(h('main', { class: 'screen summary' },
    h('h1', {}, 'SESSION COMPLETE'),
    h('div', { class: 'tiles' },
      h('div', {}, h('strong', {}, percent(accuracy)), h('small', {}, 'Accuracy')),
      h('div', {}, h('strong', {}, s.asked), h('small', {}, 'Questions')),
      h('div', {}, h('strong', {}, s.correct), h('small', {}, 'Correct')),
      h('div', {}, h('strong', {}, progress.streak), h('small', {}, 'Streak'))),
    unlockedNow && h('p', { class: 'notice' }, `Stage ${s.stage} passed. Stage ${s.stage + 1} is unlocked.`),
    h('section', {}, bars),
    weak.length > 0 && h('section', {}, h('h2', {}, 'Your weak spots'),
      h('ul', { class: 'weak' }, weak.map((w) => h('li', {}, itemLabel(w.item), h('small', {}, `${w.errors} error${w.errors === 1 ? '' : 's'}`))))),
    h('div', { class: 'answers stack' },
      h('button', { class: 'btn btn-wide', onClick: () => startSession(s.stage) }, 'Train again'),
      h('button', { class: 'btn btn-ghost btn-wide', onClick: () => saveBackup(() => showHome('Backup saved.')) }, 'Save backup'),
      h('button', { class: 'btn btn-ghost btn-wide', onClick: () => showHome() }, 'Home'))));
}

/* ---------- Blank Wheel benchmark ---------- */

function showBenchmark() {
  const { anchor, order } = benchmarkOrder(Math.random);
  const placed = [anchor];
  const startedAt = Date.now();
  let errors = 0;
  let index = 0;
  let locked = false;
  const mount = h('div', { class: 'wheel-mount' });
  const prompt = h('p', { class: 'prompt' });
  const status = h('div', { class: 'stat-line' });
  const wheel = createWheel(mount, { onTap: (n) => {
    if (locked || placed.includes(n)) return;
    const target = order[index];
    const ok = n === target;
    if (!ok) errors += 1;
    placed.push(target);
    index += 1;
    locked = !ok;
    wheel.present({ hideNumbers: true, revealed: placed, highlight: [target], wrong: ok ? [] : [n] });
    if (ok) return draw();
    setTimeout(() => { locked = false; draw(); }, BENCHMARK_REVEAL_MS);
  } });
  wheel.setRotorAngle(randomRotorAngle(Math.random));

  function draw() {
    if (index >= order.length) return finish();
    prompt.replaceChildren('Tap the pocket of ', numberChip(order[index]));
    status.replaceChildren(h('span', {}, `${index} / ${order.length} placed`), h('span', {}, `${errors} error${errors === 1 ? '' : 's'}`),
      h('button', { class: 'link', onClick: () => showHome() }, 'Quit'));
    if (!locked) wheel.present({ hideNumbers: true, revealed: placed });
  }

  function finish() {
    const result = { at: startedAt, ms: Date.now() - startedAt, errors };
    commit(recordBenchmark(progress, result));
    showBenchmarkResult(result);
  }

  show(h('main', { class: 'screen train' }, status, mount, prompt,
    h('p', { class: 'hint' }, 'Only the anchor is given. A miss is counted and the right pocket is shown.')));
  draw();
}

function showBenchmarkResult(result) {
  const best = benchmarkBest(progress);
  const recent = progress.benchmark.slice(-BENCHMARK_TREND_COUNT);
  const worst = Math.max(1, ...recent.map((r) => r.errors));
  show(h('main', { class: 'screen summary' }, h('h1', {}, 'BLANK WHEEL'),
    h('div', { class: 'tiles two' },
      h('div', {}, h('strong', {}, result.errors), h('small', {}, 'Errors')),
      h('div', {}, h('strong', {}, formatClock(result.ms)), h('small', {}, 'Time'))),
    h('p', { class: 'notice' }, `Personal best: ${best.errors} error${best.errors === 1 ? '' : 's'} in ${formatClock(best.ms)}. Mastery needs 2 errors or fewer.`),
    h('section', {}, h('h2', {}, 'Trend · errors per run'),
      h('div', { class: 'trend' }, recent.map((r) => h('div', { class: 'trend-col' },
        h('i', { style: `transform:scaleY(${Math.max(0.04, r.errors / worst)})` }), h('small', {}, r.errors))))),
    h('div', { class: 'answers stack' },
      h('button', { class: 'btn btn-wide', onClick: showBenchmark }, 'Run again'),
      h('button', { class: 'btn btn-ghost btn-wide', onClick: () => showHome() }, 'Home'))));
}

/* ---------- Settings ---------- */

function showSettings() {
  const confirmBox = h('div', { class: 'confirm', hidden: true }, h('p', {}, 'Reset all training progress?'),
    h('div', { class: 'answers row' },
      h('button', { class: 'btn btn-ghost', onClick: () => { confirmBox.hidden = true; } }, 'Cancel'),
      h('button', { class: 'btn btn-danger', disabled: storageLocked, onClick: async () => { await clearProgress(); progress = defaultProgress(Date.now()); showHome('Progress reset.'); } }, 'Reset')));
  show(h('main', { class: 'screen settings' }, h('h1', {}, 'Settings'),
    h('button', { class: 'btn btn-ghost btn-wide', onClick: () => { commit({ ...progress, settings: { ...progress.settings, sound: !progress.settings.sound } }); showSettings(); } },
      `Sound: ${progress.settings.sound ? 'ON' : 'OFF'}`),
    h('button', { class: 'btn btn-ghost btn-wide', onClick: () => saveBackup(showSettings) }, 'Export progress'),
    importButton('Import progress', 'btn-ghost btn-wide'),
    h('button', { class: 'btn btn-danger btn-wide', onClick: () => { confirmBox.hidden = false; } }, 'Reset Progress'),
    confirmBox,
    h('button', { class: 'btn btn-wide', onClick: () => showHome() }, 'Back')));
}

/* ---------- Boot ---------- */

async function boot() {
  const loaded = await loadProgress(Date.now());
  storageLocked = loaded.locked === true;
  progress = loaded.progress ?? defaultProgress(Date.now());
  if (!loaded.progress && !storageLocked) requestDurableStorage();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker registration failed', error));
  }
  showHome();
}

boot();
