# MotionBench 2.19.1 implementation

## Baselines and shared delivery

HTML baseline: `e9e10bbdcf3bfbe8e4a86c31b446e1c18feb2cab`. Desktop baseline: `71e2d905a82712f04ed725868b3ce2932cb5f5f8`. The verified remote rollback tag is `rollback-v2.19.0-desktop.1-before-2.19.1-20261012`; local source archives are retained under `output/rollback/motionbench-2.19.0-before-2.19.1`.

Source package version is `2.19.1`. Desktop packaging uses `extraMetadata.version: 2.19.1-desktop.1`; the embedded HTML is identical to the standalone HTML. Source-first construction remains `scripts/build.py`.

## Report behavior

The EUR rule ID is `eur-height-1.1-v1`. The comparison uses the unrounded representative CMJ/SJ height ratio. EUR > 1.1 emphasizes concentric ability; EUR <= 1.1 emphasizes SSC use. EUR and gain results, selected directions, report projections and AI facts share the rule. It is an adopted application training-direction rule; the source papers retain their original study descriptions.

Direction projections expose `hasData`, independent of the chosen summary basis. Finite group parameters or an enabled valid FVP/elasticity result retain the group; a missing selected basis does not replace the saved choice. Direction-rule identity is part of AI analysis binding, not the raw-measurement fingerprint. Rule-only review appears in the AI editor for affected old AI drafts, while manual text and reader-facing narrative remain intact.

The A2 report design uses shallow tertiary ability bands and softly elevated white action cards. Test titles use `h4`, while stable `.test-title`, `.quality-heading`, anchors and chart-pair markers remain available to PDF. Shared jump and LVP comparisons retain their registered renderer behavior. Collapsed direction summaries align in height; opened parameter tables grow independently.

Status colors resolve from evaluation CSS tokens into concrete SVG color values. Jump labels map stable IDs to CMJ/SJ/DJ/Hop/CMRJ at every plot width; full names remain in tables and accessible descriptions. PDF keeps expanded summaries with the following parameter heading and first table row, then uses existing row-safe continuation rules.

## Desktop update contract

`MotionBenchNative` preserves the AI methods and adds `getUpdateState`, `setUpdatePreferences`, `checkForUpdates`, `downloadUpdate`, `installUpdate`, and `onUpdateState` with unsubscribe. Main validates the originating window, frame, fixed application URL, operation and arguments. No path or general shell capability is exposed to the renderer.

State contains desktop/web versions, portable mode, startup preference, availability, progress, release notes, last-check time and scoped errors. Desktop preferences are atomically stored in `desktop-preferences.json`, separately from assessment data and DPAPI credentials. First-install startup checking defaults on; unreadable preferences disable startup checking and retain the original file.

The host waits for successful `App.ready` and then five seconds before one startup check. The application settings entry owns the availability badge. Download and installation are explicit actions; ordinary quit does not install.

Locked updater `6.8.9` uses the GitHub `desktop` channel, permits desktop prereleases and refuses downgrades and foreign manifests. Metadata must contain the matching desktop x64 Setup and checksum. The Windows adapter retains the official downloader/cache, rechecks SHA512 immediately before installation, waits for the installer process to spawn successfully, and only then quits. Save refusal or spawn failure keeps the old application available.

Assisted NSIS installation permits directory selection and preserves current-user installation. The fixed application ID, userData/sessionData paths, document origin and IndexedDB identity remain unchanged. Portable mode opens the corresponding desktop release for manual replacement.

## Verification and release

The version-specific verifier checks source/build reproducibility, source-bound test results, browser artifacts, PDFs and desktop runtime/package evidence. New evidence is kept under version-specific output directories. HTML and desktop tags use the same reviewed source commit; desktop release assets include Setup, Portable, `desktop.yml`, blockmap, SHA256 checksums and build provenance.
