[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/kuroro0125/makefun-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/kuroro0125/makefun-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Entry for the [make.fun bounty "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

# Read broken CSV files faster

A faster drop-in for make.fun's csv-reader 1.0.0: `solve.js` exports
`run(input)`, which returns exactly csv-reader's answer
`{columns, rows, errors}` for every input `{text, header}` — the same
broken-row policy (stray CRs dropped, doubled quotes, quote junk,
unterminated quotes read again as unquoted text, rows padded or cut
to the first record's width, errors as `{code, line, row}` in the
order met), at a fraction of the CPU time.

`main.ts` is the harness driver: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`. Outside a container, `MAKEFUN_INPUT_DIR` and
`MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`.

## How it is faster

The reference walks one character at a time and grows each field a
character at a time. This reader walks code units only as far as the
next special character (a comma, a quote or a line break), copies
each plain run in a single slice, and hands the finished field back
through shared variables instead of a fresh result object per field,
so the common case is one slice and a push per field. The slow paths
(a lone CR inside an unquoted field, a quoted field full of escapes)
assemble the field from parts, still run by run. No dependencies,
nothing cached between cases.

Verified against the kit's practice set: all 6 cases identical to
csv-reader 1.0.0, and several times faster in local CPU benchmarks;
a 4,000-case randomized differential test against the reference
implementation also matches on every input.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```
