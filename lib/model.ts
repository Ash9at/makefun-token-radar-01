// Token Launch Radar — the valuation and selection model.
//
// One sealed DefiLlama snapshot goes in; a ranked board of pre-token protocols
// comes out. Everything the board claims is derived from the snapshot's own
// ten fields per protocol. No protocol name is ever special-cased: the same
// arithmetic scores every row, and the dashboard prints the formula so a
// reader can re-run it by hand.
//
// THE MODEL
//   peer multiple   For each category, the protocols whose token already
//                   trades give a market answer to "what is a dollar of TVL
//                   worth here?": the median of mcap_usd / tvl_usd across the
//                   live protocols of that category (at least 3 samples, else
//                   the median across all live protocols). A pre-token
//                   protocol is first valued as if the market priced its TVL
//                   the way it prices its live peers'.
//   growth factor   Seven-day TVL momentum, clamped to [-50%, +150%] and
//                   damped: factor = 1 + clamp(change_7d) / 100 * 0.35,
//                   never below 0.55. A rising protocol is worth more than a
//                   shrinking one of the same size, but one hot week does not
//                   double a valuation.
//   seasoning       How long the protocol has run with no token recorded,
//                   from listed_at to the snapshot's as_of. A launch after
//                   years of tokenless operation rests on a longer record
//                   than one after a month: factor rises linearly from 0.75
//                   (brand new) to 1.25 at four years and holds there. An
//                   unreported listing date is scored at the median age of
//                   the dated protocols on the board.
//   breadth         One extra point of value per additional chain beyond the
//                   first, up to five: a protocol already deployed on six
//                   chains has more surface for a token to govern.
//   implied value   round(tvl * peer_multiple * growth * seasoning * breadth)
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
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  growth_min_factor: number;
  seasoning_new: number;
  seasoning_full: number;
  seasoning_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  peer_min_samples: number;
}

export const MODEL: RadarModel = {
  growth_weight: 0.35,
  growth_floor_pct: -50,
  growth_cap_pct: 150,
  growth_min_factor: 0.55,
  seasoning_new: 0.75,
  seasoning_full: 1.25,
  seasoning_days: 1460,
  breadth_per_chain: 0.02,
  breadth_max_chains: 5,
  peer_min_samples: 3,
};

export const MODEL_NAME = 'peer-multiple radar, v2';

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
  model: {
    peer_multiple: number;
    peer_basis: string;
    growth_pct: number;
    growth_factor: number;
    seasoning_factor: number;
    breadth_factor: number;
  };
  farm_steps: string[];
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

/**
 * The peer multiples: for every category with at least peer_min_samples live
 * protocols, the median mcap/TVL of those protocols; plus the global median
 * across all live protocols as the fallback for thin categories.
 */
export function peerMultiples(snapshot: Snapshot, model: RadarModel = MODEL): { byCategory: Map<string, number>; global: number } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const global = live.length > 0 ? median(live.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.2;
  const groups = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = groups.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    groups.set(p.category, list);
  }
  const byCategory = new Map<string, number>();
  for (const [category, ratios] of groups) {
    if (ratios.length >= model.peer_min_samples) byCategory.set(category, median(ratios));
  }
  return { byCategory, global };
}

/** The multiple one protocol is priced at, and where it came from. */
function multipleFor(p: Protocol, peers: { byCategory: Map<string, number>; global: number }): { multiple: number; basis: string } {
  if (p.category !== null && peers.byCategory.has(p.category)) {
    return { multiple: peers.byCategory.get(p.category)!, basis: `median of live ${p.category} peers` };
  }
  return { multiple: peers.global, basis: 'median of all live protocols' };
}

/** The four factors and the implied value one protocol earns under the model. */
export function scoreProtocol(
  p: Protocol,
  asOf: string,
  peers: { byCategory: Map<string, number>; global: number },
  fallbackAgeDays: number,
  model: RadarModel = MODEL,
): { implied: number; multiple: number; basis: string; growthPct: number; growthFactor: number; seasoningFactor: number; breadthFactor: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, basis } = multipleFor(p, peers);
  const growthPct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, p.change_7d ?? 0));
  const growthFactor = Math.max(model.growth_min_factor, 1 + (growthPct / 100) * model.growth_weight);
  const ageForSeasoning = age ?? fallbackAgeDays;
  const seasoned = Math.min(Math.max(ageForSeasoning, 0), model.seasoning_days) / model.seasoning_days;
  const seasoningFactor = model.seasoning_new + seasoned * (model.seasoning_full - model.seasoning_new);
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_chains);
  const breadthFactor = 1 + extraChains * model.breadth_per_chain;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * seasoningFactor * breadthFactor));
  return { implied, multiple, basis, growthPct, growthFactor, seasoningFactor, breadthFactor, age };
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

/** The ranked board: scored, ordered by implied value, ties separated a dollar at a time. */
export function buildBoard(snapshot: Snapshot, model: RadarModel = MODEL): BoardRow[] {
  const peers = peerMultiples(snapshot, model);
  const dated = snapshot.protocols.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const fallbackAge = dated.length > 0 ? Math.round(median(dated)) : 365;
  const watch = new Set(snapshot.watchlist);
  const scored = selectProtocols(snapshot).map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, peers, fallbackAge, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  // Separate exact ties by a dollar so no two rows share a value and the order never rises.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.s.implied >= scored[i - 1]!.s.implied) scored[i]!.s.implied = Math.max(1, scored[i - 1]!.s.implied - 1);
  }
  return scored.map(({ p, s }, i) => ({
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
    token_status: 'pre-token',
    watchlist: watch.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.multiple),
      peer_basis: s.basis,
      growth_pct: Math.round(s.growthPct * 100) / 100,
      growth_factor: round4(s.growthFactor),
      seasoning_factor: round4(s.seasoningFactor),
      breadth_factor: round4(s.breadthFactor),
    },
    farm_steps: farmPlan(p, s.age),
  }));
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

/** The board and the dashboard's data, from one snapshot. */
export function buildRadar(snapshot: Snapshot, model: RadarModel = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
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

/** How long a position should be held to count, from the protocol's age. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
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
      return `Supply $${capital} of USDC or ETH to ${n} on ${chain}; a supplied balance is the position most lending distributions count first.`;
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
      return `Route your regular swaps on ${chain} through ${n} as well — aim for $${capital * 4} of cumulative swap volume a month, spread over several days, never in one block.`;
    case 'lending':
      return `Borrow a small amount against the supply (under 30% of its value) and repay it a week later; one clean borrow-repay cycle shows the wallet uses both sides of ${n}.`;
    case 'mint':
      return `Use the minted asset inside ${n}'s ecosystem — hold it or deposit it in its stability pool — rather than selling it the same day.`;
    case 'bridge':
      return `Repeat the route in the opposite direction two weeks later with a different amount; varied, spaced crossings read as use, not as a single airdrop hop.`;
    case 'staking':
      return `Restake or delegate a slice of the receipt once, if ${n} offers it natively, and vote in any governance poll the staking position entitles you to.`;
    case 'trading':
      return `Trade on at least six separate days in the month, small size each time; ${n} counts consistent makers and takers, not one large print.`;
    case 'prediction':
      return `Take positions in three different markets over the month and let at least one settle; settled history is what ${n} can measure.`;
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

/** A protocol's farm plan: six steps, each an action with its cost and its time. */
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
  const cadence = pick(p.slug, 2, [
    `Repeat one qualifying action for ${p.name} every week — ${cadenceAction} — so the wallet appears in at least eight weekly snapshots. Cost: about ${gas} of gas a week. Time: 10 minutes a week.`,
    `Keep a weekly rhythm with ${p.name}: ${cadenceAction} every 5–9 days, varying the amount, for at least two months. Cost: about ${gas} of gas a week. Time: 10 minutes a week.`,
    `Show up at ${p.name} weekly rather than in a burst: ${cadenceAction} each week reads as a user; twenty transactions in one day reads as a script. Cost: about ${gas} of gas a week. Time: 10 minutes a week.`,
  ]);
  const holdStep = `Hold the position for at least ${hold} days before withdrawing anything. ${p.name} has operated ${ageText(age)} without a token, so a qualifying window measured in months, not days, is the safer bet. Cost: the $${capital} stays committed and carries the protocol's smart-contract risk. Time: ${hold} days.`;
  const claim = pick(p.slug, 3, [
    `If ${p.name} opens a points or rewards page, enrol the same wallet and check it monthly; claim only from a link the protocol itself publishes, and never pay a fee to claim. Cost: nothing to check. Time: 5 minutes a month.`,
    `Watch ${p.name}'s official announcements for a points programme or a token vote, and if one opens, register this wallet — the one with the history — rather than a new one. Cost: nothing. Time: 5 minutes a month.`,
    `Should ${p.name} announce a token or a rewards season, this wallet's deposit and activity history is the claim; verify any claim page through the protocol's own site before signing anything. Cost: nothing to verify. Time: 10 minutes.`,
  ]);
  const log = `Keep a farm log for ${p.name}: wallet address, dates, amounts and transaction hashes, reviewed once a month, so you can prove the history or unwind in minutes. Cost: nothing. Time: 5 minutes a month.`;
  return [setup, opening, second, cadence, holdStep, claim, log].slice(0, 7);
}
