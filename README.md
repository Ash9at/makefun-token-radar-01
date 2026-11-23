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

- **Peer multiple.** For each category, the live protocols of that category answer "what does the market pay for a dollar of TVL here?": the median of `mcap_usd / tvl_usd` across them (at least 3 samples; thinner categories fall back to the median across all live protocols, 0.169× on this snapshot; Dexs peers price at 0.342×, RWA at 0.275×, CDP at 0.169×).
- **Growth factor.** The 7-day TVL change, clamped to [-50%, +150%] and damped: `1 + change × 0.35`, never below 0.55. Momentum counts, one hot week does not double a valuation.
- **Seasoning factor.** Years run with no token recorded (`listed_at` → the snapshot's `as_of`): rises linearly from 0.75 for a brand-new protocol to 1.25 at four years. A launch resting on years of tokenless operation is worth more than one resting on a month.
- **Breadth factor.** +2% per chain beyond the first, up to five extra chains: more deployed surface for a token to govern.

## Selection

The board holds **160 rows**: all **40 watchlist** protocols (the floor), plus the **120 strongest pre-token candidates below the $50M floor** by TVL. A below-floor protocol is a candidate when its record carries no token and it is not an exchange, not a versioned pool of another protocol (name ending in V2 / 2.0 / …), and not a wrapped, staked or bridged derivative of an asset that already trades (Liquid Staking, Liquid Restaking, Restaked BTC, Canonical Bridge, Stablecoin Wrapper categories, or a name carrying the whole word *wrapped*, *staked* or *staking*). Rows are ordered by implied value; exact ties are separated a dollar at a time, so ranks 1..160 each hold one distinct value.

## Farm plans

Every row carries a 7-step plan generated from its own record: a dedicated wallet, the category's real opening action (LP, supply, vault deposit, bridge route, margin, cover…) on its first chain, a second behaviour that separates a user from a balance, a weekly cadence, a hold window scaled to the protocol's age, a conditional claim step (the snapshot records no points programmes, so plans never claim one exists — they say what to do *if* one opens), and a farm log. Each step states its cost and its time.

## Top of the board (this snapshot)

| # | Protocol | Implied | Why |
|---|----------|---------|-----|
| 1 | Steakhouse Financial | $475.2M | Largest pre-token TVL on the board ($2.75B, Risk Curators), 18 months tokenless, 11 chains |
| 2 | Gauntlet | $279.8M | $1.58B TVL and the top tier's only riser this week (+5.6%) |
| 3 | USDD | $175.9M | $1.06B CDP priced at the live CDP peer median |
| 4 | Bittensor dTAO | $96.8M | Dexs peers price TVL at 0.342× — the richest large category multiple |
| 5 | OnRe | $77.9M | RWA at 0.275× on $309M TVL, 16 months seasoned |
| 6 | OpenTrade | $68.1M | RWA peer pricing, near-full seasoning (×0.99) |
| 7 | Nonce Capital | $65.4M | $514M of curator TVL, still young — seasoning only ×0.77 |
| 8 | Plume Vaults | $63.5M | RWA multiple plus breadth across 5 chains |
| 9 | R25 | $45.5M | RWA peer pricing on $198M TVL |
| 10 | RockawayX | $44.7M | $293M curator TVL across 11 chains (breadth ×1.10) |

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
