// Post-audit sensitivity probe: how much does the board — and the model's
// measured accuracy — move when the fitted constants are perturbed?
//
// The size factor's cap and strength and the peer shrinkage k were chosen
// with the 128 blind trials in view. A board that reshuffles when a
// constant wiggles is a board whose ranking is an artefact of the tuning;
// a board that holds still under the same perturbations that leave the
// leave-one-out accuracy unchanged is a ranking the data, not the knob,
// produced. Each variant below is scored two ways on the identical
// snapshot: its LOO record (production backtest, lib/backtest.ts) and its
// top-20 overlap with the production board, with the largest rank move
// among the rows both boards keep in their top 20.
//
//   node tools/loo_sensitivity.ts [path-to-snapshot.json]

import { readFileSync } from 'node:fs';
import { MODEL, buildRadar, parseSnapshot } from '../lib/model.ts';
import type { RadarModel } from '../lib/model.ts';
import { runBacktest } from '../lib/backtest.ts';

const snapPath = process.argv[2] ?? '/home/hatch/workspace/makefun/token-radar-01-kit/input/snapshot.json';
const snapshot = parseSnapshot(readFileSync(snapPath, 'utf8'));

interface Variant {
  name: string;
  model: RadarModel;
}

const variants: Variant[] = [
  { name: 'production (cap [1/3, 3], strength 1, k 10)', model: MODEL },
  { name: 'size cap widened to [0.25, 4]', model: { ...MODEL, size_cap_low: 0.25, size_cap_high: 4 } },
  { name: 'size cap narrowed to [0.5, 2]', model: { ...MODEL, size_cap_low: 0.5, size_cap_high: 2 } },
  { name: 'size cap at the pre-critique [0.2, 5]', model: { ...MODEL, size_cap_low: 0.2, size_cap_high: 5 } },
  { name: 'size strength 0.8', model: { ...MODEL, size_strength: 0.8 } },
  { name: 'size strength 1.2', model: { ...MODEL, size_strength: 1.2 } },
  { name: 'peer shrinkage k 5', model: { ...MODEL, peer_shrink_k: 5 } },
  { name: 'peer shrinkage k 20', model: { ...MODEL, peer_shrink_k: 20 } },
];

function top20(model: RadarModel): Map<string, number> {
  const { accuracy, bands } = runBacktest(snapshot, model);
  const { board } = buildRadar(snapshot, model, { bands, accuracy });
  return new Map(board.slice(0, 20).map((r) => [r.slug, r.rank]));
}

const prod = top20(MODEL);
console.log('variant | LOO median |log10 err| | typical miss | within 3x | bias | top-20 overlap | worst rank move in shared top 20');
for (const v of variants) {
  const { accuracy: m } = runBacktest(snapshot, v.model);
  const t = top20(v.model);
  const shared = [...t.keys()].filter((s) => prod.has(s));
  const worst = shared.length === 0 ? 0 : Math.max(...shared.map((s) => Math.abs(t.get(s)! - prod.get(s)!)));
  console.log(
    `${v.name} | ${m.median_abs_log10} | x/${m.typical_factor} | ${m.within_3x_pct}% | ${m.bias_log10} | ${shared.length}/20 | ${worst}`,
  );
}
