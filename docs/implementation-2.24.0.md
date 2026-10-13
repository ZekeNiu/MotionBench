# MotionBench 2.24.0 — approved personal longitudinal report

2026-10-14: User explicitly approved implementation of the complete new plan in this chat. Baseline a61a0a087b09aca948e62668115e0a894818040e, clean 2.22.0 / 2.22.0-desktop.1 installed at D:\Application\Strength&Conditioning\MotionBench. Earlier 2.23 work is withdrawn history, not the implementation contract.

## Locked behavior

- One athlete; record multi-selection in existing toolbar. One record uses original report. Valid dated records only in multi-selection; same-date records remain distinct, ordered date/created/id.
- Uniform representative mode (existing selector), initially latest selected record's mode. Uniform latest selected record's current evaluation profile, individual historical age/mass/context. Compute from clones; no source record modifications.
- Original charts gain dated series, grouped bars/points and within-metric observed connections; no new time regression or slope. Numeric XY axes retain original meaning. Missing/unmatched values break lines. All selected records visible.
- Risk radar uses union of actually measured body regions, current canonical order and sides (up to 18), green=3/amber=2/red=1/null unknown. One/two axes are spokes/points, no invented axes. FMS separate true 0..3. Performance overview omits directions only; separate capability analysis stays.
- Tables: one metric per row, date columns; each date retains applicable mean/SD/CV and folded raw trials. Overall last-first and recent last-penultimate; with 2 dates only one change. Fixed endpoints; missing endpoint yields no change. Ratio scale and positive baseline for percent; percentages use percentage points; ordinal uses score transition. Improvement only from applicable consistent evaluation, never guessed.
- No p/MDC/standardized effect without qualified input; current project has none so no empty columns, unsupported claims, reliability settings or placeholder inference.
- Independent comparison narrative keyed athlete + record ID set; preserve body when basis changes and mark stale. Shared report-corner AI icon on single/comparison, immediate generate then editable preview/apply with previous body retained. Report-local progress/cancel/retry. Owner/fingerprint/revision checks prevent wrong-context application.
- Current PDF/editable HTML/JSON exports support complete selected records, basis/profile/catalog snapshots and narrative. Existing single exports remain. Full backups/import preserve comparison documents. Independent synthetic QA only.
- Protect installed program/user data, test candidate, install new local 2.24.0-desktop.1 to original directory, verify full data and ordinary restart. No publication step in this delivery.

## Ownership and interfaces

- model owner: `src/ringside-longitudinal.js`, model tests and synthetic helper fixture. Global `RingsideLongitudinal` with `build(records,{athleteId,mode,profile,catalog})`, `key(athleteId,recordIds)`, `facts(model)`. Agree output with view owner before coding.
- view owner: `src/ringside-longitudinal-view.js`, `src/ringside-longitudinal.css`, view/model tests; PDF hooks scoped to comparison. `render(model)` returns homepage/detail content; preserve complete rich original charts.
- store owner: `src/ringside-longitudinal-store.js`, necessary ringside-store/model backup integration and storage tests. Global `RingsideLongitudinalStore` with normalize/get/put/export/import document helpers; coordinate exact methods with root.
- root: App/controller/shell/build/version/AI/export, browser/native QA, checkpoint/package/install/acceptance.

Do not edit another owner's files without coordination. All evidence must bind final HTML/runtime hashes. Do not restore withdrawn candidate source wholesale.
