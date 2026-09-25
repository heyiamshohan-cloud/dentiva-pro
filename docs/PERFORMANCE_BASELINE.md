# Performance baseline — v2.0.0 (real relational store)

Measured with `node scripts/dataset-benchmark.mjs 1000,10000,25000,50000,100000`
on the actual engine (Workspace + SqlRepo + shared query registry) in throwaway
workspaces. Synthetic data only; never written to a clinic store.

Each figure is the **median of 3 runs** (single timings on a shared machine swing
3–10× on identical code, which is why the earlier single-shot numbers in this
file's history moved by that much). Machine: sandbox Linux, Node 22
(`node:sqlite`).

| Size | Records | DB size | List p1 | List last | Search (Latin) | Revenue rpt | Accounting | Analytics | Statement | Integrity | Backup |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1,000 | 9,536 | 4.4 MB | 0.7 ms | 1.8 ms | 2.6 ms | 2.6 ms | 3.4 ms | 3.4 ms | 0.8 ms | 19 ms | 29 ms |
| 10,000 | 94,586 | 39 MB | 1.4 ms | 15.7 ms | 22.7 ms | 13.0 ms | 24.6 ms | 23.6 ms | 0.8 ms | 196 ms | 168 ms |
| 25,000 | 236,336 | 98 MB | 4.0 ms | 41.7 ms | 54.5 ms | 57.1 ms | 60.1 ms | 62.2 ms | 0.6 ms | 496 ms | 388 ms |
| 50,000 | 472,586 | 196 MB | 5.8 ms | 81.4 ms | 93.8 ms | 74.0 ms | 136.5 ms | 124.7 ms | 0.9 ms | 1.04 s | 984 ms |
| 100,000 | 945,086 | 394 MB | 15.8 ms | 177.6 ms | 203.4 ms | 141.5 ms | 298.3 ms | 296.7 ms | 0.8 ms | 2.38 s | 2.29 s |

Notes:
- Cold open + migration no-op on an existing store: **< 2 ms** at every size.
- Command-palette search (six groups, rows only, debounced 180 ms in the UI):
  9 ms at 1k, 73 ms at 10k, ~209 ms at 25k, 387 ms at 50k, **794 ms at 100k**.
  This is the slowest interactive operation and it is a substring scan across
  materialised columns; the palette debounce keeps typing smooth, results are
  never truncated, and an FTS index is the planned v2.1 improvement.
- Patient-scoped operations (statement, aggregate, invoice detail) stay
  sub-millisecond thanks to patient indexes — patient history is never loaded
  whole into the renderer.
- Integrity check and backup are linear in database size and run off the
  interactive path (dialog/schedule driven).
- v1.3.0's whole-state canonical JSON save path remains obsolete by design: the
  product never serializes the whole store on a save.
