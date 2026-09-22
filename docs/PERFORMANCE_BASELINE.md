# Performance baseline — v1.4.0 (real relational store)

Measured with `scripts/dataset-benchmark.mjs` on the actual v1.4.0 engine
(Workspace + SqlRepo + shared query registry) in throwaway workspaces.
Synthetic data only; never written to a clinic store. Machine: sandbox Linux,
Node 22 (node:sqlite 3.51.3).

| Size | Records | List p1 | List last | Search BN | Revenue rpt | Accounting | Analytics | Statement | Integrity | Backup |
|---|---|---|---|---|---|---|---|---|---|---|
| 1,000 | 9,536 | 1.9 ms | 2.0 ms | 3.2 ms | 3.3 ms | 5.2 ms | 4.1 ms | 0.8 ms | 25 ms | 42 ms |
| 10,000 | 94,586 | 2.4 ms | 18.0 ms | 23.2 ms | 15.2 ms | 31.7 ms | 29.2 ms | 0.5 ms | 236 ms | 171 ms |
| 25,000 | 236,336 | 4.6 ms | 38.4 ms | 55.1 ms | 32.9 ms | 66.9 ms | 64.5 ms | 0.4 ms | 489 ms | 410 ms |
| 100,000 | 945,086 | 18.0 ms | 159.5 ms | 220.6 ms | 137.9 ms | 274.8 ms | 312.7 ms | 0.6 ms | 2.4 s | 1.6 s (412 MB) |

Notes:
- Cold open + migration no-op on an existing store: < 3 ms at every size.
- Global search (3 collections, patient-join, capped at 8 per collection) is the
  slowest interactive operation: ~1.0 s at 100k — acceptable for a
  "search the whole workspace" action; the per-page list search stays ≤ 221 ms.
- Patient-scoped operations (statement, aggregate, invoice detail) stay
  sub-millisecond thanks to patient indexes — patient history is never loaded
  whole into the renderer.
- v1.3.0 baseline (whole-state canonical JSON validation/serialization) is
  obsolete by design: v1.4.0 never serializes the whole store on a save.
