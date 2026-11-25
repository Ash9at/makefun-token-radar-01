'use strict';
/* Token Launch Radar — the page's behaviour. Everything renders from
   window.RADAR, the dataset main.ts writes beside this page as data.js.
   No fetch, no network: open the file and it works.
   Views are addressable by hash so a reader (or a screenshot) can land on
   one: #detail=<slug>, #cat=<category>, #chain=<chain>, #q=<text>, #watch=1. */

const R = window.RADAR;
const $ = (id) => document.getElementById(id);

function money(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}

function pct(n) {
  if (n === null || n === undefined) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

function ageText(days) {
  if (days === null || days === undefined) return '—';
  if (days < 90) return days + 'd';
  if (days < 730) return Math.round(days / 30.4) + ' mo';
  return (days / 365.25).toFixed(1) + ' yr';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const state = { q: '', cat: '', chain: '', watch: false, sort: 'rank', detail: null };

function filteredRows() {
  const q = state.q.trim().toLowerCase();
  let rows = R.rows.filter((r) => {
    if (state.watch && !r.watchlist) return false;
    if (state.cat && (r.category || '') !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    return true;
  });
  const by = {
    rank: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    change: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    name: (a, b) => (a.name < b.name ? -1 : 1),
  }[state.sort];
  return rows.sort(by);
}

function renderBoard() {
  const rows = filteredRows();
  const active = [];
  if (state.cat) active.push('category ' + state.cat);
  if (state.chain) active.push('chain ' + state.chain);
  if (state.watch) active.push('watchlist only');
  if (state.q.trim()) active.push('search "' + state.q.trim() + '"');
  $('row-count').textContent =
    rows.length + ' of ' + R.rows.length + ' protocols on screen' +
    (active.length ? ' — filtered by ' + active.join(', ') + '; ranks stay global' : '');
  $('empty').hidden = rows.length > 0;
  $('board-body').innerHTML = rows
    .map((r) => {
      const chg = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      const chains = r.chains.length === 0 ? '—' : r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '');
      return (
        '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + (r.watchlist ? '<span class="wdot" title="On the watchlist"></span>' : '') + esc(r.name) + '</span>' +
        '<span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="chains">' + esc(chains) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + chg + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num">' + r.model.peer_multiple.toFixed(2) + '× <span class="pn">n' + r.model.peer_samples +
        (r.model.size_factor !== 1 ? ' · size ' + r.model.size_factor.toFixed(2) : '') + '</span></td>' +
        '<td class="num implied">' + money(r.implied_value_usd) +
        '<span class="band">band ' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</span></td>' +
        '</tr>'
      );
    })
    .join('');
  for (const tr of document.querySelectorAll('#board-body tr')) {
    tr.addEventListener('click', () => openDetail(tr.getAttribute('data-slug')));
  }
}

/* The category whose live peers priced a row: its own when it has a peer
   set on the evidence table, else the declared alias's, else its own when
   it is itself an alias target (a thin set the model declares as evidence). */
const PEER_ALIAS = { 'Risk Curators': 'Onchain Capital Allocator' };
function pricingCategory(r) {
  if (!r.category) return null;
  if (R.peers && R.peers.some((p) => p.category === r.category)) return r.category;
  if (PEER_ALIAS[r.category]) return PEER_ALIAS[r.category];
  if (Object.values(PEER_ALIAS).includes(r.category)) return r.category;
  return null;
}

/** This pricing set's record in the backtest, in one honest sentence. */
function accuracyLine(r) {
  const A = R.accuracy;
  if (!A) return '';
  const pc = pricingCategory(r);
  const c = pc ? A.categories.find((x) => x.category === pc) : null;
  if (c) {
    return (
      'On ' + c.trials + ' blind trials in ' + c.category + ', the model\'s typical miss was ×/÷' +
      Math.pow(10, c.median_abs_log10).toFixed(1) + ' and ' + c.within_2x_pct +
      '% of predictions landed within 2× of the actual cap. This row\'s band is that measured range.'
    );
  }
  return (
    'Across all ' + A.subjects + ' blind trials, the model\'s typical miss was ×/÷' + A.typical_factor.toFixed(1) +
    '. This row is priced on a set with too few blind trials of its own, so its band is the global measured range.'
  );
}

/** The live peers behind a row's multiple, as a comparables table. */
function comparablesHtml(r) {
  const pc = pricingCategory(r);
  if (!pc || !R.comparables) return '';
  const peers = R.comparables[pc] || [];
  if (peers.length === 0) return '';
  return (
    '<h3>The peers behind the multiple</h3>' +
    '<table class="factors"><tr><td>Live peer</td><td class="num">Market cap</td><td class="num">TVL</td><td class="num">Cap / TVL</td></tr>' +
    peers
      .map(
        (l) =>
          '<tr><td>' + esc(l.name) + '</td><td class="num">' + money(l.mcap_usd) + '</td><td class="num">' +
          money(l.tvl_usd) + '</td><td class="num">' + l.multiple.toFixed(2) + '×</td></tr>',
      )
      .join('') +
    '</table>'
  );
}

function openDetail(slug) {
  state.detail = slug;
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  const m = r.model;
  const chgClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
  const fx = (n) => n.toFixed(2) + '×';
  const seasonNote =
    r.age_days === null
      ? 'no listing date recorded — neutral ×1.00, no age invented'
      : ageText(r.age_days) + ' run with no token recorded';
  const factorRows =
    '<tr><td>TVL</td><td class="num">' + money(r.tvl_usd) + '</td><td>the size being priced</td></tr>' +
    '<tr><td>Peer multiple</td><td class="num">' + fx(m.peer_multiple) + '</td><td>' + esc(m.peer_basis) + '</td></tr>' +
    '<tr><td>Size</td><td class="num">' + fx(m.size_factor) + '</td><td>the market pays less cap per TVL dollar the larger a protocol already is; fitted on the peer set, capped ×0.33–×3.00 — without it this row would read ' + money(Math.round(r.implied_value_usd / m.size_factor)) + '</td></tr>' +
    '<tr><td>Growth</td><td class="num">' + fx(m.growth_factor) + '</td><td>7-day TVL change ' + m.growth_pct.toFixed(1) + '%, damped; falls weigh twice rises</td></tr>' +
    '<tr><td>Seasoning</td><td class="num">' + fx(m.seasoning_factor) + '</td><td>' + esc(seasonNote) + '</td></tr>' +
    '<tr><td>Breadth</td><td class="num">' + fx(m.breadth_factor) + '</td><td>' + r.chains.length + ' chain(s) recorded</td></tr>' +
    '<tr class="total"><td>Implied value</td><td class="num">' + money(r.implied_value_usd) + '</td><td>calibrated band ' +
    money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + ' — the model\'s measured error range for this pricing set</td></tr>';
  $('detail').innerHTML =
    '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
    '<span class="slug">' + esc(r.slug) + '</span>' +
    (r.watchlist ? '<span class="badge watch">Watchlist</span>' : '<span class="badge">Early — below the floor</span>') +
    '<span class="badge">Rank #' + r.rank + ' of ' + R.rows.length + '</span>' +
    '<button class="close" id="detail-close">Close ✕</button></div>' +
    '<div class="fact-grid">' +
    '<div class="fact"><span>Implied value</span><b>' + money(r.implied_value_usd) + '</b><small>calibrated band ' +
    money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</small></div>' +
    '<div class="fact"><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
    '<div class="fact"><span>7-day TVL change</span><b class="' + chgClass + '">' + pct(r.change_7d) + '</b></div>' +
    '<div class="fact"><span>Category</span><b>' + esc(r.category || 'Uncategorised') + '</b></div>' +
    '<div class="fact"><span>Chains</span><b>' + (r.chains.length ? esc(r.chains.slice(0, 4).join(', ') + (r.chains.length > 4 ? ' +' + (r.chains.length - 4) : '')) : '—') + '</b></div>' +
    '<div class="fact"><span>Running since</span><b>' + (r.listed_at || 'unreported') + '</b></div>' +
    '<div class="fact"><span>Age, no token recorded</span><b>' + ageText(r.age_days) + '</b></div>' +
    '<div class="fact"><span>Token status</span><b>None recorded</b></div>' +
    '</div>' +
    '<h3>How the value is worked out</h3>' +
    '<table class="factors">' + factorRows + '</table>' +
    '<p class="model-note">' + esc(accuracyLine(r)) + '</p>' +
    comparablesHtml(r) +
    '<h3>The farm plan</h3>' +
    '<ol class="steps">' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>';
  $('detail').hidden = false;
  $('detail-close').addEventListener('click', () => {
    state.detail = null;
    $('detail').hidden = true;
    document.body.classList.remove('detail-mode');
    renderBoard();
  });
  renderBoard();
}

function renderAccuracy() {
  const A = R.accuracy;
  if (!A) return;
  const biasWord = (b) => (b <= -0.02 ? 'leans low' : b >= 0.02 ? 'leans high' : 'centred');
  $('acc-stats').innerHTML =
    '<div class="stat"><b>' + A.subjects + '</b><span>blind trials</span></div>' +
    '<div class="stat"><b>×/÷' + A.typical_factor.toFixed(1) + '</b><span>typical miss</span></div>' +
    '<div class="stat"><b>' + A.within_2x_pct + '%</b><span>within 2×</span></div>' +
    '<div class="stat"><b>' + A.within_3x_pct + '%</b><span>within 3×</span></div>' +
    '<div class="stat"><b>' + A.band_coverage_pct + '%</b><span>band coverage</span></div>';
  const modelRow = (label, t, b) =>
    '<tr><td>' + label + '</td><td class="num">×/÷' + t.toFixed(1) + '</td><td class="num">' + b.within_2x_pct +
    '%</td><td class="num">' + b.within_3x_pct + '%</td><td class="num">' + b.bias_log10.toFixed(2) + ' — ' + biasWord(b.bias_log10) + '</td></tr>';
  $('acc-cmp').innerHTML =
    '<thead><tr><th>Model</th><th class="num">Typical miss</th><th class="num">Within 2×</th><th class="num">Within 3×</th><th class="num">Bias</th></tr></thead><tbody>' +
    modelRow('This model', A.typical_factor, A) +
    modelRow('Previous version of this radar', A.v1.typical_factor, A.v1) +
    A.baselines.map((b) => modelRow(b.label, b.typical_factor, b)).join('') +
    '</tbody>';
  const maxCount = Math.max(...A.histogram.map((h) => h.count));
  $('acc-histo').innerHTML = A.histogram
    .map(
      (h) =>
        '<div class="hrow"><span class="hlabel">' + esc(h.label) + '</span>' +
        '<span class="hbar" style="width:' + Math.max(2, Math.round((h.count / maxCount) * 100)) + '%"></span>' +
        '<span class="hcount">' + h.count + '</span></div>',
    )
    .join('');
  const worstFirst = [...A.categories].sort((a, b) => b.median_abs_log10 - a.median_abs_log10);
  $('acc-cats').innerHTML =
    '<thead><tr><th>Category</th><th class="num">Trials</th><th class="num">Typical miss</th><th class="num">Bias</th><th class="num">Within 2×</th><th class="num">Band cover</th></tr></thead><tbody>' +
    worstFirst
      .map(
        (c) =>
          '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.trials + '</td><td class="num">×/÷' +
          Math.pow(10, c.median_abs_log10).toFixed(1) + '</td><td class="num">' + biasWord(c.bias_log10) + '</td><td class="num">' +
          c.within_2x_pct + '%</td><td class="num">' + c.band_coverage_pct + '%</td></tr>',
      )
      .join('') +
    '</tbody>';
}

function renderPeers() {
  if (!R.peers) return;
  $('peer-body').innerHTML = R.peers
    .map(
      (p) =>
        '<tr><td>' + esc(p.category) + (p.alias_for ? ' <span class="pn">prices ' + esc(p.alias_for) + ' by declared alias</span>' : '') +
        '</td><td class="num">' + p.samples + '</td><td class="num">' +
        p.multiple.toFixed(3) + '×</td><td class="num">' + p.p25.toFixed(3) + '×</td><td class="num">' +
        p.p75.toFixed(3) + '×</td></tr>',
    )
    .join('');
}

function renderLive() {
  $('live-grid').innerHTML = R.live
    .map(
      (l) =>
        '<div class="live-card"><b>' + esc(l.name) + '</b><span class="lc-cat">' + esc(l.category || 'Uncategorised') + '</span>' +
        '<span class="lc-nums">mcap ' + money(l.mcap_usd) + ' · TVL ' + money(l.tvl_usd) + ' · <em>' +
        (l.multiple === null ? '—' : l.multiple.toFixed(2) + '× TVL') + '</em></span></div>',
    )
    .join('');
}

function fillSelects() {
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => '<option>' + esc(c) + '</option>').join('');
}

function applyHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('q')) { state.q = h.get('q'); $('q').value = state.q; }
  if (h.get('cat')) { state.cat = h.get('cat'); $('cat').value = state.cat; }
  if (h.get('chain')) { state.chain = h.get('chain'); $('chain').value = state.chain; }
  if (h.get('watch')) { state.watch = true; $('watch').checked = true; }
  if (h.get('sort')) { state.sort = h.get('sort'); $('sort').value = state.sort; }
  if (h.get('detail')) {
    document.body.classList.add('detail-mode');
    openDetail(h.get('detail'));
  } else if (h.toString()) {
    renderBoard();
  }
  if (h.get('view') === 'accuracy') {
    document.body.classList.add('accuracy-mode');
  }
}

function init() {
  if (!R) {
    $('meta-line').textContent = 'No dataset found: run main.ts first — it writes data.js beside this page.';
    return;
  }
  $('meta-line').textContent =
    'Snapshot ' + R.as_of + ' · ' + R.source + ' · watchlist floor ' + money(R.floor_usd) + ' · model: ' + R.model_name;
  $('mast-stats').innerHTML =
    '<div class="stat"><b>' + R.universe_size + '</b><span>in snapshot</span></div>' +
    '<div class="stat"><b>' + R.board_size + '</b><span>ranked</span></div>' +
    '<div class="stat"><b>' + R.watchlist_size + '</b><span>of them watchlist</span></div>' +
    '<div class="stat"><b>' + R.early_size + '</b><span>early finds added</span></div>';
  $('foot-meta').textContent =
    'board: ' + R.board_size + ' rows (' + R.watchlist_size + ' watchlist + ' + R.early_size + ' early) · live peer set: ' +
    R.live_size + ' · snapshot as of ' + R.as_of;
  fillSelects();
  renderPeers();
  renderAccuracy();
  renderLive();
  renderBoard();
  applyHash();
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
  $('watch').addEventListener('change', (e) => { state.watch = e.target.checked; renderBoard(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
}

document.addEventListener('DOMContentLoaded', init);
