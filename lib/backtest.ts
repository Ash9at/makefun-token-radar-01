// Token Launch Radar — the leave-one-out backtest.
//
// The snapshot's only labelled data is the protocols whose token already
// trades: each carries the market cap the market actually gave it. This
// module prices every one of them blind — removed from the peer set,
// scored by the model exactly as a pre-token protocol is scored — and
// measures the error against the cap it really has. Errors are
// log10(predicted / actual): 0.301 is a factor of two, 0.477 a factor of
// three. The results do two jobs: they are the accuracy record the
// dashboard shows, and they calibrate each board row's band (the
// interquartile range of the model's own errors, per category where the
// trials suffice, shrunk toward the global range).
//
// Protocols recording a token at mcap_usd = 0 are excluded as subjects: a
// dead token carries no price to predict against, and its log error is
// undefined. They are counted in the summary, not silently dropped.
//
// The same trials are also run under the v1 model (MODEL_V1), so the
// dashboard's head-to-head compares the two models on identical subjects
// with identical arithmetic — the only difference is the model itself.
//
// Honesty note: the backtest runs on the same snapshot the model is fitted
// to. Leave-one-out removes the subject from its own peer set, which is
// the leakage that matters most for a median-based model, but the model's
// constants were chosen with these trials in view. The dashboard says
// "calibration", not "proof".

import { MODEL, MODEL_NAIVE_CATEGORY, MODEL_NAIVE_GLOBAL, MODEL_V1, peerMultiples, scoreProtocol } from './model.ts';
import type { AccuracyCategory, AccuracySummary, BandBook, BandFactors, RadarModel, Snapshot } from './model.ts';

const LOG_2 = Math.log10(2);
const LOG_3 = Math.log10(3);

/** Categories need at least this many blind trials before their band is their own. */
const BAND_MIN_TRIALS = 8;
/** A category band is pulled toward the global band with this shrinkage weight. */
const BAND_SHRINK_K = 8;

interface Trial {
  slug: string;
  category: string | null;
  predicted: number;
  actual: number;
  err: number;
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A quantile by linear interpolation between closest ranks. */
function quantileOf(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const at = q * (s.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(s.length - 1, lo + 1);
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

/** Run every blind trial under one model configuration. */
function runTrials(snapshot: Snapshot, model: RadarModel): Trial[] {
  const subjects = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const trials: Trial[] = [];
  for (const target of subjects) {
    const rest: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter((p) => p.slug !== target.slug) };
    const peers = peerMultiples(rest, model);
    const s = scoreProtocol(target, snapshot.as_of, peers, model);
    trials.push({
      slug: target.slug,
      category: target.category,
      predicted: s.implied,
      actual: target.mcap_usd!,
      err: Math.log10(s.implied / target.mcap_usd!),
    });
  }
  return trials;
}

interface Metrics {
  medianAbs: number;
  bias: number;
  within2: number;
  within3: number;
}

function metricsOf(trials: Trial[]): Metrics {
  const errs = trials.map((t) => t.err);
  return {
    medianAbs: medianOf(errs.map(Math.abs)),
    bias: errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length),
    within2: pct(errs.filter((e) => Math.abs(e) <= LOG_2).length, errs.length),
    within3: pct(errs.filter((e) => Math.abs(e) <= LOG_3).length, errs.length),
  };
}

/** Band factors from a set of signed errors: actual = predicted × 10^(−err), so the factors invert the error quantiles. */
function factorsFromErrors(errs: number[]): BandFactors {
  const q25 = quantileOf(errs, 0.25);
  const q75 = quantileOf(errs, 0.75);
  return { low: Math.pow(10, -q75), high: Math.pow(10, -q25) };
}

function shrinkFactors(catErrs: number[], globalErrs: number[], n: number): BandFactors {
  const w = n / (n + BAND_SHRINK_K);
  const q25 = w * quantileOf(catErrs, 0.25) + (1 - w) * quantileOf(globalErrs, 0.25);
  const q75 = w * quantileOf(catErrs, 0.75) + (1 - w) * quantileOf(globalErrs, 0.75);
  return { low: Math.pow(10, -q75), high: Math.pow(10, -q25) };
}

const HISTO_BINS: { label: string; max: number }[] = [
  { label: 'within 1.4×', max: 0.15 },
  { label: '1.4–2×', max: LOG_2 },
  { label: '2–3×', max: LOG_3 },
  { label: '3–10×', max: 1 },
  { label: 'over 10×', max: Number.POSITIVE_INFINITY },
];

/**
 * The full backtest for the current model: the accuracy summary the
 * dashboard shows (with the v1 head-to-head) and the calibrated BandBook
 * the board's rows carry.
 */
export function runBacktest(snapshot: Snapshot, model: RadarModel = MODEL): { accuracy: AccuracySummary; bands: BandBook } {
  const trials = runTrials(snapshot, model);
  const v1Trials = runTrials(snapshot, MODEL_V1);
  const m = metricsOf(trials);
  const m1 = metricsOf(v1Trials);
  const naive = (cfg: RadarModel, label: string) => {
    const mm = metricsOf(runTrials(snapshot, cfg));
    return {
      label,
      median_abs_log10: round3(mm.medianAbs),
      typical_factor: Math.round(Math.pow(10, mm.medianAbs) * 10) / 10,
      bias_log10: round3(mm.bias),
      within_2x_pct: mm.within2,
      within_3x_pct: mm.within3,
    };
  };
  const allErrs = trials.map((t) => t.err);

  // Per-category records and bands.
  const byCat = new Map<string, Trial[]>();
  for (const t of trials) {
    if (t.category === null) continue;
    const list = byCat.get(t.category) ?? [];
    list.push(t);
    byCat.set(t.category, list);
  }
  const categories: AccuracyCategory[] = [];
  const bandByCategory = new Map<string, BandFactors>();
  for (const [category, list] of byCat) {
    if (list.length >= BAND_MIN_TRIALS) {
      bandByCategory.set(category, shrinkFactors(list.map((t) => t.err), allErrs, list.length));
    }
  }
  const bands: BandBook = { byCategory: bandByCategory, global: factorsFromErrors(allErrs) };

  // Band coverage, measured leave-self-out: the band each trial is tested
  // against is built from the OTHER trials' errors (its category's, shrunk
  // the same way, when the category has enough trials; the global range
  // otherwise), so the coverage figure is a measurement, not a consequence
  // of how the quantiles were drawn. The board's bands themselves use all
  // trials — correctly, since board rows are not among the subjects.
  let covered = 0;
  const covByCat = new Map<string, { n: number; inside: number }>();
  for (const t of trials) {
    const catList = t.category !== null ? (byCat.get(t.category) ?? []) : [];
    let f: BandFactors;
    if (t.category !== null && catList.length >= BAND_MIN_TRIALS) {
      const catErrs = catList.filter((x) => x !== t).map((x) => x.err);
      const globErrs = trials.filter((x) => x !== t).map((x) => x.err);
      f = shrinkFactors(catErrs, globErrs, catErrs.length);
    } else {
      f = factorsFromErrors(trials.filter((x) => x !== t).map((x) => x.err));
    }
    const inside = t.actual >= t.predicted * f.low && t.actual <= t.predicted * f.high;
    if (inside) covered++;
    if (t.category !== null) {
      const e = covByCat.get(t.category) ?? { n: 0, inside: 0 };
      e.n++;
      if (inside) e.inside++;
      covByCat.set(t.category, e);
    }
  }
  for (const [category, list] of byCat) {
    const cm = metricsOf(list);
    if (list.length >= 3) {
      const cov = covByCat.get(category);
      categories.push({
        category,
        trials: list.length,
        median_abs_log10: round3(cm.medianAbs),
        bias_log10: round3(cm.bias),
        within_2x_pct: cm.within2,
        band_coverage_pct: cov !== undefined ? pct(cov.inside, cov.n) : 0,
      });
    }
  }
  categories.sort((a, b) => b.trials - a.trials || (a.category < b.category ? -1 : 1));

  const histogram = HISTO_BINS.map((bin, i) => ({
    label: bin.label,
    count: trials.filter((t) => {
      const a = Math.abs(t.err);
      const abovePrev = i === 0 || a > HISTO_BINS[i - 1]!.max;
      return abovePrev && a <= bin.max;
    }).length,
  }));

  const accuracy: AccuracySummary = {
    subjects: trials.length,
    excluded_zero_mcap: snapshot.protocols.filter((p) => p.mcap_usd === 0 && p.tvl_usd > 0).length,
    median_abs_log10: round3(m.medianAbs),
    typical_factor: Math.round(Math.pow(10, m.medianAbs) * 10) / 10,
    bias_log10: round3(m.bias),
    within_2x_pct: m.within2,
    within_3x_pct: m.within3,
    band_coverage_pct: pct(covered, trials.length),
    histogram,
    categories,
    v1: {
      median_abs_log10: round3(m1.medianAbs),
      typical_factor: Math.round(Math.pow(10, m1.medianAbs) * 10) / 10,
      bias_log10: round3(m1.bias),
      within_2x_pct: m1.within2,
      within_3x_pct: m1.within3,
    },
    baselines: [
      naive({ ...MODEL, size_strength: 0 }, 'This model, size factor removed'),
      naive(
        { ...MODEL, growth_up_weight: 0, growth_down_weight: 0, seasoning_min: 1, seasoning_max: 1, breadth_per_chain: 0 },
        'This model, record factors removed',
      ),
      naive(MODEL_NAIVE_GLOBAL, 'TVL × one global median'),
      naive(MODEL_NAIVE_CATEGORY, 'TVL × raw category median'),
    ],
  };
  return { accuracy, bands };
}
