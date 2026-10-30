/**
 * CultureRisk — rendering. Pure functions from API data to HTML strings;
 * every dynamic value is escaped. Images come only from Qloo
 * (properties.image.url). When Qloo has none, an entity is shown as a typeset
 * title card coloured from its ID.
 */

import { esc, pct, barWidth, DOMAIN_LABELS, verdictClass } from './dom.js';

const AGE_ORDER = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];
const AGE_LABEL = { '24_and_younger': '<25', '25_to_29': '25–29', '30_to_34': '30–34', '35_to_44': '35–44', '45_to_54': '45–54', '55_and_older': '55+' };
const AGE_WORDS = { '24_and_younger': 'under 25', '25_to_29': '25–29', '30_to_34': '30–34', '35_to_44': '35–44', '45_to_54': '45–54', '55_and_older': '55 and over' };
const SHORT_DOMAIN = { 'urn:entity:brand': 'Brand', 'urn:entity:artist': 'Music', 'urn:entity:destination': 'Location', 'urn:entity:tv_show': 'TV', 'urn:entity:podcast': 'Podcast', 'urn:entity:movie': 'Film' };
const CARD_COLORS = ['#7a2a24', '#2c4a6e', '#4d5a2a', '#8a5a14', '#3b3446', '#1f4f4a', '#5a2f4a', '#2f2b26'];

const n = (v) => (v === null || v === undefined ? 'n/a' : v);

function dataSource(data) {
  if (data.dataProvenance) return data.dataProvenance;
  const calls = data.calls || [];
  const source = { mode: 'simulated', total: calls.length, live: 0, fallback: 0, simulated: 0 };
  for (const call of calls) {
    if (call.provenance === 'live') source.live += 1;
    else if (call.provenance === 'fallback') source.fallback += 1;
    else source.simulated += 1;
  }
  if (source.live) source.mode = source.live === source.total ? 'live' : 'mixed';
  else if (source.fallback) source.mode = 'fallback';
  return source;
}

const sourceLabel = (source) => ({ live: 'live', mixed: 'mixed live / simulated', fallback: 'simulated fallback', simulated: 'simulated' }[source.mode] || 'simulated');
const sourceCounts = (source) => `${source.live} live · ${source.fallback} fallback · ${source.simulated} simulated`;
const sourceClass = (source) => source.mode === 'mixed' ? 'fallback' : source.mode;
const isSimulated = (entity) => entity.simulated || String(entity.entityId).startsWith('mock:');
const entityIdLabel = (entity) => isSimulated(entity) ? 'Simulated ID' : entity.qlooVerified ? 'Qloo ID ✓' : entity.grounded ? 'Session ID' : 'Unverified ID';

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Image from Qloo if present, else a typeset title card. */
export function frame(entity, typeLabel, extraClass = '') {
  const card = `<div class="titlecard" style="background:${CARD_COLORS[hash(String(entity.entityId || entity.name)) % CARD_COLORS.length]}">
    <span class="tc-type">${esc(typeLabel)}</span><span class="tc-name">${esc(entity.name)}</span></div>`;
  if (entity.image) {
    return `<div class="frame ${extraClass}">${card}<img src="${esc(entity.image)}" alt="${esc(entity.name)}" loading="lazy" referrerpolicy="no-referrer" data-qloo-img /></div>`;
  }
  return `<div class="frame ${extraClass}">${card}</div>`;
}

/** Hide Qloo images that fail to load, revealing the title card beneath. */
export function wireImageFallbacks(root) {
  root.querySelectorAll('img[data-qloo-img]').forEach((img) => {
    img.addEventListener('error', () => img.remove(), { once: true });
  });
}

/* -------------------------------------------------------------------------- */
/* Agent's notes (live desk)                                                   */
/* -------------------------------------------------------------------------- */

function callDetail(c) {
  return Object.entries(c.params || {})
    .filter(([, v]) => !(Array.isArray(v) && v.length === 0) && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join('  ');
}

export function notesHtml(step, events) {
  const k = esc(typeof step === 'number' ? String(step).padStart(2, '0') : step);
  return events.map((ev) => {
    switch (ev.type) {
      case 'plan':
        return `<li class="note note-plan"><p class="goal">${esc(ev.goal)}</p>
          <ol>${ev.items.map((i) => `<li class="${i.conditional ? 'cond' : ''}">${esc(i.title)}</li>`).join('')}</ol></li>`;
      case 'action':
        return `<li class="note note-action${ev.conditional ? ' replanned' : ''}"><span class="note-k">${k}</span><div class="n-body"><div class="n-title">${esc(ev.title)}</div><div class="n-why">${esc(ev.why)}</div></div></li>`;
      case 'calls':
        return ev.calls.map((c) => `<li class="note note-call"><span class="note-k"></span><div class="n-body"><span class="src">QLOO ${esc(c.endpoint.replace('GET ', ''))}</span> ${esc(callDetail(c))} → ${esc(c.count)} results<span class="prov prov-${esc(c.provenance)}">${esc(c.provenance)}</span></div></li>`).join('');
      case 'observation':
        return `<li class="note note-obs"><span class="note-k"></span><div class="n-body">${esc(ev.text)}</div></li>`;
      case 'decision':
        return `<li class="note note-dec"><span class="note-k"></span><div class="n-body">${esc(ev.text)}</div></li>`;
      default:
        return '';
    }
  }).join('');
}

/* -------------------------------------------------------------------------- */
/* Coverage document                                                           */
/* -------------------------------------------------------------------------- */

function venn(a, b, overlap) {
  const r = 62;
  const f = typeof overlap === 'number' ? Math.max(0, Math.min(1, overlap)) : 0.3;
  const d = 2 * r * (1 - f * 0.85);
  const cx1 = 120 - d / 2;
  const cx2 = 120 + d / 2;
  return `<svg class="venn" viewBox="0 0 240 170" role="img" aria-label="${esc(a)} and ${esc(b)} audiences overlap ${pct(overlap)}">
    <circle cx="${cx1}" cy="78" r="${r}" fill="#b3261e" fill-opacity=".14" stroke="#1b1915" stroke-width="1.5"/>
    <circle cx="${cx2}" cy="78" r="${r}" fill="#2c4a6e" fill-opacity=".14" stroke="#1b1915" stroke-width="1.5"/>
    <text x="120" y="84" text-anchor="middle" font-size="22" font-weight="700" fill="#1b1915">${esc(pct(overlap))}</text>
    <text x="120" y="160" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="1.5" fill="#7a7366">TASTE OVERLAP</text>
  </svg>`;
}

function demoBlock(p) {
  const rows = AGE_ORDER.filter((bkt) => bkt in (p.age || {})).map((bkt) => {
    const v = p.age[bkt];
    const w = Math.min(50, Math.abs(v) * 50);
    return `<div class="demo-row"><span>${esc(AGE_LABEL[bkt])}</span>
      <div class="demo-track"><span class="demo-bar ${v >= 0 ? 'pos' : 'neg'}" style="${v >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`}"></span></div>
      <span class="demo-v">${v > 0 ? '+' : ''}${esc(v)}</span></div>`;
  }).join('');
  const lean = p.headline?.genderLean;
  return `<div class="demo"><h4>${esc(p.name)} audience</h4>${rows}
    <div class="lean">Peaks at <strong>${esc(AGE_WORDS[p.headline?.peakAge] || 'n/a')}</strong> · ${lean === 'balanced' ? 'gender-balanced' : `leans ${esc(lean)}`}</div></div>`;
}

/** A row of small Qloo posters. `marked` names get a red rule (shared across comps). */
function posterStrip(films, marked = new Set()) {
  return `<div class="strip">${films.map((f) => `<figure class="strip-item${marked.has(f.name) ? ' shared' : ''}">${frame(f, 'Film')}<figcaption>${esc(f.name)}</figcaption></figure>`).join('')}</div>`;
}

function partnerCard(r, opts = {}) {
  return `<article class="partner" data-entity="${esc(r.entityId)}" data-domain="${esc(r.domain)}" tabindex="0" role="button" aria-label="Details for ${esc(r.name)}">
    <button type="button" class="pin" data-act="pin" data-entity="${esc(r.entityId)}" aria-pressed="${opts.pinned ? 'true' : 'false'}" title="Add to deal sheet">${opts.pinned ? '✓ On deal sheet' : '+ Deal sheet'}</button>
    ${frame(r, SHORT_DOMAIN[r.domain] || '')}
    <div class="p-cat">${esc(DOMAIN_LABELS[r.domain] || r.domain)}${r.whiteSpace ? '<span class="badge-ws">White space</span>' : ''}</div>
    <div class="p-name">${esc(r.name)}</div>
    <p class="p-action">${esc(r.action)}</p>
    <p class="p-ev">${esc(r.evidence)}</p>
    <div class="p-id" title="${isSimulated(r) ? 'Simulated entity; not a live Qloo ID' : r.qlooVerified ? 'Returned by live Qloo in this session' : r.grounded ? 'Found in this session\'s evidence' : 'Not found in this session'}">${entityIdLabel(r)} ${esc(r.entityId)}</div>
  </article>`;
}

export { partnerCard };

export function bars(aff, pop) {
  return `<div class="bars">
    <div class="bar-row"><span>Popularity</span><div class="track"><div class="fill" style="width:${barWidth(pop)}%"></div></div><span class="v">${pct(pop)}</span></div>
    <div class="bar-row"><span>Affinity</span><div class="track"><div class="fill aff" style="width:${barWidth(aff)}%"></div></div><span class="v">${pct(aff)}</span></div>
  </div>`;
}

function moodItems(evidence) {
  const order = ['urn:entity:destination', 'urn:entity:brand', 'urn:entity:artist', 'urn:entity:tv_show', 'urn:entity:podcast'];
  const items = [];
  const buckets = order.filter((u) => evidence.domains[u]).map((u) => ({ urn: u, list: [...evidence.domains[u].entities] }));
  // Round-robin across categories so the board mixes places, objects and sounds.
  while (items.length < 9 && buckets.some((bkt) => bkt.list.length)) {
    for (const bkt of buckets) {
      const e = bkt.list.shift();
      if (e && items.length < 9) items.push({ ...e, urn: bkt.urn });
    }
  }
  return items;
}

const COMPONENT_LABEL = { alignment: 'alignment', coherence: 'comp overlap', conceptFit: 'concept fit', demographics: 'demographic fit' };

export function renderCoverage(result, brief, coverageNo) {
  const { memo, scorecard: card, evidence, grounding } = result;
  const comps = evidence.comps;
  const source = dataSource(evidence);
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const verdictWord = { GREENLIGHT: 'Recommend', 'CONDITIONAL GREENLIGHT': 'Consider', REWORK: 'Rework', PASS: 'Pass' }[memo.verdict] || memo.verdict;
  const sec = (num, label, title, body) => `<section class="doc-sec"><h3><span class="num">${num}</span>${esc(label)}</h3><h4 class="sec-title">${title}</h4>${body}</section>`;

  /* I. The comps */
  const compCards = comps.map((c) => `<div class="comp-card">${frame(c, 'Comparable')}<div class="c-name">${esc(c.name)}${c.year ? ` <small>(${esc(c.year)})</small>` : ''}</div><div class="c-meta">Popularity ${pct(c.popularity)} · <span class="prov prov-${esc(c.provenance)}">${esc(c.provenance)}</span></div></div>`);
  const faceoff = comps.length === 2
    ? `<div class="faceoff">${compCards[0]}${venn(comps[0].name, comps[1].name, evidence.coherence?.value)}${compCards[1]}</div>`
    : `<div class="faceoff ${comps.length === 3 ? 'three' : ''}">${compCards.join('')}</div>`;
  const sharedSet = new Set((evidence.compLists || []).flatMap((l, i) => l.top.filter((nm) => evidence.compLists.some((o, j) => j !== i && o.top.includes(nm)))));
  const compsBody = `${faceoff}
    <p style="margin-top:22px">${esc(memo.compFinding)}</p>
    ${evidence.demographics?.byComp?.length ? `<div class="demos">${evidence.demographics.byComp.map(demoBlock).join('')}</div><p class="source">Qloo /v2/insights · filter.type=urn:demographics. Bars right of centre over-index; left under-index.</p>` : ''}
    ${evidence.coherence?.pairs?.length ? `<div class="cross">${evidence.coherence.pairs.map((p) => `<div class="cross-row"><span>${esc(p.a)} fans rate <strong>${esc(p.b)}</strong></span><div class="track"><div class="fill aff" style="width:${barWidth(p.score)}%"></div></div><span class="v">${p.affinity === null ? 'n/a' : esc(p.affinity.toFixed(3))}</span></div>`).join('')}</div>
      <p class="source">Qloo /v2/insights · filter.results.entities: each comp scored against the other's audience. 0.65 = unrelated audiences, 0.93 = same audience.</p>` : ''}
    ${evidence.compLists ? evidence.compLists.map((l) => `<div class="watchlist"><h4>${esc(l.anchor)} fans also watch</h4>${posterStrip(l.films || l.top.map((name) => ({ name })), sharedSet)}</div>`).join('') + `<p class="source">Qloo /v2/insights · filter.type=urn:entity:movie, one query per comp${sharedSet.size ? '. Titles with a red rule are loved by both audiences' : ''}.</p>` : ''}
    ${evidence.compare?.shared?.length ? `<p class="source">Qloo /v2/analysis/compare shared markers: ${esc(evidence.compare.shared.join(', '))}</p>` : ''}`;

  /* II. The audience */
  const also = (evidence.blendedFilms || []).slice(0, 6);
  const audienceBody = `<p>${esc(memo.audiencePortrait)}</p>
    ${evidence.tasteDna?.length ? `<div class="dna">${evidence.tasteDna.slice(0, 10).map((t) => `<span>${esc(t.name)}</span>`).join('')}</div><p class="source">Qloo taste analysis · /v2/insights · filter.type=urn:tag</p>` : ''}
    ${also.length ? `${posterStrip(also)}<p class="source">Qloo /v2/insights · films the combined comp audience over-indexes on</p>` : ''}`;

  /* III. Concept */
  const lanes = evidence.conceptFit?.lanes || [];
  const conceptBody = `<p>${esc(memo.conceptFinding)}</p>
    ${lanes.map((l) => `<div class="lane"><div class="lane-head"><strong>${esc(l.tag)}</strong><div class="track"><div class="fill aff" style="width:${barWidth(l.strength)}%"></div></div><span class="v">${l.strength === null ? 'no films' : `${pct(l.strength)} appetite`}</span></div>
      ${l.films?.length ? posterStrip(l.films) : '<p class="hint">Qloo has no films in this lane for this audience.</p>'}</div>`).join('')}
    ${lanes.length ? `<p class="source">Qloo /v2/insights · the comps' audience filtered by each genre tag (filter.tags=${esc(lanes.map((l) => l.tagId).join(','))})</p>` : ''}
    ${evidence.bridges?.length ? `<h4 class="sub">Bridge titles: audiences that span the comps and the concept</h4>
      <div class="bridges">${evidence.bridges.map((b) => `<div class="bridge-card">${frame(b, 'Bridge')}<div class="c-name">${esc(b.name)}</div><button type="button" class="btn btn-small" data-act="swap" data-name="${esc(b.name)}">Re-run with this as a comp</button></div>`).join('')}</div>` : ''}`;

  /* IV. Partners */
  const recIds = new Set(memo.recommendations.map((r) => r.entityId));
  const partnersBody = `<p>Toggle any category to see what Qloo ranks first with no filter (the names every audience over-indexes on) against what is distinctive to <em>this</em> audience. Click a card for the evidence; pin the ones you want on the deal sheet.</p>
    ${Object.entries(evidence.domains).map(([urn, d]) => `<div class="explorer" data-domain="${esc(urn)}">
      <div class="explorer-head"><h4>${esc(DOMAIN_LABELS[urn] || urn)}</h4>
        <div class="seg" role="group" aria-label="View"><button type="button" class="is-on" data-act="view" data-view="distinctive" data-domain="${esc(urn)}">Distinctive</button><button type="button" data-act="view" data-view="mass" data-domain="${esc(urn)}">Mass-market</button></div></div>
      <div class="partners" data-grid="${esc(urn)}">${memo.recommendations.filter((r) => r.domain === urn).map((r) => partnerCard(r)).join('') || d.entities.slice(0, 3).map((e) => partnerCard({ ...e, domain: urn, action: '', evidence: `Audience affinity ${pct(e.affinity)}, popularity percentile ${pct(e.popularity)}.` })).join('')}</div>
    </div>`).join('')}
    <p class="source">Qloo /v2/insights per category · distinctive = filter.popularity.min/max band${comps.length > 1 ? ' · feature.explainability=true' : ''}</p>`;

  /* V. Popularity traps */
  const trapsBody = memo.popularityTraps.length ? `<div class="traps">
      <p>These top every audience's list. They are what a team picks by default, and Qloo shows they say nothing specific about this one. The distinctive picks above are where this audience's attention really goes.</p>
      <div class="trap-grid">${memo.popularityTraps.map((t) => `<div class="trap"><div class="t-cat">${esc(DOMAIN_LABELS[t.domain])}</div><div class="t-name">${esc(t.name)}</div>${bars(t.affinity, t.popularity)}</div>`).join('')}</div>
    </div><p class="source">Qloo popularity vs audience affinity, same queries as above</p>` : '';

  /* VI. Moodboard */
  const mood = moodItems(evidence);
  const moodBody = mood.length ? `<p>The world this audience lives in, for production design, wardrobe, locations and music supervision.</p>
    <div class="moodboard">${mood.map((m) => `<figure class="mood">${frame(m, SHORT_DOMAIN[m.urn], 'fill')}${m.image ? `<figcaption>${esc(m.name)}</figcaption>` : ''}</figure>`).join('')}</div>
    <p class="source">Entity images where available; title cards for missing images. Data: ${esc(sourceLabel(source))}.</p>` : '';

  /* VII. Risks & next steps */
  const risksBody = `<div class="table-wrap"><table class="ledger"><thead><tr><th>Severity</th><th>Risk</th><th>Mitigation</th></tr></thead><tbody>
    ${memo.risks.map((r) => `<tr><td><span class="sev sev-${esc(r.severity)}">${esc(r.severity)}</span></td><td>${esc(r.risk)}</td><td>${esc(r.mitigation)}</td></tr>`).join('')}
    </tbody></table></div>
    <h4 class="sec-title" style="margin-top:28px">Next steps</h4>
    <ol class="next">${memo.nextSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;

  const calls = evidence.calls.map((c, i) => `<tr><td>${i + 1}</td><td class="mono">${esc(c.endpoint)}</td><td class="mono">${esc(callDetail(c))}</td><td><span class="prov prov-${esc(c.provenance)}">${esc(c.provenance)}</span>${c.failure ? ` <small>${esc(c.failure)}</small>` : ''}</td><td>${esc(c.count)}</td></tr>`).join('');

  let num = 0;
  const roman = () => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][num++];

  return `<div class="doc-tools">
      <button type="button" class="btn btn-small" data-act="print">Print / PDF</button>
      <button type="button" class="btn btn-small" data-act="copy">Copy as text</button>
      <button type="button" class="btn btn-small" data-act="json">Download evidence</button>
    </div>
    <div class="doc">
      <div class="stamp ${verdictClass(memo.verdict)}">${esc(verdictWord)}<small>${esc(memo.verdict)}</small></div>
      <div class="doc-kicker">Audience coverage · No. ${esc(coverageNo)}</div>
      <h2 class="doc-title">${esc(brief.title)}</h2>
      <dl class="facts">
        <div><dt>Comparables</dt><dd>${esc(comps.map((c) => c.name).join(' × ') || brief.anchors.join(' × '))}</dd></div>
        <div><dt>Budget</dt><dd>${brief.budgetMillions ? `$${esc(brief.budgetMillions)}M` : 'n/a'}</dd></div>
        <div><dt>Date</dt><dd>${esc(date)}</dd></div>
        <div><dt>Data</dt><dd>Qloo Taste AI · <span class="prov prov-${sourceClass(source)}">${esc(sourceLabel(source))}</span><br>${esc(sourceCounts(source))}</dd></div>
        <div><dt>Evidence</dt><dd>${esc(evidence.calls.length)} calls · ${esc(grounding.grounded)}/${esc(grounding.total)} IDs traced to session · ${esc(grounding.qlooVerified ?? 0)} live Qloo IDs</dd></div>
        <div><dt>Analyst</dt><dd>CultureRisk research agent</dd></div>
      </dl>

      ${source.mode !== 'live' ? `<p class="form-error" role="note"><strong>${source.mode === 'mixed' ? 'Mixed data' : source.mode === 'fallback' ? 'Qloo fallback' : 'Simulated data'}:</strong> ${esc(sourceCounts(source))}. This coverage includes simulated signals. Re-run for fully live evidence before acting.</p>` : ''}

      <div class="verdict-block">
        <div class="score"><div class="score-n">${esc(n(card.cultureRiskScore))}<small>/100</small></div><div class="score-l">Culture risk</div></div>
        <div><p class="headline">${esc(memo.headline)}</p>${memo.keyFindings?.length ? `<ul class="findings">${memo.keyFindings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : `<p class="summary">${esc(memo.executiveSummary)}</p>`}</div>
      </div>

      <div class="metrics">
        <div class="metric"><div class="m-n">${esc(n(card.alignment))}</div><div class="m-l">Alignment</div><div class="m-s">Mean audience affinity</div></div>
        <div class="metric"><div class="m-n">${card.coherence === null ? 'n/a' : `${card.coherence}%`}</div><div class="m-l">Comp overlap</div><div class="m-s">Same taste audience?</div></div>
        <div class="metric"><div class="m-n">${card.demographics === null ? 'n/a' : `${card.demographics}%`}</div><div class="m-l">Demographic fit</div><div class="m-s">Same age &amp; gender?</div></div>
        <div class="metric"><div class="m-n">${card.conceptFit === null ? 'n/a' : `${card.conceptFit}%`}</div><div class="m-l">Concept fit</div><div class="m-s">Script ↔ comps</div></div>
      </div>
      <p class="formula">Risk = 100 − (${card.components.map((c) => `<b>${Math.round(c.weight * 100)}%</b> × ${esc(COMPONENT_LABEL[c.key])} ${esc(c.value)}`).join(' + ')}) + dispersion penalty → <b>${esc(n(card.rawScore ?? card.cultureRiskScore))}</b>${card.gates?.length ? ` · raised to <b>${esc(card.cultureRiskScore)}</b> by the ${esc(card.gates.map((g) => COMPONENT_LABEL[g.key]).join(' and '))} gate` : ''}</p>

      ${sec(roman(), 'The comps', comps.length > 1 ? 'Do these audiences actually overlap?' : 'The comparable audience', compsBody)}
      ${sec(roman(), 'The audience', 'Who they are and what they love', audienceBody)}
      ${sec(roman(), 'The concept', 'Does the script attract the same people?', conceptBody)}
      ${sec(roman(), 'Partners', 'Where this audience\'s attention is', partnersBody)}
      ${trapsBody ? sec(roman(), 'Without Qloo', 'The famous names this audience shrugs at', trapsBody) : ''}
      ${moodBody ? sec(roman(), 'Moodboard', 'Their world, in pictures', moodBody) : ''}
      ${sec(roman(), 'Risks', 'What could go wrong, and what to do', risksBody)}

      <div class="appendix">
        <details><summary>Appendix A: The agent's notes</summary><ol class="notes" data-appendix-notes></ol></details>
        <details><summary>Appendix B: Qloo call ledger (${esc(evidence.calls.length)} calls)</summary>
          <div class="table-wrap"><table class="ledger"><thead><tr><th>#</th><th>Endpoint</th><th>Parameters</th><th>Data</th><th>Results</th></tr></thead><tbody>${calls}</tbody></table></div>
        </details>
      </div>
      <div class="doc-foot"><span>CultureRisk · coverage generated from Qloo Taste AI</span><span>Every figure above traces to Appendix B</span></div>
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Quick read                                                                  */
/* -------------------------------------------------------------------------- */

export function renderQuickScan(data) {
  const s = data.summary || {};
  const source = dataSource(data);
  const ws = new Set((data.whiteSpace || []).map((w) => w.entityId));
  return `<div class="scan-head"><strong>${esc(data.anchor?.title)}</strong><span>${esc(data.domainLabel)}</span>
      <span>Alignment ${esc(n(s.alignmentIndex))}/100</span><span class="prov prov-${sourceClass(source)}">${esc(sourceLabel(source))}</span><span>${esc(sourceCounts(source))}</span></div>
    <div class="partners">${(data.results || []).map((r) => `<article class="partner">${frame(r, SHORT_DOMAIN[data.targetDomain] || '')}
      <div class="p-cat">${ws.has(r.entityId) ? '<span class="badge-ws">White space</span>' : ''}</div>
      <div class="p-name">${esc(r.name)}</div>${bars(r.affinity, r.popularity)}<div class="p-id">${esc(r.entityId)}</div></article>`).join('')}</div>
    <p class="source">Qloo /search → /v2/insights · filter.type=${esc(data.targetDomain)}</p>`;
}

/* -------------------------------------------------------------------------- */
/* Plain-text export                                                           */
/* -------------------------------------------------------------------------- */

export function memoToMarkdown(brief, result) {
  const { memo, scorecard: card, evidence } = result;
  const source = dataSource(evidence);
  const p = (v) => (v === null || v === undefined ? 'n/a' : `${v}%`);
  return [
    `# Audience Coverage: ${brief.title}`,
    '',
    `**Verdict:** ${memo.verdict} (${memo.confidence} confidence) · **Culture risk:** ${card.cultureRiskScore}/100`,
    `**Alignment:** ${card.alignment}/100 · **Comp overlap:** ${p(card.coherence)} · **Demographic fit:** ${p(card.demographics)} · **Concept fit:** ${p(card.conceptFit)}`,
    `**Comparables:** ${evidence.comps.map((c) => c.name).join(' × ')}`,
    `**Data:** ${sourceLabel(source)} (${sourceCounts(source)})`,
    '',
    `> ${memo.headline}`,
    '',
    memo.executiveSummary, '',
    '## The comps', memo.compFinding, '',
    '## The audience', memo.audiencePortrait, '',
    '## The concept', memo.conceptFinding, '',
    '## Partners',
    ...memo.recommendations.map((r) => `- **${r.name}** (${DOMAIN_LABELS[r.domain] || r.domain}, ${entityIdLabel(r)} \`${r.entityId}\`): ${r.action} _${r.evidence}_`),
    '',
    ...(memo.popularityTraps.length ? ['## Without Qloo: popularity traps', ...memo.popularityTraps.map((t) => `- ${t.name}: popularity ${pct(t.popularity)}, audience affinity ${pct(t.affinity)}`), ''] : []),
    '## Risks',
    ...memo.risks.map((r) => `- **[${r.severity}]** ${r.risk} → ${r.mitigation}`),
    '',
    '## Next steps',
    ...memo.nextSteps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `_CultureRisk coverage from ${evidence.calls.length} calls (${sourceLabel(source)}; ${sourceCounts(source)})._`,
  ].join('\n');
}
