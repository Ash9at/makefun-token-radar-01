// Stage 4 evidence pack, answering the quant critique with measurements
// instead of arguments. Run: node tools/loo_evidence.ts
//   1. split-half selection cost — how much of the v4 gain is variant
//      selection on the same trials (fit/select on one half, score the other)
//   2. per-category band coverage — is the calibrated band honest per
//      category, or only on average?
//   3. factor ablations under the v4 configuration
//   4. peer age gradient — do older live peers price richer (the proposed
//      survivorship-correction mechanism), or is there nothing to fit?
import { readFileSync } from 'node:fs';
import { MODEL, MODEL_V1, parseSnapshot, peerMultiples, scoreProtocol } from '../lib/model.ts';
import { runBacktest } from '../lib/backtest.ts';
import type { Protocol, RadarModel, Snapshot } from '../lib/model.ts';

const snapshot = parseSnapshot(readFileSync('/home/hatch/workspace/makefun/token-radar-01-kit/input/snapshot.json', 'utf8'));
const subjects = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);

function looErrors(model: RadarModel, pool: Protocol[]): number[] {
  const errs: number[] = [];
  for (const t of pool) {
    const rest: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter((p) => p.slug !== t.slug) };
    const s = scoreProtocol(t, snapshot.as_of, peerMultiples(rest, model), model);
    errs.push(Math.log10(s.implied / t.mcap_usd!));
  }
  return errs;
}
function medAbs(errs: number[]): number {
  const a = errs.map(Math.abs).sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

// --- 1. split-half selection cost -----------------------------------------
// Deterministic split by slug character sum. On each half, select the best
// (size_strength, cap) from a small grid by that half's own LOO, then score
// the selected configuration on the OTHER half. Compare with scoring the
// globally-selected configuration (strength 1, cap [0.2, 5]) on that half.
const half = (p: Protocol) => [...p.slug].reduce((a, c) => a + c.charCodeAt(0), 0) % 2;
const A = subjects.filter((p) => half(p) === 0);
const B = subjects.filter((p) => half(p) === 1);
const grid: RadarModel[] = [];
for (const strength of [0.5, 0.75, 1]) {
  for (const cap of [3, 5, 8]) grid.push({ ...MODEL, size_strength: strength, size_cap_low: 1 / cap, size_cap_high: cap });
}
function selectOn(pool: Protocol[]): RadarModel {
  let best = grid[0]!;
  let bestScore = Infinity;
  for (const g of grid) {
    const s = medAbs(looErrors(g, pool));
    if (s < bestScore) { bestScore = s; best = g; }
  }
  return best;
}
const selA = selectOn(A);
const selB = selectOn(B);
console.log('--- split-half selection cost ---');
console.log(`half A (n=${A.length}): selected-on-A scores ${medAbs(looErrors(selA, A)).toFixed(3)} on A; global config scores ${medAbs(looErrors(MODEL, A)).toFixed(3)} on A`);
console.log(`half B (n=${B.length}): selected-on-B scores ${medAbs(looErrors(selB, B)).toFixed(3)} on B; global config scores ${medAbs(looErrors(MODEL, B)).toFixed(3)} on B`);
console.log(`cross: A-selected config on B = ${medAbs(looErrors(selA, B)).toFixed(3)}; B-selected config on A = ${medAbs(looErrors(selB, A)).toFixed(3)}`);
console.log(`A-selected: strength ${selA.size_strength} cap ${selA.size_cap_high}; B-selected: strength ${selB.size_strength} cap ${selB.size_cap_high}`);

// --- 2. per-category band coverage ----------------------------------------
const { bands } = runBacktest(snapshot);
const trials: { p: Protocol; pred: number }[] = [];
for (const t of subjects) {
  const rest: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter((p) => p.slug !== t.slug) };
  const s = scoreProtocol(t, snapshot.as_of, peerMultiples(rest, MODEL), MODEL);
  trials.push({ p: t, pred: s.implied });
}
console.log('--- per-category band coverage (share of actual caps inside the band) ---');
const catTrials = new Map<string, { n: number; inside: number; own: boolean }>();
let totIn = 0;
for (const { p, pred } of trials) {
  const cat = p.category ?? '(none)';
  const own = p.category !== null && bands.byCategory.has(p.category);
  const f = (p.category !== null ? bands.byCategory.get(p.category) : undefined) ?? bands.global;
  const inside = p.mcap_usd! >= pred * f.low && p.mcap_usd! <= pred * f.high;
  if (inside) totIn++;
  const e = catTrials.get(cat) ?? { n: 0, inside: 0, own };
  e.n++; if (inside) e.inside++;
  catTrials.set(cat, e);
}
for (const [cat, e] of [...catTrials.entries()].sort((a, b) => b[1].n - a[1].n)) {
  if (e.n >= 3) console.log(`  ${cat}: ${e.inside}/${e.n} = ${((e.inside / e.n) * 100).toFixed(0)}% (${e.own ? 'own band' : 'global band'})`);
}
console.log(`  overall: ${totIn}/${trials.length} = ${((totIn / trials.length) * 100).toFixed(1)}%`);

// --- 3. ablations under v4 -------------------------------------------------
console.log('--- ablations (full-set LOO median |err|) ---');
const variants: [string, RadarModel][] = [
  ['v4 as built', MODEL],
  ['seasoning off', { ...MODEL, seasoning_min: 1, seasoning_max: 1 }],
  ['breadth off', { ...MODEL, breadth_per_chain: 0 }],
  ['growth off', { ...MODEL, growth_up_weight: 0, growth_down_weight: 0 }],
  ['seasoning+breadth+growth off', { ...MODEL, seasoning_min: 1, seasoning_max: 1, breadth_per_chain: 0, growth_up_weight: 0, growth_down_weight: 0 }],
  ['v1 config', MODEL_V1],
];
for (const [name, m] of variants) console.log(`  ${name}: ${medAbs(looErrors(m, subjects)).toFixed(3)}`);

// --- 4. peer age gradient ---------------------------------------------------
console.log('--- peer age gradient (log10 mcap/TVL vs years since listing) ---');
const dated = subjects.filter((p) => p.listed_at !== null);
const xs = dated.map((p) => (Date.parse(snapshot.as_of) - Date.parse(p.listed_at!)) / (365.25 * 86400_000));
const ys = dated.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd));
const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
const my = ys.reduce((a, b) => a + b, 0) / ys.length;
let num = 0, den = 0, denY = 0;
for (let i = 0; i < xs.length; i++) { num += (xs[i]! - mx) * (ys[i]! - my); den += (xs[i]! - mx) ** 2; denY += (ys[i]! - my) ** 2; }
console.log(`  n=${dated.length} slope=${(num / den).toFixed(3)} log10 per year, correlation=${(num / Math.sqrt(den * denY)).toFixed(3)}`);
