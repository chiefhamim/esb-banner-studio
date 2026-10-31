# Regression — after-w2b — 2026-11-01T03:51:48+06:00 — 5454e12 Integration: D9 end-to-end check in the Editorial suite after the W1+W2 merge (D19); after-W2 regression logs
| check | result |
|---|---|
| oxlint | 3 lines mention error; exit=0 |
| tsc | exit=0 |
| unit |  Tests 621 passed (621) |
| editorial | 75 PASS / 0 FAIL;  |
| golden | social-01: 292 px differ (0.013 %) web-01: 988 px differ (0.048 %)  |
| ui | 166 PASS / 1 FAIL; FAIL UI chrome is neutral grey (no coloured fills or text) pnl:rgba(15, 23, 42, ; |
| build | [32m✓ built in 324ms[39m |
| electron | 35 PASS / 0 FAIL; exit=0 |
| video | 22 PASS / 0 FAIL |
| census |   0(3) 1(3) 2(3) 3(3) 4(1) 5(3) 6(2) 7(1) 8(1) 10(2) 20(2) 25(1) 32(1) 900(1) 1000(2) 2000(3) 3000(2) exit=0  |
