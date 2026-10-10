# MotionBench 2.19.0 implementation contract

Approved 2026-10-11: preserve single/multiple athlete entry workflow; refactor management, acquisition contracts, Excel, measurement catalog and evaluation domain together. Baseline C:/Users/ZekeNiu/Documents/Codex/2026-10-10/task/MotionBench commit 0faaa5c1dfb9ee234faf30b751067670fdf4d9ff; current daily HTML SHA256 0a72a07e322f1c083b672e8647823977b3f1d11112b1d3bd7c65165de0c04741. D:/ workspace source was 2.16.1 and must not rebuild before consolidation.

## Decisions

- First establish verified remote baseline, then consolidate full source into D:/ workspace without losing archives or daily entry URL. Retired root legacy HTML alias remains absent.
- Keep records / athletes / teams destinations. Progressive filters and object-specific menus; selection-only batch actions; explicit team/athlete scope and return context.
- Catalog owns measurement definition, protocol identity, field shape, representative selection. Shared evaluation owns standards and project analysis settings; raw values never change because rating direction changes.
- Shared acquisition contract covers role/scope/type/unit/validation/calculation readiness and adapter support. Native special calculators retained.
- Excel schema 3: parameters beside project measurements; one IMTP sheet with parameterized arbitrary positive time points; one Hop summary sheet. New Hop only summary. Historical raw jumps remain intact/read-only and continue original calculations, old template import remains supported.
- New profile schema: metric references and rules, no copies of full measurement definitions. Project-oriented editor replaces seven technical tabs. Structured interval rows and optional conditions. Targets, grades and references match independently. Published versions and transaction conflict checks.
- Ability primary: missing => omit axis, never substitute. Mean: explicit fixed members, equal weights, all required; missing/inapplicable/incomplete => omit. Min removed. Score transforms: eligible target ratio, explicit score tables or piecewise anchors (including optimal interval). Never infer numeric scores from traffic-light colors. Mean color only from explicit aggregate bands. No target-ratio ranking masquerading as strengths.
- Proven representative rule errors recalculate with before/after migration evidence; uncertain cases retain data and are marked for review. Legacy standards and actual interval gaps are not invented or rewritten.
- Preserve FVP, sprint, elasticity, FMS, directional isometric semantics, raw trials, manual narratives, stable IDs and offline exports. Schemes continue latest-shared-standard behavior.

## Acceptance

Model contracts and all allowed extension scopes; current/legacy XLSX + native Excel; arbitrary IMTP time points; Hop source/raw preservation; conditions-only import; failure/conflict atomicity; migration result diffs; Chrome/Edge desktop/narrow/refresh/offline; HTML/JSON/PDF and AI fact consistency. Final evidence bound to artifact and source hashes. Do not count historical verification as current acceptance. Publish source, offline artifact, package and evidence only after final checks.

## Phases

1. [complete] baseline/remote rollback and source consolidation
2. [complete] parallel domain/Excel/editor implementation
3. [complete] integration, persistence and migration
4. [complete] model/browser/native Excel/PDF validation: 747 model checks, 118 browser checks, native Excel save/import and 160 PDF pages; all bound to the frozen artifact in acceptance-2.19.0.json
5. [complete] frozen delivery packages, verification evidence and program/data rollback documentation; GitHub publication identity is the v2.19.0 release tag
