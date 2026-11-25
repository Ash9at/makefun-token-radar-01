# Token Launch Radar v2 — build notes

Methodology decisions, evidence, and rejected alternatives. The README is the
entry's public face; this file is the working record behind it.

## Stage 1 — leave-one-out backtest of the v1 model (2026-11-26)

Harness: `tools/loo_probe.ts`. For every protocol the snapshot records with a
traded token (mcap_usd > 0, TVL > 0 — 128 subjects), remove it from the peer
set, price it with the model's own arithmetic as if it recorded no token, and
compare with the market cap it actually carries. Errors are log10(pred/actual);
0.301 is a factor of two. Fifteen further rows record a token symbol with
mcap_usd = 0 (dead tokens): they carry no price to predict against and are
excluded as subjects.

### Headline numbers (v1 model, as submitted)

| metric | v1 | naive: TVL × global median | naive: raw category median |
|---|---|---|---|
| median \|log10 error\| | 0.693 (typical miss ×/÷ 4.9) | 0.705 | 0.690 |
| mean log10 error (bias) | −0.125 | −0.021 | +0.098 |
| predictions within 2× | 26.6% | 28.1% | 21.6% |
| predictions within 3× | 35.9% | — | — |

The uncomfortable finding: v1's machinery — category medians, shrinkage,
growth, seasoning, breadth — barely beats "TVL × one global median" on point
accuracy, and loses to it on the within-2× rate. What v1 genuinely added was
structure (bands, per-category pricing, separation of live from pre-token),
not predictive accuracy. v2 has to earn the accuracy claim or stop making it.

### What the evidence supports (same LOO, one change at a time)

- **Size effect — the one large win.** Across the live set, log(mcap/TVL)
  falls with log(TVL) at slope −0.478: the market pays fewer dollars of
  market cap per dollar of TVL the bigger the protocol already is. Adding a
  size factor 10^(slope × (log10 TVL − log10 median peer TVL)) to v1:
  median error 0.693 → 0.569 (full slope), hit≤3× 35.9% → 43.0%.
- **Drop zero-mcap peers.** Fifteen peer rows price their token at $0; as
  pricing evidence they only drag. Dropping them from the peer set moves
  bias from −0.125 to −0.017 at equal median error.
- **Cap the size factor at [0.2, 5].** Uncapped, the largest protocols take
  a >10× cut and the smallest a >10× lift; capping keeps the adjustment
  inside what the data can support. Combined model (drop-zero peers + full
  fitted slope + cap): **median error 0.509, bias −0.070, within 2× 29.7%,
  within 3× 46.1%** — the best of 19 variants tried.
- **Per-category LOO (v1)** is uneven in an informative way: RWA (n=9) median
  error 0.328 and CDP (n=3) 0.126 price well; Bridge (n=6) 1.041, Dexs (n=11)
  0.811 and Canonical Bridge (n=8) 0.738 price badly. Bridges' market caps
  appear to be set by things TVL does not record (their own chains' tokens,
  in several cases). This is why v2's bands are calibrated per category
  instead of one width for all.

### Rejected on evidence

- **|7d change| "volatility discount"** (mercenary-capital proxy): alone it
  moved median error 0.693 → 0.690 and worsened bias; combined with the size
  factor it never beat the size factor alone. One weekly change print is too
  little signal to price a discount from. Rejected.
- **Within-category size reference** (adjust vs the category's own median
  TVL): 0.590 vs 0.509 for the global reference. The size effect is a
  market-wide phenomenon, not a within-category one. Rejected.
- **Shrinkage retune (k=5, k=20)**: 0.698 / 0.702 vs 0.693 at k=10. No gain;
  v1's k=10 stands.
- **Removing growth/seasoning/breadth**: all three off gives 0.709 vs 0.693
  on. Each factor is within noise individually; together they are mildly
  positive and the brief for this bounty names growth and time-tokenless as
  model inputs, so they stay — but v2 does not claim accuracy for them.

### Honesty note

The LOO is run on the same snapshot the model is fitted to (the slope and
the shrinkage are in-sample). Leave-one-out removes the subject itself from
its own peer set, which is the leakage that matters most for a median-based
model, but hyperparameter choices (cap, slope strength) were selected on
these same 128 trials. The dashboard therefore reports the LOO as what it
is — a calibration of the model's error on the only labelled data that
exists — not as out-of-sample proof.
