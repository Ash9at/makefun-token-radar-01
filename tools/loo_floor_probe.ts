// Quick check: does lowering peer_min_samples (1 or 2 instead of 3) help or
// hurt the v2 model's leave-one-out record? Uses lib/model.ts as it stands.
import { readFileSync } from 'node:fs';
import { MODEL, parseSnapshot, peerMultiples, scoreProtocol } from '../lib/model.ts';
import type { RadarModel, Snapshot } from '../lib/model.ts';

const snapshot = parseSnapshot(readFileSync('/home/hatch/workspace/makefun/token-radar-01-kit/input/snapshot.json', 'utf8'));
const subjects = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);

function loo(model: RadarModel): { med: number; bias: number; hit2: number; hit3: number } {
  const errs: number[] = [];
  for (const t of subjects) {
    const rest: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter((p) => p.slug !== t.slug) };
    const s = scoreProtocol(t, snapshot.as_of, peerMultiples(rest, model), model);
    errs.push(Math.log10(s.implied / t.mcap_usd!));
  }
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const med = abs[Math.floor(abs.length / 2)]!;
  return {
    med,
    bias: errs.reduce((a, b) => a + b, 0) / errs.length,
    hit2: (errs.filter((e) => Math.abs(e) <= Math.log10(2)).length / errs.length) * 100,
    hit3: (errs.filter((e) => Math.abs(e) <= Math.log10(3)).length / errs.length) * 100,
  };
}

for (const floor of [3, 2, 1]) {
  const r = loo({ ...MODEL, peer_min_samples: floor });
  console.log(`min_samples=${floor}: median ${r.med.toFixed(3)}  bias ${r.bias.toFixed(3)}  hit2 ${r.hit2.toFixed(1)}%  hit3 ${r.hit3.toFixed(1)}%`);
}
