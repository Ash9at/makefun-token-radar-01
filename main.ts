// Token Launch Radar — the entry program (Node 22, standard library only).
//
//   node main.ts [--input <snapshot.json|dir>] [--output <dir>]
//
// Reads the sealed DefiLlama snapshot, scores every watchlist protocol and
// the strongest pre-token candidates below its floor with the model in
// lib/model.ts, and writes the hand-in into the output directory:
//
//   board.json    the ranked board (the gate reads this)
//   data.js       the dashboard's dataset, as window.RADAR
//   dashboard/    this repository's static page, copied
//   screenshots/  this repository's three dashboard captures, copied
//   dossier.json  buildDossier's summary of the dashboard and screenshots
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The program is deterministic: the same snapshot writes the same bytes, so
// the grader's two runs agree. It touches no network and nothing outside the
// input file, this repository and the output directory.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { runBacktest } from './lib/backtest.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));

/** The gate's caps, mirrored so a bad hand-in fails here first with a plainer message. */
const DOSSIER_TEXT_BYTES = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASH_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** A `--name value` or `--name=value` argument, else the fallback. */
function readArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const glued = args.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token launch radar: ${message}\n`);
  process.exit(1);
}

const inputArg = readArg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath} — pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
// The backtest runs first: its calibrated bands are part of the board, and
// its accuracy summary rides in the dashboard's data.
const { accuracy, bands } = runBacktest(snapshot);
const { board, radar } = buildRadar(snapshot, undefined, { bands, accuracy });
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model produced a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a flat directory's regular files, skipping dot-names; returns the names copied. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    names.push(name);
  }
  return names.sort();
}

const dashFiles = copyFlat(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
if (!dashFiles.includes('index.html')) fail('dashboard/ holds no index.html');
const shots = copyFlat(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images — hand in 3 (the board, a detail view, a filtered view)`);
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const size = statSync(join(outDir, 'screenshots', name)).size;
  if (size > SHOT_CAPS.max_bytes) fail(`screenshots/${name} is ${size} bytes, over the ${SHOT_CAPS.max_bytes} cap`);
}

// The dossier goes last: the scorer rebuilds it from this output and compares bytes.
const dossier = buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_BYTES, screenshots: SHOT_CAPS, dashboard: DASH_CAPS });
writeFileSync(join(outDir, 'dossier.json'), dossier);

process.stdout.write(
  `token launch radar: snapshot of ${snapshot.as_of}: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, ` +
    `${board.length} rows ranked (${radar.early_size} early below the floor, ${radar.live_size} live-token protocols set aside)\n` +
    `token launch radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images), dossier.json (${dossier.length} bytes)\n`,
);
