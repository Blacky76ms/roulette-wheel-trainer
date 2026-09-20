# Roulette Wheel Trainer — Level 1 design (approved 2026-09-20)

Source of truth for requirements: developer brief v2 + persistence addition (operator, 2026-09-20).
Educational visual-memory trainer. No gambling functionality of any kind; color is never tested.

## Decisions
- **Packaging:** modular `src/` (named ES imports/exports only) → `scripts/build.mjs` inlines into
  `dist/index.html`; beside it `sw.js` (cache name = content hash), manifest, icons. Zero npm deps.
- **Hosting:** GitHub Pages, fixed URL `https://blacky76ms.github.io/roulette-wheel-trainer/`. All paths relative.
  First public push requires operator confirmation.
- **Persistence:** IndexedDB primary, localStorage mirror, schema-versioned with a migration chain that
  never drops fields; newer-schema saves are left untouched (app goes read-only). `storage.persist()` on
  first launch, share-sheet backup after sessions, 7-day reminder, Import on the start screen when empty.
- **Rendering:** one SVG; rotor layer driven by a single `rotorAngle`; stationary layers never rotate
  (marker now, diamonds/ball track later). Arc view = same wheel, zoomed viewBox. Numerals radial.
- **Learning:** items generated from the sequence; Leitner 5 boxes (0/1/3/7/14 d); missed item returns
  after 3–5 questions; block switches MC → recall at 80% over 10 and stays; stage unlock = 85% over last
  20 and 80% per direction (min 5 answers); Stage 1 unlocks Stage 2 after 15 explored numbers or Skip.
- **Assumptions:** "fast" = under own rolling median per question type (M3); Stage 8 ladder 6→5→4→3 s/rev.
- Sector membership keeps its 3 fixed buttons in recall (closed label set); tap-the-pocket recall arrives
  with Stage 6 where it tests position rather than adjacency.

## Milestones
- **M1 (built):** wheel+renderer, Stages 1–3, scheduler, persistence/export/import, PWA shell, XP/streak, settings.
- **M2 (built 2026-09-20):** Stages 4–6, Blank Wheel benchmark + history, mastery bars; page is network-first, assets cache-first.
- **M3:** Stages 7–8, reaction-time display + fast bonus, sound, R-repeat, polish.

## Success / kill
- Success: all 19 acceptance criteria; benchmark errors trend down over 2 weeks of 5-min sessions.
- Kill/rollback: arc-view numerals not instantly legible on the iPhone after M1 → rework rendering first;
  any progress loss despite IDB+persist+backup → halt features, fix persistence; stage accuracy ≥85% but
  benchmark flat after ~2 weeks → shift question mix toward recall/position before adding stages.
