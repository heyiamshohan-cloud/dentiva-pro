# Dentiva Pro v1.2.0 performance baseline

**Date:** 2026-09-22 (Asia/Dhaka)  
**Command:** `npm run benchmark:datasets`  
**Runtime:** Node.js 22.22.3  
**Scope:** synthetic domain objects only; no records are written to the clinic store.

This baseline is useful for tracking regression in relationship validation, canonical backup serialization and manifest creation. It is **not** a substitute for Electron startup, browser search/list rendering, patient profiles, timelines, reports, SQLite backup/restore or memory measurements.

| Patients | Visits | Appointments | Relationship validation (ms) | Canonical serialization (ms) | Manifest (ms) | Payload bytes | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 1,000 | 1,000 | 1.05 | 15.13 | 0.35 | 302,747 | 0 |
| 5,000 | 5,000 | 5,000 | 3.97 | 40.12 | 0.06 | 1,538,747 | 0 |
| 10,000 | 10,000 | 10,000 | 6.38 | 71.52 | 0.06 | 3,083,748 | 0 |
| 25,000 | 25,000 | 25,000 | 20.32 | 193.01 | 0.07 | 7,808,748 | 0 |

The generated names/phones are clearly synthetic and are never loaded by `src/main.js` or included in a release artifact. The remaining performance gate is to run a packaged Windows/Electron harness that measures startup, local SQLite load, patient search, paginated lists, profile/timeline navigation, report generation, backup and restore, including peak memory and failure behavior.
