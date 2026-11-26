# Token Launch Radar

[![token-radar-01 on make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Ash9at/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Ash9at/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

An entry for make.fun's [token-radar-01](https://make.fun/bounty/token-radar-01) bounty — see [make.fun](https://make.fun).

The radar reads the sealed DefiLlama snapshot (758 protocols, fetched 2026-11-14), finds the protocols that record no token yet, ranks them by what their token launch would be worth if their record stayed as it is, and hands in a static dashboard: the ranked board, a detail view per protocol with its farm plan, filters by category, chain and watchlist membership — and a **model accuracy view that grades the model on the snapshot's own labelled data** (see "Measured accuracy" below). Protocols whose token already trades are never ranked — they form the peer set the valuations are priced against, and the test set the model is graded on.

This is the second version of the entry. The first version's model was honest but unmeasured; this one ships its own backtest, and several of its parts exist because the backtest demanded them. `NOTES.md` is the full build record, including the changes the evidence rejected.

## The record, up front

- **Graded, not asserted.** On 128 blind leave-one-out trials inside the snapshot, this model's typical miss is **×/÷3.2** — the previous version scored ×/÷4.9, and the two simple rivals (TVL × one global median, TVL × raw category median) score ×/÷5.2 and ×/÷5.1. 46.9% of the blind predictions land within 3× of the market cap the protocol actually carries; the bias is −0.04 (log10). The full table, including the rows that flatter nobody, is under "Measured accuracy" below.
- **Bands that were measured.** Each row's range is the model's own backtest error range for its pricing category, not the peer set's spread. Measured leave-self-out, the bands covered the actual cap 46.1% of the time, against the ~50% an interquartile range should cover.
- **Not a tuning artefact.** Perturbing the fitted constants — the size cap, the size strength, the peer shrinkage — never improves the blind score and keeps at least 17 of the top 20 in place (`tools/loo_sensitivity.ts` reproduces this).
- **The board.** 160 pre-token protocols ranked by implied launch value: all 40 watchlist names plus the 120 strongest candidates below the floor, each with its factor breakdown and a 7-step farm plan.

## The model

Implied value is computed for every row by the same formula, from the snapshot's own figures only — no protocol name is special-cased:

```
implied value = TVL × peer multiple × size factor × growth factor × seasoning factor × breadth factor
```

- **Peer multiple.** For each category, the live protocols of that category answer "what does the market pay for a dollar of TVL here?": the median of `mcap_usd / tvl_usd` across them — then shrunk toward the global median across all live protocols (0.214× on this snapshot), on the log scale, weighted by sample count. Only tokens the market actually prices count as peers: 15 snapshot rows record a token at a $0 market cap, and a dead token is not pricing evidence (including them measurably biased the first version's model). Raw category medians are fragile evidence: some categories hold three live peers whose multiples span thirty-fold, and a three-sample median presented as exact is false precision. A rich peer set mostly speaks for itself; a thin one mostly inherits the global answer. Categories under 3 priced samples use the global median outright. One alias is declared in the open: Risk Curators has no live peers, so it is priced on the Onchain Capital Allocator set — the same function, allocating other people's capital. That set has only 2 priced peers, so the shrinkage gives it a weight of 2/12 against the global median (0.133× used, against a raw two-peer median of 0.012×); the set is kept despite the sample floor because the alias is a declared judgement and the shrinkage already prices its thinness — and the evidence table on the dashboard marks the row as an alias rather than burying it. One caveat the board states rather than hides: the peer set conditions on protocols that launched *and survived* to a tradable market cap, so the multiples lean generous — implied values are upper-leaning anchors, conditional on a launch being priced the way the survivors were.
- **Size factor.** The market pays fewer dollars of market cap per dollar of TVL the larger a protocol already is: across the priced peers, log(mcap/TVL) falls with log(TVL) at a slope the program fits itself by least squares (−0.478 on this snapshot). Each row's multiple is adjusted by `10^(slope × (log10 TVL − log10 median peer TVL))`, capped to [×0.33, ×3.00]. The cap binds on the largest protocols, deliberately: uncapped, the backtest showed the fitted slope over-discounting them. This is the one adjustment the backtest credits with a large accuracy gain (below) — and every row exposes its own factor, so the adjustment is auditable per protocol.
- **Growth factor.** The 7-day TVL change, clamped to [-60%, +150%] and damped asymmetrically: rises are weighted 0.15, falls 0.30, never below 0.55. A shrinking protocol is likelier distressed than a rising one is re-rated, so the factor believes bad weeks more than good ones — and still never lets one week dominate a valuation.
- **Seasoning factor.** Years run with no token recorded (`listed_at` → the snapshot's `as_of`): rises linearly from 0.85 for a brand-new protocol to 1.15 at four years. A launch resting on years of tokenless operation is worth more than one resting on a month — but the range is kept narrow, because age is a record, not a promise. A protocol whose listing date is unreported earns the neutral factor 1.00: the model does not impute an age it was not given.
- **Breadth factor.** +1% per chain beyond the first, up to five extra chains. Kept deliberately small: TVL already sums across chains, so breadth is a surface bonus, not a second counting of the same deposits.
- **The band.** Each row's `implied_low_usd` / `implied_high_usd` is not the peer set's spread (that was the first version's band, and it measured the peers' disagreement, not the model's error). It is the interquartile range of the model's own signed errors in the backtest below, for the row's pricing category where that category has at least 8 blind trials (shrunk toward the global range), and the global range otherwise. Every row records which of the two it carries (`band_source`), and the dashboard can filter to the 51 rows carrying their own category's band.

## Measured accuracy

A valuation model that never checks itself is a claim. This one is graded by a **leave-one-out backtest inside the snapshot** (`lib/backtest.ts`, run on every build): each of the 128 protocols whose token trades at a positive market cap is removed from the peer set, priced by the model exactly as a pre-token protocol is priced — peer set, medians and size slope all refitted without it — and the prediction is compared with the market cap it actually carries. Only the model's constants are fixed across trials, and a split-half check (each half of the subjects selecting the constants for itself, then scoring the other half) measured the selection cost of those constants at approximately zero.

| Model (identical 128 blind trials) | Typical miss | Within 2× | Within 3× | Bias (log10) |
|---|---|---|---|---|
| **This model** | **×/÷3.2** | 26.6% | **46.9%** | −0.04 |
| This model, size factor removed | ×/÷4.9 | 24.2% | 33.6% | −0.01 |
| This model, growth/seasoning/breadth removed | ×/÷3.3 | 27.3% | 47.7% | −0.05 |
| Previous version of this radar | ×/÷4.9 | 26.6% | 35.9% | −0.13 |
| TVL × one global median (the simple rival) | ×/÷5.2 | 25.0% | 37.5% | −0.12 |
| TVL × raw category median (the other simple rival) | ×/÷5.1 | 18.8% | 30.5% | −0.12 |

Read the table the way the dashboard prints it — including the rows that flatter nobody:

- The **size factor earns the entire improvement**: remove it and the model falls back to the previous version's record. The peer multiple and its shrinkage do the rest of the work.
- **Growth, seasoning and breadth are accuracy-neutral** (removing all three moves the typical miss from ×/÷3.2 to ×/÷3.3 and slightly *raises* the within-2× and within-3× rates — inside the noise either way). They stay because the brief names 7-day growth and time running tokenless as model inputs and they encode the record honestly at ×1.00-neutral strength — but the accuracy claim does not rest on them, and this table is the proof.
- The within-2× rate does **not** improve over the previous version (26.6% both). The gains are in the typical miss, the within-3× rate, and the bias.
- Per category (on the dashboard, weakest first): the model prices RWA well (typical miss ×/÷1.9, 55.6% within 2×) and DEX protocols badly (×/÷6.4) — bridge and DEX caps are set by things TVL does not record. Bands are calibrated per category precisely so those rows carry visibly wider ranges.
- **Band coverage is 46.1%**, measured leave-self-out (each trial's band rebuilt without it before testing) against the ~50% an interquartile band should cover — close. Among the categories carrying their own band it ranges from 66.7% (RWA) down to 27.3% (Dexs, whose errors are fat-tailed); the dashboard's per-category table prints every category with at least 3 trials, thin ones included.
- The backtest runs on the same snapshot the model is fitted to. Leave-one-out removes the subject from its own peer set, but the constants were chosen with these trials in view. This is a calibration of the model's error on the only labelled data that exists — not out-of-sample proof, and the dashboard says so in those words.

## Selection

The board holds **160 rows**: all **40 watchlist** protocols (the floor), plus the **120 strongest pre-token candidates below the $50M floor** by TVL. A below-floor protocol is a candidate when its record carries no token and it is not an exchange, not a versioned pool of another protocol (name ending in V2 / 2.0 / …), and not a wrapped, staked or bridged derivative of an asset that already trades (Liquid Staking, Liquid Restaking, Restaked BTC, Canonical Bridge, Stablecoin Wrapper categories, or a name carrying the whole word *wrapped*, *staked* or *staking*). Rows are ordered by implied value; exact ties are separated a dollar at a time, so ranks 1..160 each hold one distinct value.

## Farm plans

Every row carries a 7-step plan generated from its own record: a dedicated wallet, the category's real opening action (LP, supply, vault deposit, bridge route, margin, cover…) on its first chain, a second behaviour that separates a user from a balance, a cadence, a hold window scaled to the protocol's age, a conditional claim step (the snapshot records no points programmes, so plans never claim one exists — they say what to do *if* one opens), and a closing risk step that names the concrete way this kind of position loses money (impermanent loss, liquidation, depeg, bridge failure, curator misallocation…). Each detail view opens the plan with its **all-in totals** — the position plus the gas the steps' own per-transaction ranges add up to over the first two months, the minutes per week, and the minimum hold — computed from the same constants the step prose quotes. The cadence step is honest about two things plans usually fudge: nobody outside the protocol knows what a future programme would count, and on Ethereum the gas for a weekly touch is a heavy drag on a small position — there the plan batches to a fortnightly rhythm and says what it costs. Volume figures in the plans are labelled as working targets, not thresholds, because no threshold is published.

## Top of the board (this snapshot)

| # | Protocol | Implied | Why |
|---|----------|---------|-----|
| 1 | Steakhouse Financial | $122.6M | Largest pre-token TVL on the board ($2.75B), priced as what it is — a curator, on allocator peers (0.133×, declared alias) with the size cap applied (×0.33) |
| 2 | Gauntlet | $71.3M | $1.58B of curated TVL on the same allocator set, and the top tier's riser this week (+5.6%) |
| 3 | USDD | $70.3M | $1.06B CDP priced on 3 live CDP peers (0.202×), size-capped |
| 4 | Veda | $69.6M | $1.56B allocator TVL, priced on its own category's thin set under the same shrinkage as the alias it anchors |
| 5 | Bittensor dTAO | $29.0M | Dexs peers are the richest large category (0.274× on 11 peers) — and the category the backtest grades worst, so its band is honestly wide |
| 6 | OnRe | $24.4M | RWA at 0.241× (9 peers) on $309M TVL — the best-graded category in the backtest (×/÷1.9 typical miss) |
| 7 | Upshift | $23.5M | $499M allocator TVL on 15 chains, up 8.3% this week |
| 8 | OpenTrade | $22.8M | RWA peer pricing, 23 months tokenless |
| 9 | Plume Vaults | $21.8M | RWA multiple across 5 chains |
| 10 | Symbiotic | $20.5M | $254M of collateral-market TVL at the global median — its category has no live peers to price it |

## Run it

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22.18+, standard library only, no network. The program is deterministic: the same snapshot writes the same bytes. It writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (via the vendored `vendor/makefun-board.ts`) into the output directory. Open `out/dashboard/index.html` in a browser — it renders fully offline. Views are linkable: `#detail=<slug>`, `#cat=<category>`, `#chain=<chain>`, `#q=<text>`, `#watch=1`, `#validated=1`, `#view=accuracy`.

The screenshots in `screenshots/` are captures of this dashboard rendered from a real run; `tools/render_screenshots.py` re-creates them (headless Chromium + Pillow).

## Layout

- `main.ts` — the entry program: snapshot in, hand-in out.
- `lib/model.ts` — the model: peer multiples, the fitted size factor, selection, scoring, farm plans and their totals, board validation.
- `lib/backtest.ts` — the leave-one-out backtest: accuracy summary, ablations and naive baselines on identical trials, calibrated bands, leave-self-out coverage.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`), phosphor-scope theme, no framework.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte-identical to the kit's.
- `screenshots/` — the board, the accuracy view, a detail view, a filtered view.
- `tools/` — the LOO probes and evidence scripts behind `NOTES.md`, and the screenshot renderer.
- `NOTES.md` — the v2 build record: what the backtest supported, what it rejected (a regression rewrite, a survivorship correction, thinner peer sets), and what the critique rounds changed.
