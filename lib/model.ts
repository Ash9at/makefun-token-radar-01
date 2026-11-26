// Token Launch Radar — the valuation and selection model.
//
// One sealed DefiLlama snapshot goes in; a ranked board of pre-token protocols
// comes out. Everything the board claims is derived from the snapshot's own
// ten fields per protocol. No protocol name is ever special-cased: the same
// arithmetic scores every row, and the dashboard prints the formula so a
// reader can re-run it by hand.
//
// THE MODEL (v4 — NOTES.md records the leave-one-out evidence behind it)
//   peer multiple   For each category, the protocols whose token already
//                   trades give a market answer to "what is a dollar of TVL
//                   worth here?": the median of mcap_usd / tvl_usd across the
//                   live protocols of that category. Raw category medians are
//                   noisy — some categories hold three live peers whose
//                   multiples span thirty-fold — so every category figure is
//                   shrunk toward the global median across all live
//                   protocols, on the log scale, weighted by sample count:
//                   a category with many peers mostly speaks for itself, a
//                   thin one mostly inherits the global answer. Categories under the sample
//                   floor use the global median outright. One alias is
//                   declared: Risk Curators, which has no live peers of its
//                   own, is priced on the Onchain Capital Allocator peer
//                   set — the same economic function, allocating other
//                   people's capital — under the same shrinkage. The board
//                   also carries a calibrated band, described below. Only
//                   protocols whose token the market actually prices
//                   (mcap_usd > 0) count as peers: fifteen snapshot rows
//                   record a token symbol at a $0 market cap, and a dead
//                   token is not pricing evidence.
//   size factor     The market pays fewer dollars of market cap per dollar
//                   of TVL the larger a protocol already is: across the
//                   live set, log(mcap/TVL) falls with log(TVL) at a slope
//                   the program fits itself by least squares (−0.478 on
//                   this snapshot). A row's multiple is adjusted by
//                   10^(slope × (log10 TVL − log10 median peer TVL)),
//                   capped to [1/3, 3] so no row is moved further than the
//                   evidence reaches. This is the one adjustment the
//                   leave-one-out backtest credits with a large accuracy
//                   gain (median log error 0.687 → 0.510); it is a
//                   market-wide effect, measured against the whole peer
//                   set, not within a category.
//   growth factor   Seven-day TVL momentum, clamped to [-60%, +150%] and
//                   damped asymmetrically: a fall is weighted twice a rise,
//                   because a shrinking protocol is likelier distressed than
//                   a rising one is re-rated. factor = 1 + pct/100 * weight,
//                   never below 0.55. An unreported change counts as zero.
//   seasoning       How long the protocol has run with no token recorded,
//                   from listed_at to the snapshot's as_of. A launch after
//                   years of tokenless operation rests on a longer record
//                   than one after a month: factor rises linearly from 0.85
//                   (brand new) to 1.15 at four years and holds there. An
//                   unreported listing date earns the neutral factor 1.0 —
//                   the model does not invent an age it was not given.
//   breadth         Half a point of value per additional chain beyond the
//                   first, up to five: a protocol already deployed on six
//                   chains has more surface for a token to govern. Kept
//                   small, because TVL already sums across chains.
//   implied value   round(tvl * peer_multiple * size * growth * seasoning
//                   * breadth). The peer set conditions on protocols that
//                   launched and survived to a tradable market cap, so the
//                   multiples lean generous: read every implied value as an
//                   upper-leaning anchor.
//   the band        Each row's low/high is not the peer set's spread (that
//                   measures the peers' disagreement, not this model's
//                   error). It is calibrated on the leave-one-out backtest
//                   in lib/backtest.ts: the interquartile range of the
//                   model's own signed log errors on the protocols it
//                   priced blind, per category where the trials suffice
//                   and global otherwise — so a category the model prices
//                   badly (bridges) honestly carries a wider band than one
//                   it prices well (RWA).
//
// THE BOARD
//   Every watchlist slug is ranked (the floor). Below the floor, the radar
//   adds the EARLY_ROWS pre-token protocols with the most TVL that are still
//   candidates for a token of their own: not an exchange, not a versioned
//   pool of another protocol, not a wrapped/staked/bridged derivative of an
//   asset that already trades, and not named as one. Rows are ordered by
//   implied value; exact ties are separated a dollar at a time so the order
//   is a true ranking, rank 1 the most valuable.

/** One protocol of the snapshot: exactly the ten fields the sealed input carries. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's tunable constants, printed in the dashboard's model panel. */
export interface RadarModel {
  growth_weight_up: number;
  growth_weight_down: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  growth_min_factor: number;
  seasoning_new: number;
  seasoning_full: number;
  seasoning_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  peer_min_samples: number;
  peer_shrink_k: number;
  /** Peers must record a market cap above zero: a $0 token is not pricing evidence. */
  peer_positive_mcap_only: boolean;
  /** Whether the declared category alias (PEER_ALIAS) may price a peerless category. Off for naive baselines. */
  peer_alias_enabled: boolean;
  /** Strength of the fitted size factor: 0 disables it, 1 applies the fitted slope in full. */
  size_strength: number;
  size_cap_low: number;
  size_cap_high: number;
}

export const MODEL: RadarModel = {
  growth_weight_up: 0.15,
  growth_weight_down: 0.3,
  growth_floor_pct: -60,
  growth_cap_pct: 150,
  growth_min_factor: 0.55,
  seasoning_new: 0.85,
  seasoning_full: 1.15,
  seasoning_days: 1460,
  breadth_per_chain: 0.01,
  breadth_max_chains: 5,
  peer_min_samples: 3,
  peer_shrink_k: 10,
  peer_positive_mcap_only: true,
  peer_alias_enabled: true,
  size_strength: 1,
  size_cap_low: 1 / 3,
  size_cap_high: 3,
};

export const MODEL_NAME = 'peer-multiple radar, v4 (LOO-calibrated)';

/** The v1 model as submitted in the first entry, kept so the backtest can score it head-to-head. */
export const MODEL_V1: RadarModel = {
  ...MODEL,
  peer_positive_mcap_only: false,
  size_strength: 0,
};

/** The simplest rival: every protocol at TVL × the one global median multiple. No factors at all. */
export const MODEL_NAIVE_GLOBAL: RadarModel = {
  ...MODEL_V1,
  peer_alias_enabled: false,
  peer_min_samples: Number.MAX_SAFE_INTEGER,
  growth_weight_up: 0,
  growth_weight_down: 0,
  seasoning_new: 1,
  seasoning_full: 1,
  breadth_per_chain: 0,
};

/** The other simple rival: TVL × the raw category median, no shrinkage, no factors. */
export const MODEL_NAIVE_CATEGORY: RadarModel = {
  ...MODEL_NAIVE_GLOBAL,
  peer_min_samples: 3,
  peer_shrink_k: 0,
};

/** Pre-token protocols below the watchlist floor that the board adds, by TVL. */
export const EARLY_ROWS = 120;

/** Live-token protocols the dashboard keeps aside as the market's own answer. */
export const LIVE_ROWS = 24;

/** One ranked row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  /** The model's calibrated error band for this row's pricing set (lib/backtest.ts), not a peer spread. */
  implied_low_usd: number;
  implied_high_usd: number;
  /** Which calibrated band the row carries: its pricing category's own, or the global range. */
  band_source: 'category' | 'global';
  model: {
    peer_multiple: number;
    peer_basis: string;
    peer_samples: number;
    size_factor: number;
    growth_pct: number;
    growth_factor: number;
    seasoning_factor: number;
    breadth_factor: number;
  };
  farm_steps: string[];
  /** The plan's all-in totals, from the same constants the steps quote. */
  plan: PlanTotals;
}

/** The dashboard's copy of one board row (farm plan included: the detail view shows it). */
export interface DashRow extends BoardRow {}

/** A protocol whose token already trades: shown at the market's value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** One peer set's summary, for the dashboard's evidence table. */
export interface PeerRow {
  category: string;
  samples: number;
  multiple: number;
  p25: number;
  p75: number;
  /** Set when this row is a declared alias set: the category it prices. */
  alias_for?: string;
}

/** A row's calibrated band as multiplicative factors on its implied value. */
export interface BandFactors {
  low: number;
  high: number;
}

/** Calibrated bands: per pricing category where trials suffice, plus the global fallback. */
export interface BandBook {
  byCategory: Map<string, BandFactors>;
  global: BandFactors;
}

/** One live peer behind a category's multiple, for a detail view's comparables table. */
export interface PeerComparable {
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  multiple: number;
}

/** One category's leave-one-out record, for the dashboard's accuracy view. */
export interface AccuracyCategory {
  category: string;
  trials: number;
  median_abs_log10: number;
  bias_log10: number;
  within_2x_pct: number;
  /** Share of this category's blind trials whose actual cap fell inside the band its rows carry. */
  band_coverage_pct: number;
}

/** The leave-one-out backtest's summary, computed by lib/backtest.ts and shown on the accuracy view. */
export interface AccuracySummary {
  subjects: number;
  excluded_zero_mcap: number;
  median_abs_log10: number;
  /** The same figure as a plain multiple: the typical prediction is off by this factor. */
  typical_factor: number;
  bias_log10: number;
  within_2x_pct: number;
  within_3x_pct: number;
  /** Share of blind predictions whose calibrated band contained the actual market cap. */
  band_coverage_pct: number;
  /** |log10 error| histogram: bin label, trial count. */
  histogram: { label: string; count: number }[];
  categories: AccuracyCategory[];
  /** The v1 model's record on the identical trials, for the head-to-head. */
  v1: {
    median_abs_log10: number;
    typical_factor: number;
    bias_log10: number;
    within_2x_pct: number;
    within_3x_pct: number;
  };
  /** The naive approaches a simpler entry would take, scored on the identical trials. */
  baselines: {
    label: string;
    median_abs_log10: number;
    typical_factor: number;
    bias_log10: number;
    within_2x_pct: number;
    within_3x_pct: number;
  }[];
}

/** Everything data.js carries to the page. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_name: string;
  model: RadarModel;
  universe_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: DashRow[];
  live: LiveRow[];
  peers: PeerRow[];
  /** The largest priced live peers per category, for detail-view comparables tables. */
  comparables: Record<string, { peers: PeerComparable[]; total: number }>;
  /** Present when main.ts ran the backtest: the model's measured record on blind pricing trials. */
  accuracy?: AccuracySummary;
}

/** The snapshot text is not a document this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Whole days from a listing date to the snapshot date; null when either is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether the protocol's record carries a token: any of mcap, gecko id or symbol present. */
export function recordsToken(p: Protocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** One peer set's pricing: the shrunk median multiple and its shrunk interquartile band. */
export interface PeerStat {
  multiple: number;
  low: number;
  high: number;
  samples: number;
}

/** Every peer set the model can price from: per category, plus the global fallback. */
export interface PeerBook {
  byCategory: Map<string, PeerStat>;
  global: PeerStat;
  /**
   * Sets kept for declared aliases only (see PEER_ALIAS): an alias target
   * below the sample floor. The alias is a declared economic judgement, and
   * the shrinkage already prices the thinness — a two-sample set carries a
   * weight of 2/(2+k) against the global median — so the set is used at
   * whatever size it has rather than discarded outright.
   */
  aliasSets: Map<string, PeerStat>;
  /** Least-squares slope of log10(mcap/TVL) on log10(TVL) across the peer set; 0 when it cannot be fitted. */
  sizeSlope: number;
  /** Median TVL of the peer set: the size factor's reference point. */
  sizeRefTvl: number;
}

/** A quantile of a sorted list, nearest-rank: enough for a band, not a thesis. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[at]!;
}

/**
 * Pull a category figure toward the global one; the fewer the samples, the
 * harder the pull. The blend runs on the log scale: multiples are ratios
 * spanning orders of magnitude, so a thin category's evidence should move
 * the global answer multiplicatively, never drag it past the scale of its
 * own samples — three peers agreeing on 0.006 stay a small number, three
 * disagreeing by thirty-fold land near the middle.
 */
function shrink(raw: number, globalRaw: number, samples: number, k: number): number {
  const w = samples / (samples + k);
  const a = Math.max(raw, 1e-4);
  const b = Math.max(globalRaw, 1e-4);
  return Math.exp(w * Math.log(a) + (1 - w) * Math.log(b));
}

function statOf(ratios: number[], globalRatios: number[] | null, model: RadarModel): PeerStat {
  const sorted = [...ratios].sort((a, b) => a - b);
  const med = median(sorted);
  const lo = quantile(sorted, 0.25);
  const hi = quantile(sorted, 0.75);
  if (globalRatios === null) return { multiple: med, low: lo, high: hi, samples: ratios.length };
  const gSorted = [...globalRatios].sort((a, b) => a - b);
  return {
    multiple: shrink(med, median(gSorted), ratios.length, model.peer_shrink_k),
    low: shrink(lo, quantile(gSorted, 0.25), ratios.length, model.peer_shrink_k),
    high: shrink(hi, quantile(gSorted, 0.75), ratios.length, model.peer_shrink_k),
    samples: ratios.length,
  };
}

/**
 * The peer multiples: for every category with at least peer_min_samples live
 * protocols, the median mcap/TVL of those protocols, shrunk toward the
 * global median across all live protocols; the global set itself is the
 * fallback for categories too thin to price.
 */
export function peerMultiples(snapshot: Snapshot, model: RadarModel = MODEL): PeerBook {
  const live = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.tvl_usd > 0 && (!model.peer_positive_mcap_only || p.mcap_usd > 0),
  );
  const allRatios = live.map((p) => p.mcap_usd! / p.tvl_usd);
  const global: PeerStat =
    allRatios.length > 0 ? statOf(allRatios, null, model) : { multiple: 0.2, low: 0.1, high: 0.4, samples: 0 };
  const groups = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = groups.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    groups.set(p.category, list);
  }
  const byCategory = new Map<string, PeerStat>();
  for (const [category, ratios] of groups) {
    if (ratios.length >= model.peer_min_samples) byCategory.set(category, statOf(ratios, allRatios, model));
  }
  const aliasSets = new Map<string, PeerStat>();
  if (model.peer_alias_enabled) {
    for (const target of Object.values(PEER_ALIAS)) {
      if (byCategory.has(target)) continue;
      const ratios = groups.get(target);
      if (ratios !== undefined && ratios.length > 0) aliasSets.set(target, statOf(ratios, allRatios, model));
    }
  }
  // The size effect, fitted on the same peer set the multiples come from:
  // least squares of log10(mcap/TVL) on log10(TVL). Too few peers, no spread
  // in TVL, or a non-finite fit all leave the slope at 0 (no adjustment).
  let sizeSlope = 0;
  let sizeRefTvl = 0;
  if (live.length > 0) {
    const tvls = live.map((p) => p.tvl_usd).sort((a, b) => a - b);
    sizeRefTvl = tvls[Math.floor(tvls.length / 2)]!;
  }
  if (live.length >= 8) {
    const xs = live.map((p) => Math.log10(p.tvl_usd));
    const ys = live.map((p) => Math.log10(Math.max(p.mcap_usd!, 1) / p.tvl_usd));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i]! - mx) * (ys[i]! - my);
      den += (xs[i]! - mx) ** 2;
    }
    const slope = den > 0 ? num / den : 0;
    if (Number.isFinite(slope)) sizeSlope = slope;
  }
  return { byCategory, global, aliasSets, sizeSlope, sizeRefTvl };
}

/**
 * Categories with no live peers of their own that are priced on a sibling
 * set performing the same economic function. Risk Curators allocate other
 * people's capital into vaults; so do Onchain Capital Allocators, and that
 * set has live tokens to price from.
 */
const PEER_ALIAS: Record<string, string> = { 'Risk Curators': 'Onchain Capital Allocator' };

/** Categories that some other category is priced on by alias: their thin sets are declared evidence. */
const ALIAS_TARGETS = new Set(Object.values(PEER_ALIAS));

/** The peer set one protocol is priced on, where it came from, and the category its band is calibrated on. */
function multipleFor(p: Protocol, peers: PeerBook, model: RadarModel): { stat: PeerStat; basis: string; bandCategory: string | null } {
  if (p.category !== null) {
    const direct = peers.byCategory.get(p.category);
    if (direct !== undefined) {
      return { stat: direct, basis: `shrunk median of ${direct.samples} live ${p.category} peers`, bandCategory: p.category };
    }
    // A category another category aliases to is declared pricing evidence
    // for its economic function; its own members use its thin set too —
    // pricing the curators on a set while pricing the set's own members on
    // the global median would be the real inconsistency.
    if (model.peer_alias_enabled && ALIAS_TARGETS.has(p.category)) {
      const own = peers.aliasSets.get(p.category);
      if (own !== undefined) {
        return {
          stat: own,
          basis: `${p.category}'s own live set is thin (${own.samples} priced peers) and is the declared pricing set for this allocation function, used under the same shrinkage toward the global median`,
          bandCategory: p.category,
        };
      }
    }
    const alias = model.peer_alias_enabled ? PEER_ALIAS[p.category] : undefined;
    if (alias !== undefined) {
      const via = peers.byCategory.get(alias) ?? peers.aliasSets.get(alias);
      if (via !== undefined) {
        return {
          stat: via,
          basis: `${p.category} has no live peers; priced on ${via.samples} live ${alias} peers, the same allocation function, shrunk toward the global median`,
          bandCategory: alias,
        };
      }
    }
  }
  return { stat: peers.global, basis: `global median of ${peers.global.samples} live protocols (no usable category peers)`, bandCategory: null };
}

/** The peer sets as rows for the dashboard's evidence table, richest set first, fallback last. */
export function peerRows(snapshot: Snapshot, model: RadarModel = MODEL): PeerRow[] {
  const peers = peerMultiples(snapshot, model);
  const rows: PeerRow[] = [...peers.byCategory.entries()]
    .map(([category, s]) => ({ category, samples: s.samples, multiple: round4(s.multiple), p25: round4(s.low), p75: round4(s.high) }))
    .sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1));
  // Declared alias sets are evidence too: they price another category, and
  // the evidence table says so on the row itself rather than hiding the
  // mapping in a detail view's small print.
  for (const [category, s] of peers.aliasSets) {
    const aliasFor = Object.keys(PEER_ALIAS).find((k) => PEER_ALIAS[k] === category);
    rows.push({
      category,
      samples: s.samples,
      multiple: round4(s.multiple),
      p25: round4(s.low),
      p75: round4(s.high),
      ...(aliasFor !== undefined ? { alias_for: aliasFor } : {}),
    });
  }
  rows.push({
    category: 'All live protocols (the fallback)',
    samples: peers.global.samples,
    multiple: round4(peers.global.multiple),
    p25: round4(peers.global.low),
    p75: round4(peers.global.high),
  });
  return rows;
}

/** The four factors and the implied value one protocol earns under the model. */
export function scoreProtocol(
  p: Protocol,
  asOf: string,
  peers: PeerBook,
  model: RadarModel = MODEL,
): {
  implied: number;
  impliedLow: number;
  impliedHigh: number;
  multiple: number;
  basis: string;
  samples: number;
  bandCategory: string | null;
  sizeFactor: number;
  growthPct: number;
  growthFactor: number;
  seasoningFactor: number;
  breadthFactor: number;
  age: number | null;
} {
  const age = ageDays(asOf, p.listed_at);
  const { stat, basis, bandCategory } = multipleFor(p, peers, model);
  // The size factor: the fitted slope applied to this protocol's distance
  // from the peer set's median TVL, capped to the range the evidence reaches.
  const sizeFactor =
    model.size_strength === 0 || peers.sizeRefTvl <= 0 || p.tvl_usd <= 0
      ? 1
      : Math.min(
          model.size_cap_high,
          Math.max(
            model.size_cap_low,
            Math.pow(10, peers.sizeSlope * model.size_strength * (Math.log10(p.tvl_usd) - Math.log10(peers.sizeRefTvl))),
          ),
        );
  const growthPct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, p.change_7d ?? 0));
  const weight = growthPct >= 0 ? model.growth_weight_up : model.growth_weight_down;
  const growthFactor = Math.max(model.growth_min_factor, 1 + (growthPct / 100) * weight);
  // No recorded age earns no seasoning either way: the neutral factor, not an imputed age.
  const seasoningFactor =
    age === null
      ? 1
      : model.seasoning_new +
        (Math.min(Math.max(age, 0), model.seasoning_days) / model.seasoning_days) * (model.seasoning_full - model.seasoning_new);
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_chains);
  const breadthFactor = 1 + extraChains * model.breadth_per_chain;
  const rest = sizeFactor * growthFactor * seasoningFactor * breadthFactor;
  const implied = Math.max(1, Math.round(p.tvl_usd * stat.multiple * rest));
  const impliedLow = Math.min(implied, Math.max(1, Math.round(p.tvl_usd * stat.low * rest)));
  const impliedHigh = Math.max(implied, Math.max(1, Math.round(p.tvl_usd * stat.high * rest)));
  return {
    implied,
    impliedLow,
    impliedHigh,
    multiple: stat.multiple,
    basis,
    samples: stat.samples,
    bandCategory,
    sizeFactor,
    growthPct,
    growthFactor,
    seasoningFactor,
    breadthFactor,
    age,
  };
}

/** A name that marks a later release of another protocol: it is a pool, not a launch candidate. */
const VERSION_SUFFIX = /\s(?:V|v)\d+(?:\.\d+)?$|\s\d+\.\d+$/;

/** Categories whose product is a derivative of an asset that already trades. */
const DERIVATIVE_CATEGORIES = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Canonical Bridge', 'Stablecoin Wrapper']);

/** Whole words that mark a wrapped or staked product of someone else's asset. */
const DERIVATIVE_NAME = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a pre-token protocol below the floor is a launch candidate of its
 * own: not an exchange, not a versioned pool, not a derivative product.
 */
export function isCandidate(p: Protocol): boolean {
  if (recordsToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (DERIVATIVE_NAME.test(p.name)) return false;
  return true;
}

/** The protocols the board ranks: the whole watchlist, then the strongest candidates below the floor. */
export function selectProtocols(snapshot: Snapshot): Protocol[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && isCandidate(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  return [...chosen.values()];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The ranked board: scored, ordered by implied value, ties separated a dollar
 * at a time. When a BandBook is given, each row's low/high come from the
 * backtest's calibrated error band for its pricing category (or the global
 * band); without one, the peer set's own interquartile band is used, as v1 did.
 */
export function buildBoard(snapshot: Snapshot, model: RadarModel = MODEL, bands: BandBook | null = null): BoardRow[] {
  const peers = peerMultiples(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const scored = selectProtocols(snapshot).map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, peers, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  // Separate exact ties by a dollar so no two rows share a value and the order never rises.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.s.implied >= scored[i - 1]!.s.implied) scored[i]!.s.implied = Math.max(1, scored[i - 1]!.s.implied - 1);
  }
  return scored.map(({ p, s }, i) => {
    const band = bands === null ? null : ((s.bandCategory !== null ? bands.byCategory.get(s.bandCategory) : undefined) ?? bands.global);
    const impliedLow =
      band === null ? s.impliedLow : Math.min(s.implied, Math.max(1, Math.round(s.implied * band.low)));
    const impliedHigh = band === null ? s.impliedHigh : Math.max(s.implied, Math.round(s.implied * band.high));
    return {
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_low_usd: impliedLow,
    implied_high_usd: impliedHigh,
    band_source:
      bands !== null && s.bandCategory !== null && bands.byCategory.has(s.bandCategory) ? 'category' : 'global',
    model: {
      peer_multiple: round4(s.multiple),
      peer_basis: s.basis,
      peer_samples: s.samples,
      size_factor: round4(s.sizeFactor),
      growth_pct: Math.round(s.growthPct * 100) / 100,
      growth_factor: round4(s.growthFactor),
      seasoning_factor: round4(s.seasoningFactor),
      breadth_factor: round4(s.breadthFactor),
    },
    farm_steps: farmPlan(p, s.age),
    plan: farmPlanTotals(p, s.age),
    };
  });
}

/** The live-token protocols, by market cap: the market's own values, kept off the ranked board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : null,
    }));
}

/** The largest priced live peers of each category, richest-TVL first, for comparables tables. */
function comparablesByCategory(snapshot: Snapshot): Record<string, { peers: PeerComparable[]; total: number }> {
  const groups = new Map<string, PeerComparable[]>();
  for (const p of snapshot.protocols) {
    if (p.category === null || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const list = groups.get(p.category) ?? [];
    list.push({ name: p.name, mcap_usd: p.mcap_usd, tvl_usd: p.tvl_usd, multiple: round4(p.mcap_usd / p.tvl_usd) });
    groups.set(p.category, list);
  }
  const out: Record<string, { peers: PeerComparable[]; total: number }> = {};
  for (const [category, list] of groups) {
    const sorted = list.sort((a, b) => b.tvl_usd - a.tvl_usd);
    out[category] = { peers: sorted.slice(0, 12), total: sorted.length };
  }
  return out;
}

/** The board and the dashboard's data, from one snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: RadarModel = MODEL,
  extra: { bands?: BandBook; accuracy?: AccuracySummary } = {},
): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model, extra.bands ?? null);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_name: MODEL_NAME,
    model,
    universe_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board,
    live,
    peers: peerRows(snapshot, model),
    comparables: comparablesByCategory(snapshot),
    ...(extra.accuracy !== undefined ? { accuracy: extra.accuracy } : {}),
  };
  return { board, radar };
}

/** Parse and validate the snapshot document; anything else is a SnapshotError. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) throw new SnapshotError('snapshot.json: as_of is not a date');
  if (typeof doc.source !== 'string' || doc.source.length === 0) throw new SnapshotError('snapshot.json: source is missing');
  if (!isNum(doc.floor_usd) || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) throw new SnapshotError('snapshot.json: floor_usd is not a positive whole number');
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json: protocols is not an array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json: watchlist is not a list of slugs');
  const protocols = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new SnapshotError(`snapshot.json: protocol ${i} is not an object`);
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || !isNum(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json: protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: isNum(p.change_7d) ? p.change_7d : null,
      mcap_usd: isNum(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: doc.as_of, source: doc.source, floor_usd: doc.floor_usd, protocols, watchlist: doc.watchlist as string[] };
}

/** Why a board fails the gate, or null when it passes: coverage, ranks, order, values, farm plans. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const inSnapshot = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!inSnapshot.has(row.slug)) return `${row.slug} is not a protocol of the snapshot`;
    if (seen.has(row.slug)) return `${row.slug} appears twice`;
    seen.add(row.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `rank ${i + 1} is held by ${byRank[i]!.slug} with rank ${byRank[i]!.rank}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} is worth more than rank ${i}`;
    if (!Number.isSafeInteger(byRank[i]!.implied_value_usd) || byRank[i]!.implied_value_usd <= 0) return `${byRank[i]!.slug} has a bad implied value`;
    const steps = byRank[i]!.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${byRank[i]!.slug} has ${steps.length} farm steps`;
    for (const step of steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${byRank[i]!.slug} has a farm step of ${len} characters`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  return null;
}

/** data.js: the dashboard's dataset as one script assignment, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// ---------------------------------------------------------------- farm plans
//
// A plan is assembled from the protocol's own record: its name, its category's
// mechanics, its chains, its size (which sets the capital a sensible position
// needs), its momentum and its age (which sets how long a qualifying window
// runs). Wording rotates on a hash of the slug so two protocols of one
// category do not read as photocopies, while every number in the text is the
// protocol's own. Points and rewards are always spoken of conditionally: the
// snapshot records none, so the plan never claims one exists.

/** A small stable hash of a slug, for wording rotation. */
function slugHash(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(slug: string, salt: number, options: readonly T[]): T {
  return options[(slugHash(slug) + salt) % options.length]!;
}

/** $1,234 / $12.3M / $1.23B formatting for the plan text and the page. */
export function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/** The capital a sensible qualifying position needs, scaled to the protocol's size. */
function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 5e9) return 250;
  if (p.tvl_usd >= 1e9) return 200;
  if (p.tvl_usd >= 2.5e8) return 120;
  if (p.tvl_usd >= 5e7) return 80;
  return 50;
}

/** Rough per-transaction gas on the protocol's first chain, in dollars. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return '$4–10';
  if (chain === 'Bitcoin') return '$1–3';
  return '$0.05–1.50';
}

/** The same gas range as numbers, for the plan's all-in estimate. */
function gasRangeFor(chain: string): { low: number; high: number } {
  if (chain === 'Ethereum') return { low: 4, high: 10 };
  if (chain === 'Bitcoin') return { low: 1, high: 3 };
  return { low: 0.05, high: 1.5 };
}

/** A farm plan's totals, derived from the same constants its steps quote. */
export interface PlanTotals {
  position_usd: number;
  /** Estimated gas across the plan's first two months: opening + second action + the cadence touches. */
  gas_low_usd: number;
  gas_high_usd: number;
  minutes_per_week: number;
  hold_days: number;
}

/**
 * What following the plan costs, all-in: the position the steps commit,
 * the gas the steps' own per-transaction ranges add up to over the first
 * two months (1 opening + 2 second-action sessions + 8 weekly cadence
 * touches, or 4 fortnightly ones on Ethereum, matching the cadence step's
 * own rhythm), the weekly minutes, and the minimum hold.
 */
export function farmPlanTotals(p: Protocol, age: number | null): PlanTotals {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const g = gasRangeFor(chain);
  const touches = chain === 'Ethereum' ? 4 : 8;
  const actions = 3 + touches;
  return {
    position_usd: capitalFor(p),
    gas_low_usd: Math.round(actions * g.low * 100) / 100,
    gas_high_usd: Math.round(actions * g.high * 100) / 100,
    minutes_per_week: chain === 'Ethereum' ? 5 : 10,
    hold_days: holdDaysFor(age),
  };
}

/** How long a position should be held to count, from the protocol's age. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 30;
  if (age < 730) return 45;
  return 30;
}

/** A human span for an age in days. */
function ageText(age: number | null): string {
  if (age === null) return 'an unreported start date';
  if (age < 90) return `${age} days`;
  if (age < 730) return `${Math.round(age / 30.4)} months`;
  return `${(age / 365.25).toFixed(1)} years`;
}

/** The mechanics family a category belongs to; drives the plan's core actions. */
function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('liquidity')) return 'dex';
  if (c.includes('lend') || c.includes('collateral')) return 'lending';
  if (c.includes('cdp') || c.includes('stablecoin issuer') || c.includes('algo-stable') || c.includes('dual-token')) return 'mint';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('staking pool') || c.includes('restak')) return 'staking';
  if (c.includes('derivative') || c.includes('option') || c.includes('synthetic') || c.includes('perpetual')) return 'trading';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('rwa') || c.includes('index')) return 'asset';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('launchpad')) return 'launchpad';
  if (c.includes('chain')) return 'chain';
  if (c.includes('payment') || c.includes('card')) return 'payments';
  if (c.includes('privacy')) return 'privacy';
  if (c.includes('yield') || c.includes('farm') || c.includes('basis') || c.includes('leveraged')) return 'yield';
  return 'core';
}

/** The plan's opening position: the one action that makes a wallet a user of this protocol. */
function openingAction(p: Protocol, family: string, capital: number, chain: string): string {
  const n = p.name;
  switch (family) {
    case 'dex':
      return `Add $${capital} of liquidity to a core ${n} pool on ${chain} (a stable or blue-chip pair keeps impermanent loss low) and leave the LP position open.`;
    case 'lending':
      return `Supply $${capital} of USDC or ETH to ${n} on ${chain}; a plain supplied balance is the position everything else in this plan builds on.`;
    case 'mint':
      return `Deposit $${capital} of collateral into ${n} on ${chain} and mint a conservative amount of its stable asset, keeping the collateral ratio well above liquidation.`;
    case 'bridge':
      return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, then put the bridged funds to work in an app on the far side instead of bridging straight back.`;
    case 'staking':
      return `Stake $${capital} of the network asset through ${n} on ${chain} and keep the staking receipt in the same wallet.`;
    case 'trading':
      return `Deposit $${capital} of USDC margin into ${n} on ${chain} and open one small hedged position rather than a directional bet.`;
    case 'prediction':
      return `Fund the wallet with $${capital} and take one position in a liquid ${n} market on ${chain}, sized so a total loss is acceptable.`;
    case 'curator':
      return `Deposit $${capital} into one of the ${n} vaults on ${chain} with the longest track record and hold the vault shares.`;
    case 'asset':
      return `Mint or buy $${capital} of the ${n} asset on ${chain} through its own app and hold it in the farming wallet.`;
    case 'insurance':
      return `Buy about $${capital} of cover from ${n} on ${chain} against a position you actually hold, and keep the policy to term.`;
    case 'launchpad':
      return `Register the wallet with ${n} on ${chain} and complete its identity or allowlist steps before any sale opens, with $${capital} ready.`;
    case 'chain':
      return `Bridge $${capital} to ${chain} and use ${n}'s native apps — a swap and a lending deposit — so the wallet has real activity on the chain.`;
    case 'payments':
      return `Sign up to ${n}, fund it with $${capital} and route one real payment or card purchase through it on ${chain}.`;
    case 'privacy':
      return `Deposit $${capital} into ${n}'s shielded pool on ${chain} and make one private transfer to a second wallet you control.`;
    case 'yield':
      return `Deposit $${capital} into the main ${n} strategy on ${chain} and keep the receipt shares; do not chase the highest-APY pool.`;
    default:
      return `Deposit $${capital} into ${n} on ${chain} through its own app and keep the position open; that balance is the wallet's qualifying stake.`;
  }
}

/** The plan's second, category-specific action: the behaviour that separates a farmer from a passer-by. */
function secondAction(p: Protocol, family: string, capital: number, chain: string): string {
  const n = p.name;
  switch (family) {
    case 'dex':
      return `Route your regular swaps on ${chain} through ${n} as well — a working target is $${capital * 4} of cumulative swap volume a month (a discipline goal, not a published threshold), spread over several days, never in one block.`;
    case 'lending':
      return `Borrow a stablecoin against the supply, keeping the loan under 30% of its value and the health factor above 2, and repay it a week later; one clean borrow-repay cycle shows the wallet uses both sides of ${n}.`;
    case 'mint':
      return `Use the minted asset inside ${n}'s ecosystem — hold it or deposit it in its stability pool — rather than selling it the same day.`;
    case 'bridge':
      return `Repeat the route in the opposite direction two weeks later with a different amount; varied, spaced crossings read as use, not as a single airdrop hop.`;
    case 'staking':
      return `Restake or delegate a slice of the receipt once, if ${n} offers it natively, and vote in any governance poll the staking position entitles you to.`;
    case 'trading':
      return `Trade on at least six separate days in the month, small size each time; a month of small prints is a more credible history than one large trade.`;
    case 'prediction':
      return `Take positions in three different markets over the month and let at least one settle; a settled position is a finished record, not an open bet.`;
    case 'curator':
      return `Split a second, smaller deposit across a different ${n} vault so the wallet holds two curators' shares, and rebalance once a quarter.`;
    case 'asset':
      return `Provide a small amount of the asset as liquidity or lend it where ${n} integrates, so the holding is active rather than parked.`;
    case 'insurance':
      return `Renew or extend the cover once before it lapses; a second policy period is cheap and doubles the wallet's history with ${n}.`;
    case 'launchpad':
      return `Take part in the first sale the wallet qualifies for, even at the minimum ticket; participation, not size, is what ${n} records.`;
    case 'chain':
      return `Return weekly for one more native transaction — a vote, a domain renewal or a small transfer — so the wallet's ${chain} history spans months.`;
    case 'payments':
      return `Make ${n} the route for one recurring real expense for two months; repeated genuine payments are the usage that counts.`;
    case 'privacy':
      return `Withdraw to a fresh address once after a delay of several days; varied timing keeps the wallet's ${n} history realistic.`;
    case 'yield':
      return `Compound the yield back into the same ${n} position once a month instead of withdrawing it; the reinvestment transactions add qualifying history.`;
    default:
      return `Use one more of ${n}'s features beyond the deposit — a vote, a referral-free second deposit or its secondary market — so the wallet is a user, not a balance.`;
  }
}

/** A protocol's farm plan: seven steps — setup, two actions, a cadence, a hold, a claim watch, and the risk that closes it. */
export function farmPlan(p: Protocol, age: number | null): string[] {
  const family = familyOf(p.category);
  const capital = capitalFor(p);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const chainNote = p.chains.length > 1 ? ` (it runs on ${p.chains.length} chains; ${chain} is the cheapest place to start)` : '';
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const momentum =
    p.change_7d === null
      ? 'its seven-day TVL change is unreported'
      : p.change_7d >= 0
        ? `its TVL is up ${p.change_7d.toFixed(1)}% this week`
        : `its TVL is down ${Math.abs(p.change_7d).toFixed(1)}% this week`;
  const setup = pick(p.slug, 1, [
    `Start with a fresh wallet funded only with the $${capital} you mean to farm plus gas money, and store its seed phrase offline. ${p.name} holds ${money(p.tvl_usd)} of TVL and ${momentum}.`,
    `Use one dedicated wallet for ${p.name} so its history is clean: fund it with $${capital} and a little gas, and keep the seed phrase on paper, never in a screenshot. The protocol holds ${money(p.tvl_usd)} of TVL; ${momentum}.`,
    `Open a separate wallet for this farm and fund it with $${capital}. ${p.name} has run for ${ageText(age)} with no token recorded and holds ${money(p.tvl_usd)} of TVL; ${momentum}.`,
  ]);
  const opening = `${openingAction(p, family, capital, chain)}${chainNote} Cost: $${capital} of capital, ${gas} of gas per transaction. Time: about 15 minutes.`;
  const second = `${secondAction(p, family, capital, chain)} Cost: included in the position, plus ${gas} of gas each time. Time: 10 minutes a session.`;
  const cadenceAction = pick(p.slug, 5, ['a small top-up', 'a claim or rebalance', 'a vote or second deposit', 'a modest repeat of the opening action']);
  const honesty = 'No one outside the protocol knows what a future programme would count; the steady history is the part within your control.';
  const cadenceCore = pick(p.slug, 2, [
    `Repeat one qualifying action for ${p.name} every week — ${cadenceAction} — so the wallet's history spans at least eight weeks rather than a single burst`,
    `Keep a weekly rhythm with ${p.name}: ${cadenceAction} every 5–9 days, varying the amount, for at least two months`,
    `Show up at ${p.name} weekly rather than in a burst: ${cadenceAction} each week builds a record measured in months, the only kind a later snapshot can see`,
  ]);
  const cadence =
    chain === 'Ethereum'
      ? `On Ethereum every touch costs $4–10 of gas, a heavy drag on $${capital} of capital, so batch the rhythm: ${cadenceAction} for ${p.name} once a fortnight, in larger size, instead of weekly. ${honesty} Cost: about $8–20 of gas a month. Time: 10 minutes a fortnight.`
      : `${cadenceCore}. ${honesty} Cost: about ${gas} of gas a week. Time: 10 minutes a week.`;
  const holdStep = `Hold the position for at least ${hold} days before withdrawing anything. ${p.name} has operated ${ageText(age)} without a token, so a qualifying window measured in months, not days, is the safer bet. Cost: the $${capital} stays committed and carries the protocol's smart-contract risk. Time: ${hold} days.`;
  const claim = pick(p.slug, 3, [
    `If ${p.name} opens a points or rewards page, enrol the same wallet and check it monthly; claim only from a link the protocol itself publishes, and never pay a fee to claim. Cost: nothing to check. Time: 5 minutes a month.`,
    `Watch ${p.name}'s official announcements for a points programme or a token vote, and if one opens, register this wallet — the one with the history — rather than a new one. Cost: nothing. Time: 5 minutes a month.`,
    `Should ${p.name} announce a token or a rewards season, eligibility — if any — would be measured on wallets with a history already in place; verify any claim page through the protocol's own site before signing anything. Cost: nothing to verify. Time: 10 minutes.`,
  ]);
  const risk = riskStep(p, family);
  return [setup, opening, second, cadence, holdStep, claim, risk].slice(0, 7);
}

/** The plan's closing step: the concrete way this kind of position loses money, then the log habit. */
function riskStep(p: Protocol, family: string): string {
  const n = p.name;
  const tail = `Keep a farm log for ${n} — wallet, dates, amounts, hashes — so the position can be proved or unwound in minutes.`;
  switch (family) {
    case 'dex':
      return `Know the failure mode before the yield: a ${n} LP position loses to simply holding when prices diverge (impermanent loss), and the pool contract is the counterparty. ${tail}`;
    case 'lending':
      return `Know the failure mode: a fast collateral drop can liquidate a borrow, and ${n} itself can take bad debt in a cascade; keep the health factor above 2 and know which oracle prices your position. ${tail}`;
    case 'mint':
      return `Know the failure mode: ${n}'s stable asset can depeg, and the collateral behind a mint can be liquidated in a fast fall. Mint conservatively and watch the peg, not just the ratio. ${tail}`;
    case 'bridge':
      return `Know the failure mode: bridges are the most-hacked contracts in the sector, and the far-side asset is a wrapped claim, not the native coin. Cross with amounts you could afford to see stranded. ${tail}`;
    case 'staking':
      return `Know the failure mode: staking can be slashed for validator faults and usually locks the exit behind an unbonding queue; the receipt token can also trade below the underlying asset. ${tail}`;
    case 'trading':
      return `Know the failure mode: margin positions liquidate automatically and funding rates bleed a held position; a hedged book can still lose on both legs in a dislocation. ${tail}`;
    case 'prediction':
      return `Know the failure mode: a prediction position can go to zero at settlement, and markets can resolve on a disputed reading of the question. Size every ticket as money already spent. ${tail}`;
    case 'curator':
      return `Know the failure mode: a curator allocates your deposit into other protocols' vaults, so you carry the allocator's judgement plus every underlying vault's contract risk at once. Read what the vault actually holds. ${tail}`;
    case 'asset':
      return `Know the failure mode: a tokenised asset is a claim on an issuer or custodian; if the backing is questioned the asset depegs from what it tracks, and redemptions can queue. ${tail}`;
    case 'insurance':
      return `Know the failure mode: cover pays under the protocol's wording and at its discretion, and exclusions decide real claims. Read what is actually covered before counting a policy as protection. ${tail}`;
    case 'launchpad':
      return `Know the failure mode: sale tokens commonly vest or lock, and most launchpad allocations fall after listing. Treat the ticket as illiquid from the day you pay. ${tail}`;
    case 'chain':
      return `Know the failure mode: a young chain's bridge and flagship apps are its weakest points, and a token, if one comes, may be measured on a different window than your activity. ${tail}`;
    case 'payments':
      return `Know the failure mode: payment accounts can be frozen under compliance review, and a balance held with a provider is an unsecured claim on it. Keep working funds small. ${tail}`;
    case 'privacy':
      return `Know the failure mode: privacy pools attract regulatory attention and tainted deposits, and an exchange may question funds that passed through one. Keep amounts modest and records clean. ${tail}`;
    case 'yield':
      return `Know the failure mode: yield strategies stack leverage, depegs and contract risk to reach their rate; when one layer fails, the receipt share reprices all at once. ${tail}`;
    default:
      return `Know the failure mode: the position is a claim on ${n}'s contracts, and a bug, oracle failure or governance change can impair it without warning. Size it as money at risk, not savings. ${tail}`;
  }
}
