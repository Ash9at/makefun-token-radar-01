// Follow-up: cap 3 vs cap 5 on the full set, and band shrinkage k sweep
// judged by worst per-category coverage deviation from the 50% target.
import { readFileSync } from 'node:fs';
import { MODEL, parseSnapshot, peerMultiples, scoreProtocol } from '../lib/model.ts';
import type { RadarModel, Snapshot } from '../lib/model.ts';

const snapshot = parseSnapshot(readFileSync('/home/hatch/workspace/makefun/token-radar-01-kit/input/snapshot.json', 'utf8'));
const subjects = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);

function trialsOf(model: RadarModel) {
  return subjects.map((t) => {
    const rest: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter((p) => p.slug !== t.slug) };
    const s = scoreProtocol(t, snapshot.as_of, peerMultiples(rest, model), model);
    return { cat: t.category, pred: s.implied, actual: t.mcap_usd!, err: Math.log10(s.implied / t.mcap_usd!) };
  });
}
function medAbs(errs: number[]): number {
  const a = errs.map(Math.abs).sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}
for (const cap of [3, 5]) {
  const m: RadarModel = { ...MODEL, size_cap_low: 1 / cap, size_cap_high: cap };
  console.log(`cap ${cap}: full-set LOO median ${medAbs(trialsOf(m).map((t) => t.err)).toFixed(3)}`);
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  const at = q * (s.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(s.length - 1, lo + 1);
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}
const trials = trialsOf(MODEL);
const allErrs = trials.map((t) => t.err);
for (const k of [3, 4, 6, 8, 12]) {
  const byCat = new Map<string, number[]>();
  for (const t of trials) {
    if (t.cat === null) continue;
    const l = byCat.get(t.cat) ?? [];
    l.push(t.err);
    byCat.set(t.cat, l);
  }
  const g = { low: Math.pow(10, -quantile(allErrs, 0.75)), high: Math.pow(10, -quantile(allErrs, 0.25)) };
  const bands = new Map<string, { low: number; high: number }>();
  for (const [cat, errs] of byCat) {
    if (errs.length < 8) continue;
    const w = errs.length / (errs.length + k);
    const q25 = w * quantile(errs, 0.25) + (1 - w) * quantile(allErrs, 0.25);
    const q75 = w * quantile(errs, 0.75) + (1 - w) * quantile(allErrs, 0.75);
    bands.set(cat, { low: Math.pow(10, -q75), high: Math.pow(10, -q25) });
  }
  let worst = 0;
  let worstCat = '';
  let totIn = 0;
  const perCat = new Map<string, { n: number; inside: number }>();
  for (const t of trials) {
    const f = (t.cat !== null ? bands.get(t.cat) : undefined) ?? g;
    const inside = t.actual >= t.pred * f.low && t.actual <= t.pred * f.high;
    if (inside) totIn++;
    if (t.cat !== null && bands.has(t.cat)) {
      const e = perCat.get(t.cat) ?? { n: 0, inside: 0 };
      e.n++; if (inside) e.inside++;
      perCat.set(t.cat, e);
    }
  }
  for (const [cat, e] of perCat) {
    const dev = Math.abs(e.inside / e.n - 0.5);
    if (dev > worst) { worst = dev; worstCat = `${cat} ${(100 * e.inside / e.n).toFixed(0)}%`; }
  }
  console.log(`band shrink k=${k}: overall coverage ${((totIn / trials.length) * 100).toFixed(1)}%, worst own-band category deviation ${worst.toFixed(2)} (${worstCat})`);
}
