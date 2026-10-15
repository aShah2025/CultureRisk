/**
 * CultureRisk AI — Blind-spot report: Qloo vs an LLM working alone.
 *
 * Diffs the LLM-only baseline guesses against the entities Qloo returned for
 * the same audience. Entities only Qloo surfaced are the measurable value of
 * cultural grounding: audience signals a generic model would have missed.
 */

import { esc, pct, DOMAIN_LABELS } from './dom.js';

/** Normalise a name for fuzzy matching ("Tokyo, Japan" ≈ "tokyo"). */
export function normName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/,.*$/, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matches(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.includes(short);
}

/**
 * @param {Object<string,string[]>} guesses  domain → LLM guesses
 * @param {Object<string,Array>} qlooDomains domain → Qloo entities
 */
export function computeBlindSpots(guesses, qlooDomains) {
  const domains = Object.keys(qlooDomains).filter((d) => Array.isArray(guesses[d]));
  const rows = domains.map((d) => {
    const qloo = qlooDomains[d];
    const llm = guesses[d];
    const onlyQloo = qloo.filter((e) => !llm.some((g) => matches(g, e.name)));
    const agreed = qloo.filter((e) => llm.some((g) => matches(g, e.name)));
    const onlyLlm = llm.filter((g) => !qloo.some((e) => matches(g, e.name)));
    return { domain: d, onlyQloo, agreed, onlyLlm };
  });
  const totalQloo = rows.reduce((s, r) => s + r.onlyQloo.length + r.agreed.length, 0);
  const missed = rows.reduce((s, r) => s + r.onlyQloo.length, 0);
  return { rows, totalQloo, missed, missedShare: totalQloo ? missed / totalQloo : 0 };
}

export function renderBlindSpots(report, baselineModel) {
  if (!report.rows.length) return '<p class="hint">No overlapping domains to compare.</p>';
  const rows = report.rows.map((r) => `
    <div class="bs-domain">
      <h4>${esc(DOMAIN_LABELS[r.domain] || r.domain)}</h4>
      <div class="bs-cols">
        <div class="bs-col bs-qloo"><div class="bs-head">Only Qloo found <span>${r.onlyQloo.length}</span></div>
          <ul>${r.onlyQloo.map((e) => `<li>${esc(e.name)} <small>${pct(e.affinity)} affinity</small></li>`).join('') || '<li class="muted">None</li>'}</ul></div>
        <div class="bs-col bs-both"><div class="bs-head">Both agreed <span>${r.agreed.length}</span></div>
          <ul>${r.agreed.map((e) => `<li>${esc(e.name)}</li>`).join('') || '<li class="muted">None</li>'}</ul></div>
        <div class="bs-col bs-llm"><div class="bs-head">LLM guessed, not in Qloo's top results <span>${r.onlyLlm.length}</span></div>
          <ul>${r.onlyLlm.map((g) => `<li>${esc(g)}</li>`).join('') || '<li class="muted">None</li>'}</ul></div>
      </div>
    </div>`).join('');

  return `
    <div class="bs-hero">
      <div class="bs-big">${Math.round(report.missedShare * 100)}%</div>
      <p>of the audience signals Qloo surfaced (${report.missed} of ${report.totalQloo}) were <strong>not predicted</strong> by ${esc(baselineModel || 'the LLM')} working alone.
      These are the partnerships, artists, and places a generic model would have missed.</p>
    </div>
    ${rows}`;
}
