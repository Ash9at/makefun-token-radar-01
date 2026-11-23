# Token Launch Radar

[![token-radar-01 on make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Ash9at/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Ash9at/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

An entry for make.fun's [token-radar-01](https://make.fun/bounty/token-radar-01) bounty — see [make.fun](https://make.fun).

The radar reads the sealed DefiLlama snapshot (758 protocols, fetched 2026-11-14), finds the protocols that record no token yet, ranks them by what their token launch would be worth if their record stayed as it is, and hands in a static dashboard: the ranked board, a detail view per protocol with its farm plan, and filters by category, chain and watchlist membership. Protocols whose token already trades are never ranked — they form the peer set the valuations are priced against.

## The model

Implied value is computed for every row by the same formula, from the snapshot's own figures only — no protocol name is special-cased:

```
implied value = TVL × peer multiple × growth factor × seasoning factor × breadth factor
```

- **Peer multiple.** For each category, the live protocols of that category answer "what does the market pay for a dollar of TVL here?": the median of `mcap_usd / tvl_usd` across them — then shrunk toward the global median across all live protocols (0.169× on this snapshot), on the log scale, weighted by sample count. Raw category medians are fragile evidence: some categories hold three live peers whose multiples span thirty-fold, and a three-sample median presented as exact is false precision. A rich peer set mostly speaks for itself; a thin one mostly inherits the global answer. Categories under 3 samples use the global median outright. One alias is declared in the open: Risk Curators has no live peers, so it is priced on the Onchain Capital Allocator set — the same function, allocating other people's capital — under the same shrinkage (0.078× used, against a raw allocator median of 0.006×). Every row also carries the peer set's p25–p75 band as `implied_low_usd` / `implied_high_usd`, so the value can be read as the range it honestly is. One caveat the board states rather than hides: the peer set conditions on protocols that launched *and survived* to a tradable market cap, so the multiples lean generous — implied values are upper-leaning anchors, not expectations.
- **Growth factor.** The 7-day TVL change, clamped to [-60%, +150%] and damped asymmetrically: rises are weighted 0.15, falls 0.30, never below 0.55. A shrinking protocol is likelier distressed than a rising one is re-rated, so the factor believes bad weeks more than good ones — and still never lets one week dominate a valuation.
- **Seasoning factor.** Years run with no token recorded (`listed_at` → the snapshot's `as_of`): rises linearly from 0.85 for a brand-new protocol to 1.15 at four years. A launch resting on years of tokenless operation is worth more than one resting on a month — but the range is kept narrow, because age is a record, not a promise. A protocol whose listing date is unreported earns the neutral factor 1.00: the model does not impute an age it was not given.
- **Breadth factor.** +1% per chain beyond the first, up to five extra chains. Kept deliberately small: TVL already sums across chains, so breadth is a surface bonus, not a second counting of the same deposits.

## Selection

The board holds **160 rows**: all **40 watchlist** protocols (the floor), plus the **120 strongest pre-token candidates below the $50M floor** by TVL. A below-floor protocol is a candidate when its record carries no token and it is not an exchange, not a versioned pool of another protocol (name ending in V2 / 2.0 / …), and not a wrapped, staked or bridged derivative of an asset that already trades (Liquid Staking, Liquid Restaking, Restaked BTC, Canonical Bridge, Stablecoin Wrapper categories, or a name carrying the whole word *wrapped*, *staked* or *staking*). Rows are ordered by implied value; exact ties are separated a dollar at a time, so ranks 1..160 each hold one distinct value.

## Farm plans

Every row carries a 7-step plan generated from its own record: a dedicated wallet, the category's real opening action (LP, supply, vault deposit, bridge route, margin, cover…) on its first chain, a second behaviour that separates a user from a balance, a cadence, a hold window scaled to the protocol's age, a conditional claim step (the snapshot records no points programmes, so plans never claim one exists — they say what to do *if* one opens), and a closing risk step that names the concrete way this kind of position loses money (impermanent loss, liquidation, depeg, bridge failure, curator misallocation…). The cadence step is honest about two things plans usually fudge: nobody outside the protocol knows what a future programme would count, and on Ethereum the gas for a weekly touch is a heavy drag on a small position — there the plan batches to a fortnightly rhythm and says what it costs. Volume figures in the plans are labelled as working targets, not thresholds, because no threshold is published.

## Top of the board (this snapshot)

| # | Protocol | Implied | Why |
|---|----------|---------|-----|
| 1 | Steakhouse Financial | $214.8M | Largest pre-token TVL on the board ($2.75B), priced as what it is — a curator, on allocator peers (0.078×), not at the generic median |
| 2 | USDD | $175.9M | $1.06B CDP priced at the live CDP peer median (0.169×) |
| 3 | Gauntlet | $124.9M | $1.58B of curated TVL at the allocator multiple, and the top tier's riser this week (+5.6%) |
| 4 | Veda | $122.0M | $1.56B allocator TVL; the shrunk multiple (0.078×) replaces its category's raw 0.006×, which three tiny live peers made noise |
| 5 | Bittensor dTAO | $77.7M | Dexs peers are the richest large category; shrunk to 0.245× on 11 live samples |
| 6 | OnRe | $62.4M | RWA at 0.213× (shrunk, 9 peers) on $309M TVL |
| 7 | OpenTrade | $51.9M | RWA peer pricing, 23 months tokenless |
| 8 | Plume Vaults | $46.5M | RWA multiple across 5 chains |
| 9 | Symbiotic | $42.7M | $254M of collateral-market TVL at the global median — its category has no live peers to price it |
| 10 | Upshift | $41.1M | $499M allocator TVL on 15 chains, up 8.3% this week |

## Run it

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22.18+, standard library only, no network. The program is deterministic: the same snapshot writes the same bytes. It writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (via the vendored `vendor/makefun-board.ts`) into the output directory. Open `out/dashboard/index.html` in a browser — it renders fully offline. Views are linkable: `#detail=<slug>`, `#cat=<category>`, `#chain=<chain>`, `#q=<text>`, `#watch=1`.

The screenshots in `screenshots/` are captures of this dashboard rendered from a real run; `tools/render_screenshots.py` re-creates them (headless Chromium + Pillow).

## Layout

- `main.ts` — the entry program: snapshot in, hand-in out.
- `lib/model.ts` — the model: peer multiples, selection, scoring, farm plans, board validation.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`), phosphor-scope theme, no framework.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte-identical to the kit's.
- `screenshots/` — the board, a detail view, a filtered view.
