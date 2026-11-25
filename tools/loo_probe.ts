// Stage-1 probe: leave-one-out backtest of the v1 model inside the snapshot,
// plus a small set of model variants, so Stage 2 is chosen on evidence.
//
// For every live-token protocol: remove it from the peer set, price it as if
// it recorded no token (the model's own arithmetic, from lib/model.ts), and
// compare the prediction with the market cap it actually carries. Errors are
// log10(predicted / actual): 0.301 is a factor of two.
//
//   node tools/loo_probe.ts [path-to-snapshot.json]

import { readFileSync } from 'node:fs';
import { MODEL, parseSnapshot, peerMultiples, scoreProtocol } from '../lib/model.ts';
import type { Protocol, RadarModel, Snapshot } from '../lib/model.ts';

const snapPath = process.argv[2] ?? '/home/hatch/workspace/makefun/token-radar-01-kit/input/snapshot.json';
const snapshot = parseSnapshot(readFileSync(snapPath, 'utf8'));

// LOO subjects: protocols the market actually prices. Fifteen snapshot rows
// record a token symbol with mcap_usd = 0 — a dead token carries no price to
// predict against, and its log error is undefined, so they are excluded as
// subjects (and counted, here and in the report).
const live: Protocol[] = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
const zeroMcap = snapshot.protocols.filter((p) => p.mcap_usd === 0 && p.tvl_usd > 0).length;

interface Variant {
  name: string;
  model: RadarModel;
  /** Extra multiplicative adjustments applied on top of the model's own factors. */
  adjust?: (p: Protocol, f: { growthFactor: number; seasoningFactor: number; breadthFactor: number }) => number;
  /** When true, zero-mcap rows are dropped from the peer set before pricing. */
  dropZeroPeers?: boolean;
}

const log10 = (n: number) => Math.log10(n);

/** The log-log slope of multiple on TVL across the live set (a size effect, if any). */
function sizeSlope(): number {
  const xs = live.map((p) => log10(p.tvl_usd));
  const ys = live.map((p) => log10(p.mcap_usd! / p.tvl_usd));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return num / den;
}
const SLOPE = sizeSlope();
const MEDIAN_TVL = [...live.map((p) => p.tvl_usd)].sort((a, b) => a - b)[Math.floor(live.length / 2)]!;

const sizeFactor = (strength: number) => (p: Protocol) =>
  Math.pow(10, SLOPE * strength * (log10(p.tvl_usd) - log10(MEDIAN_TVL)));

/** Median live TVL per category, for a within-category size reference. */
const catMedianTvl = new Map<string, number>();
{
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = byCat.get(p.category) ?? [];
    list.push(p.tvl_usd);
    byCat.set(p.category, list);
  }
  for (const [cat, tvls] of byCat) {
    const s = [...tvls].sort((a, b) => a - b);
    catMedianTvl.set(cat, s[Math.floor(s.length / 2)]!);
  }
}
const sizeCatFactor = (strength: number) => (p: Protocol) => {
  const ref = (p.category !== null ? catMedianTvl.get(p.category) : undefined) ?? MEDIAN_TVL;
  return Math.pow(10, SLOPE * strength * (log10(p.tvl_usd) - log10(ref)));
};

const variants: Variant[] = [
  { name: 'v1 as-is', model: MODEL },
  { name: 'v1, peers drop mcap=0', model: MODEL, dropZeroPeers: true },
  { name: 'v1, growth off', model: MODEL, adjust: (_p, f) => 1 / f.growthFactor },
  { name: 'v1, shrink k=5', model: { ...MODEL, peer_shrink_k: 5 } },
  { name: 'v1, shrink k=20', model: { ...MODEL, peer_shrink_k: 20 } },
  { name: 'v1 + size adj (full slope)', model: MODEL, adjust: (p) => sizeFactor(1)(p) },
  { name: 'v1 + size adj (half slope)', model: MODEL, adjust: (p) => sizeFactor(0.5)(p) },
  {
    name: 'v1 + |chg| discount',
    model: MODEL,
    adjust: (p) => 1 / (1 + Math.min(60, Math.abs(p.change_7d ?? 0)) / 100),
  },
  {
    name: 'v1 + size(half) + |chg| discount',
    model: MODEL,
    adjust: (p) => sizeFactor(0.5)(p) / (1 + Math.min(60, Math.abs(p.change_7d ?? 0)) / 100),
  },
  {
    name: 'drop0 + size(half) + |chg|',
    model: MODEL,
    dropZeroPeers: true,
    adjust: (p) => sizeFactor(0.5)(p) / (1 + Math.min(60, Math.abs(p.change_7d ?? 0)) / 100),
  },
  { name: 'drop0 + size(full)', model: MODEL, dropZeroPeers: true, adjust: (p) => sizeFactor(1)(p) },
  { name: 'drop0 + size(0.75)', model: MODEL, dropZeroPeers: true, adjust: (p) => sizeFactor(0.75)(p) },
  { name: 'v1, seasoning off', model: MODEL, adjust: (_p, f) => 1 / f.seasoningFactor },
  { name: 'v1, breadth off', model: MODEL, adjust: (_p, f) => 1 / f.breadthFactor },
  { name: 'v1, growth+seasoning+breadth off', model: MODEL, adjust: (_p, f) => 1 / (f.growthFactor * f.seasoningFactor * f.breadthFactor) },
  { name: 'drop0 + size-cat(full)', model: MODEL, dropZeroPeers: true, adjust: (p) => sizeCatFactor(1)(p) },
  { name: 'drop0 + size-cat(half)', model: MODEL, dropZeroPeers: true, adjust: (p) => sizeCatFactor(0.5)(p) },
  {
    name: 'drop0 + size(full) capped[.2,5]',
    model: MODEL,
    dropZeroPeers: true,
    adjust: (p) => Math.min(5, Math.max(0.2, sizeFactor(1)(p))),
  },
];

function medianAbs(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

interface Row {
  slug: string;
  category: string | null;
  err: number;
}

function runVariant(v: Variant): { rows: Row[]; medAbs: number; bias: number; hit2: number; hit3: number } {
  const rows: Row[] = [];
  for (const target of live) {
    let restProtocols = snapshot.protocols.filter((p) => p.slug !== target.slug);
    if (v.dropZeroPeers) {
      restProtocols = restProtocols.map((p) => (p.mcap_usd === 0 ? { ...p, mcap_usd: null } : p));
    }
    const rest: Snapshot = { ...snapshot, protocols: restProtocols };
    const peers = peerMultiples(rest, v.model);
    const s = scoreProtocol(target, snapshot.as_of, peers, v.model);
    let predicted = target.tvl_usd * s.multiple * s.growthFactor * s.seasoningFactor * s.breadthFactor;
    if (v.adjust) predicted *= v.adjust(target, { growthFactor: s.growthFactor, seasoningFactor: s.seasoningFactor, breadthFactor: s.breadthFactor });
    rows.push({ slug: target.slug, category: target.category, err: log10(predicted / target.mcap_usd!) });
  }
  const errs = rows.map((r) => r.err);
  return {
    rows,
    medAbs: medianAbs(errs.map(Math.abs)),
    bias: errs.reduce((a, b) => a + b, 0) / errs.length,
    hit2: errs.filter((e) => Math.abs(e) <= log10(2)).length / errs.length,
    hit3: errs.filter((e) => Math.abs(e) <= log10(3)).length / errs.length,
  };
}

console.log(`live protocols (LOO subjects, mcap>0): ${live.length}; excluded as subjects (mcap=0): ${zeroMcap}`);
console.log(`log-log slope of mcap/TVL on TVL: ${SLOPE.toFixed(3)}  (median live TVL ${MEDIAN_TVL.toExponential(2)})`);
console.log('');
console.log('variant                              median|err|  bias    hit<=2x  hit<=3x');
for (const v of variants) {
  const r = runVariant(v);
  console.log(
    `${v.name.padEnd(36)} ${r.medAbs.toFixed(3)}      ${r.bias >= 0 ? '+' : ''}${r.bias.toFixed(3)}  ${(r.hit2 * 100).toFixed(1)}%   ${(r.hit3 * 100).toFixed(1)}%`,
  );
}

// Per-category breakdown for the v1 model.
console.log('');
console.log('v1 per-category (n>=3): category, n, median|err|, bias, hit<=2x');
const base = runVariant(variants[0]!);
const byCat = new Map<string, number[]>();
for (const r of base.rows) {
  const key = r.category ?? '(none)';
  const list = byCat.get(key) ?? [];
  list.push(r.err);
  byCat.set(key, list);
}
for (const [cat, errs] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
  if (errs.length < 3) continue;
  const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
  const hit2 = errs.filter((e) => Math.abs(e) <= log10(2)).length / errs.length;
  console.log(
    `${cat.padEnd(28)} n=${String(errs.length).padStart(2)}  ${medianAbs(errs.map(Math.abs)).toFixed(3)}      ${bias >= 0 ? '+' : ''}${bias.toFixed(3)}  ${(hit2 * 100).toFixed(0)}%`,
  );
}

// Naive baselines for contrast.
console.log('');
console.log('naive baselines (same LOO):');
{
  // Global median multiple only, no category, no factors.
  const errs: number[] = [];
  for (const target of live) {
    const ratios = live.filter((p) => p.slug !== target.slug).map((p) => p.mcap_usd! / p.tvl_usd);
    ratios.sort((a, b) => a - b);
    const med = ratios[Math.floor(ratios.length / 2)]!;
    errs.push(log10((target.tvl_usd * med) / target.mcap_usd!));
  }
  console.log(
    `global-median only                   ${medianAbs(errs.map(Math.abs)).toFixed(3)}      bias ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(3)}  hit<=2x ${(errs.filter((e) => Math.abs(e) <= log10(2)).length / errs.length * 100).toFixed(1)}%`,
  );
  // Raw category median, no shrinkage, no factors.
  const errs2: number[] = [];
  for (const target of live) {
    const ratios = live
      .filter((p) => p.slug !== target.slug && p.category === target.category && target.category !== null)
      .map((p) => p.mcap_usd! / p.tvl_usd);
    if (ratios.length === 0) continue;
    ratios.sort((a, b) => a - b);
    const med = ratios[Math.floor(ratios.length / 2)]!;
    errs2.push(log10((target.tvl_usd * med) / target.mcap_usd!));
  }
  console.log(
    `raw category median only (n=${errs2.length})      ${medianAbs(errs2.map(Math.abs)).toFixed(3)}      bias ${(errs2.reduce((a, b) => a + b, 0) / errs2.length).toFixed(3)}  hit<=2x ${(errs2.filter((e) => Math.abs(e) <= log10(2)).length / errs2.length * 100).toFixed(1)}%`,
  );
}
