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

## Stage 2 — model v4, as implemented in lib/model.ts + lib/backtest.ts

- Peer set requires mcap_usd > 0 (dead $0 tokens excluded as evidence).
- Size factor added: fitted log-log slope, strength 1, capped [0.2, 5],
  applied against the peer set's median TVL. Every board row exposes it
  (`model.size_factor`), so the adjustment is auditable per row.
- Bands are calibrated, not peer-spread: lib/backtest.ts runs the LOO
  inside main.ts on every build; each row's low/high is its pricing
  category's interquartile range of signed LOO errors (categories with
  ≥8 trials, shrunk toward the global range with k=8), else the global
  range. On the 128 trials the bands covered the actual cap 47.7% of the
  time — the ~50% an interquartile band should cover, reported on the
  dashboard next to the claim.
- Production numbers (identical trials, identical arithmetic):
  v1 median |log10 error| 0.687–0.693, within 2× 26.6%, within 3× 35.9%,
  bias −0.125. v4: 0.520, 30.5%, 46.1%, bias −0.066. Typical miss improves
  from ×/÷ 4.9 to ×/÷ 3.3. Still wide — the dashboard says so in words.

### Two decisions the data forced

- **The allocator set fell below the floor.** Dropping zero-mcap peers
  left Onchain Capital Allocator with 2 priced peers (concrete, grove)
  against the 3-sample floor, which silently moved every Risk Curators
  row — the board's top — onto the global median. Fix: a category another
  category aliases to keeps its set at any size (`aliasSets`), because the
  alias is a declared judgement and the n/(n+k) shrinkage already prices
  thinness (a 2-sample set carries weight 2/12). The set's own members
  (Veda, Upshift) use it too; pricing curators on a set while pricing the
  set's own members globally would be the real inconsistency.
- **The floor itself was tested, not assumed.** LOO with peer_min_samples
  at 2 and 1 (thin sets for every category): median error 0.544 / 0.556
  vs 0.533 at 3, within-3× 44.5% / 43.8% vs 46.1%. General thin sets hurt;
  the floor stays at 3 and the alias exception stays narrow.
  (`tools/loo_floor_probe.ts` reproduces this.)

## Stage 4 — critique round 1 (quant review) and what the evidence said

An external quant review attacked the methodology on five points. Each was
answered with a measurement, not an argument (`tools/loo_evidence.ts`,
`tools/loo_bands_probe.ts`):

- **"The gain is variant selection on the test set."** Split-half check:
  splitting the 128 subjects into two halves and letting each half select
  its own (size strength, cap) from a grid, both halves independently
  chose strength 1 — and a tighter cap (3) than production used — and each
  half's selected configuration scored on the other half exactly what it
  scored at home (0.455 / 0.589). Selection cost for the size factor's
  constants is approximately zero; the gain is structural. The same check
  changed production: **the cap moved from [0.2, 5] to [1/3, 3]**, which
  also improves the full-set LOO (0.520 → 0.510, typical miss ×/÷3.2,
  bias −0.037, within-3× 46.9%).
- **"Per-category bands are over-shrunk noise."** Partly sustained.
  Per-category coverage ranges from 27% (Dexs) to 67% (RWA) around the
  47.7% average, and sweeping the shrinkage k from 3 to 12 does not fix
  Dexs: its errors are fat-tailed, so an interquartile band covers the
  empty middle. The response is disclosure, not a wider fiction: the
  accuracy table now publishes **band coverage per category** next to the
  other per-category records, and the dashboard text says why.
- **"Correct the survivorship bias instead of disclosing it."** The
  proposed mechanism — an age-based downward adjustment — was fitted
  before it was adopted: across the 95 dated live peers, log(mcap/TVL)
  against years since listing has slope −0.003/year and correlation
  −0.004. There is no age gradient in this snapshot to correct with, so
  the adjustment would be an invented constant wearing a model's clothes.
  Rejected on evidence; the disclosure ("priced the way it prices live
  peers; values lean generous") stands, and the values are framed as
  conditional on a launch being priced like the survivors'.
- **"Replace the factor stack with one regression."** Benchmarked: a
  log-linear OLS of log(mcap) on log(TVL), chains, 7d change, age and a
  missing-age flag scores LOO median error 0.558; adding category dummies
  worsens it to 0.601 (overfitting 128 points); ridge variants land
  0.579–0.587. Every linear variant loses to the peer model's 0.510, and
  the peer model stays legible factor-by-factor in a way a coefficient
  vector is not. Rejected on evidence. (The censored-likelihood Tobit
  variant was not implemented; its linear core was, and lost.)
- **"Growth, seasoning and breadth are noise — drop them."** Half
  sustained. Under the v4 configuration their combined ablation moves the
  median error by 0.010 (0.520 with, 0.510 without — breadth is slightly
  negative, the other two neutral). They stay, because the bounty brief
  names 7-day growth and time-running-tokenless as model inputs, and a
  ×1.00-neutral record adjustment is not an accuracy claim. The README
  states plainly that the accuracy record rests on the peer multiple and
  the size factor, and that the three small factors are within noise.
  Pretending otherwise — in either direction — would be the dishonest
  move.

Final v4 numbers after the cap change (identical trials): median
|log10 error| 0.510 (v1: 0.687), typical miss ×/÷3.2 (v1: ×/÷4.9), bias
−0.037 (v1: −0.129), within 2× 26.6% (v1: 26.6%), within 3× 46.9%
(v1: 35.9%), band coverage 47.7%.

## Stage 4 — critique round 2 (hostile pairwise judge)

A second review played the competition's pairwise judge against a
hypothetical polished rival with a simple TVL × median model. Four
attacks landed; the fixes are in the entry, not just in this file:

- **"The top of the board is TVL × a constant — the size cap saturates."**
  True in effect: every protocol above ~$330M TVL sits at the ×1/3 cap,
  so within the top group the size factor no longer differentiates. The
  cap itself is evidence-chosen (above), so the fix is legibility: the
  model strip now states that the cap binds on the largest protocols and
  why, and every detail view shows the size factor's dollar effect
  ("without it this row would read $70.7M"), so the adjustment reads as a
  measured haircut, not a sort order.
- **"Rank 1 rests on the thinnest evidence plus a manual alias — and you
  showcase it."** The alias is a category-level mapping, declared on
  every row it prices and now also on the peer-evidence table itself
  ("prices Risk Curators by declared alias"); it is not a per-name value,
  which is what the brief prohibits. The showcase point was fair: the
  detail screenshot now shows OnRe (RWA, 9 peers, category-calibrated
  band, 8-row comparables table) instead of the alias-priced rank 1.
- **"Your baseline is your own previous model, not the rival's simple
  approach."** Fixed with data: the accuracy view now scores the two
  naive approaches on the identical 128 trials — TVL × one global median
  (typical miss ×/÷5.3) and TVL × raw category median (×/÷5.0, only
  17.2% within 2×) — beside this model (×/÷3.2) and its predecessor
  (×/÷4.9). The within-2× rate genuinely does not improve over the
  predecessor (26.6% both); the table shows that too, and the gains are
  claimed only where they exist: typical miss, within-3×, and bias.
- **"The backtest can't validate seasoning."** Sustained and now stated
  on the dashboard itself: the trials price protocols that did launch,
  their recorded ages include post-token years, so seasoning is disclosed
  as a record-based adjustment that the backtest cannot validate and the
  ablation shows is accuracy-neutral.

Rejected from this round: dropping the alias (the alternative — pricing
the curator category on the global median — contradicts the snapshot's
own evidence that allocators trade at a fifth of the global multiple,
and the mapping is declared, category-level, and shrinkage-discounted);
making bands protocol-specific (a band is an error range of a pricing
set; per-protocol widths would be fabricated precision — per-category
coverage is the honest answer); and hiding the accuracy view (a measured
record is the strongest evidence the model is real; a rival's clean
number is a claim, ours is a measurement).

## Stage 4 — critique round 3 (the judge re-attacks the revised entry)

- **"Is anything refit inside the folds?"** The slope, peer medians and
  peer sets were always refit per fold (peerMultiples is rebuilt on the
  snapshot-minus-subject for every trial) — but nothing on the page said
  so. It does now, in the accuracy introduction, next to the split-half
  result for the constants that are fixed. The comparison table also
  gained the two ablation rows, so the attribution is visible rather
  than asserted: size factor removed → typical miss ×/÷4.9 (from 3.2);
  record factors removed → unchanged, exactly as disclosed.
- **"Coverage is true by construction."** Fair as far as it went: the
  47.7% figure tested each trial against quantiles that included it.
  Coverage is now measured **leave-self-out** — each trial's band is
  rebuilt from the other trials before testing it. The honest figure is
  46.1%, and it is the one the dashboard prints, overall and per
  category. (The board's bands still use all trials: board rows are not
  trial subjects, so nothing leaks there.)
- **"9 trials but 8 comparables."** A real catch: the comparables table
  truncated at 8 while RWA has 9 priced peers. It now shows up to 12 and
  states the total when truncated ("the 12 largest of 15 priced
  peers"), so the two numbers can never silently disagree again.
- **"Which band does an alias row actually carry?"** Every row now
  records its band source, the detail view labels it ("this pricing
  set's own range" vs "global range — too few blind trials for its
  own"), the accuracy text states the ≥8-trial threshold, and a board
  filter ("own-band pricing only", 51 of 160 rows) lets a reader keep
  only rows priced on sets with their own calibrated band.
- **"No plan totals."** Each detail view now opens the farm plan with an
  all-in estimate — position plus the gas the steps' own per-transaction
  ranges add up to over the first two months, minutes per week, and the
  minimum hold — computed by farmPlanTotals from the same constants the
  step prose quotes, so the summary cannot drift from the steps.
- **Units.** Bias is labelled (log10) in the table header; typical miss
  is defined in the footnote as 10^(median |log10 error|).

Rejected from this round: re-sorting the board by band lower bound —
the board's order is the implied-value ranking the bounty defines, and
the band is printed under every value so overlap is visible rather than
hidden; and deeper plan de-templating — the action and risk steps are
already category-specific (sixteen action families, twenty-one risk
kinds), and the totals line answers the concrete part of the charge.

## Post-audit improvement cycles (2026-11-26)

- **Screenshot density.** The board and filtered captures now render at
  1440 tall instead of 1100, so the judge-scale board screenshot shows
  the full top 10 (the same rows the README's table lists) instead of
  the first six rows. Sizes stay under the renderer's 260 KB ceiling
  and the dossier shrank slightly (1,384,659 bytes).
- **Farm-plan mechanics.** The cadence step's recurring action was
  picked from one generic list for every protocol, so 43 of 160 plans —
  bridges included — prescribed "a vote or second deposit", an action
  those protocols do not offer. The cadence action is now chosen per
  mechanics family (a bridge crosses, a CDP mints or repays, a
  prediction plan takes a position in another market…), the bridge and
  prediction hold steps describe what holding means for them (funds at
  work on the far side; tickets spread across the window), the curator
  second action no longer claims "two curators' shares" for a second
  vault of the same curator, and the DEX risk step picks its article
  from the protocol's name ("an Arrakis … LP position").
- **Sensitivity of the fitted constants** (`tools/loo_sensitivity.ts`,
  identical snapshot, production backtest and board code per variant):

  | variant | LOO median \|log10 err\| | within 3× | top-20 overlap | worst rank move |
  |---|---|---|---|---|
  | production (cap [1/3, 3], strength 1, k 10) | 0.510 | 46.9% | 20/20 | 0 |
  | size cap [0.25, 4] | 0.520 | 46.1% | 20/20 | 5 |
  | size cap [0.5, 2] | 0.556 | 42.2% | 18/20 | 2 |
  | size cap [0.2, 5] (pre-critique) | 0.520 | 46.1% | 20/20 | 5 |
  | size strength 0.8 | 0.540 | 43.0% | 19/20 | 3 |
  | size strength 1.2 | 0.514 | 46.9% | 19/20 | 2 |
  | peer shrinkage k 5 | 0.544 | 46.1% | 19/20 | 9 |
  | peer shrinkage k 20 | 0.537 | 46.9% | 17/20 | 4 |

  No perturbation improves the blind score, and every one keeps at
  least 17 of the top 20 — the production constants sit at the measured
  optimum of their neighbourhood and the ranking is not a tuning
  artefact. No constant was changed.

## Independent audit (2026-11-26) — corrections

An independent audit re-derived every headline figure from the snapshot
with a separate implementation (all 160 board rows and the full LOO
reproduce exactly; the split-half result for the size constants also
replicates: both halves independently select strength 1, cap 3). It
found one real defect, in the comparison rows rather than the model:

- **Three ablation/baseline configurations named model fields that do
  not exist.** `MODEL_NAIVE_GLOBAL` in lib/model.ts, the "record
  factors removed" ablation in lib/backtest.ts, and three variants in
  tools/loo_evidence.ts set `growth_up_weight`, `growth_down_weight`,
  `seasoning_min` and `seasoning_max`; the model's fields are
  `growth_weight_up/down` and `seasoning_new/full`. Node's type
  stripping runs the file without type-checking, so the unknown keys
  were silently ignored: the "naive" baselines still carried the growth
  and seasoning factors, and the "record factors removed" ablation in
  fact removed only breadth. The Stage-4 ablation sentence above (the
  0.520-with / 0.510-without comparison) was measured with the same
  broken configuration and should be read as superseded by the figures
  below.
- **Corrected figures (identical 128 trials, factors genuinely
  removed).** Record factors removed: median |log10 error| 0.518
  (typical miss ×/÷3.3, bias −0.046, within 2× 27.3%, within 3× 47.7%) —
  the accuracy-neutral conclusion stands, marginally less exact than
  printed before. TVL × one global median: 0.715 (×/÷5.2, bias −0.123,
  25.0% / 37.5%). TVL × raw category median: 0.709 (×/÷5.1, bias
  −0.122, 18.8% / 30.5%). The model's own numbers, the v1 head-to-head
  and the size-factor ablation were measured with correct
  configurations and are unchanged. README's table now prints the
  corrected rows.
- Two copy corrections from the same audit: the README's per-category
  coverage range now scopes itself to the categories carrying their own
  band (the full table's extremes are Basis Trading 71.4% on 7 trials
  and Cross Chain Bridge 25.0% on 4), and the dashboard footer no
  longer calls the 24 displayed live rows the "live peer set" (the
  peer set is 128).
- Also measured by the audit, for the record: excluding all CEX
  protocols from both subjects and peer sets moves the headline median
  error from 0.510 to 0.513 (immaterial); the LOO predictions' rank
  correlation with actual caps (Spearman 0.36) is below TVL's own
  (0.44) — the backtest validates the magnitudes it reports, and the
  entry claims nothing about rank skill on labelled data.
