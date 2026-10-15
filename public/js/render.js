/**
 * CultureRisk AI — view rendering. Pure functions from data to HTML strings;
 * every dynamic value is escaped.
 */

import { esc, pct, barWidth, DOMAIN_LABELS, verdictClass } from './dom.js';

const AGE_ORDER = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];
const AGE_LABEL = { '24_and_younger': '<25', '25_to_29': '25–29', '30_to_34': '30–34', '35_to_44': '35–44', '45_to_54': '45–54', '55_and_older': '55+' };

/* -------------------------------------------------------------------------- */
/* Research log (live trace)                                                   */
/* -------------------------------------------------------------------------- */

function callLabel(c) {
  const ft = c.params?.['filter.type'];
  return ft ? `${c.endpoint} · ${ft.replace('urn:entity:', '').replace('urn:', '')}` : c.endpoint;
}

function callDetail(c) {
  return Object.entries(c.params || {})
    .filter(([, v]) => !(Array.isArray(v) && v.length === 0) && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join('\n');
}

/** Append one step's events to the log. */
export function appendTraceEvents(list, step, events) {
  const html = events.map((ev) => {
    switch (ev.type) {
      case 'plan':
        return `<li class="log log-plan"><div class="log-body">
          <div class="log-kicker">Goal</div><p class="plan-goal">${esc(ev.goal)}</p>
          <div class="log-kicker">Initial plan</div>
          <ol class="plan">${ev.items.map((i) => `<li class="${i.conditional ? 'cond' : ''}">${esc(i.title)}</li>`).join('')}</ol>
        </div></li>`;
      case 'action':
        return `<li class="log log-action${ev.conditional ? ' replanned' : ''}"><span class="log-step">${esc(String(step).padStart(2, '0'))}</span><div class="log-body">
          <div class="action-title">${esc(ev.title)}${ev.conditional ? '<span class="chip chip-warn">re-planned</span>' : ''}</div>
          <p class="action-why">${esc(ev.why)}</p></div></li>`;
      case 'calls':
        return ev.calls.length ? `<li class="log log-calls"><span class="log-step"></span><div class="log-body calls-row">${ev.calls.map((c) => `
          <details class="call"><summary><span class="chip chip-qloo">${esc(callLabel(c))}</span><span class="prov prov-${esc(c.provenance)}">${esc(c.provenance)}</span><span class="call-meta">${esc(c.count)} results · ${esc(c.ms)} ms</span></summary>
          <pre>${esc(callDetail(c))}</pre></details>`).join('')}</div></li>` : '';
      case 'observation':
        return `<li class="log log-obs"><span class="log-step"></span><div class="log-body"><span class="tag-obs">Observed</span>${esc(ev.text)}</div></li>`;
      case 'decision':
        return `<li class="log log-dec"><span class="log-step"></span><div class="log-body"><span class="tag-dec">Decided</span>${esc(ev.text)}</div></li>`;
      default:
        return '';
    }
  }).join('');
  list.insertAdjacentHTML('beforeend', html);
  list.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* -------------------------------------------------------------------------- */
/* Memo                                                                        */
/* -------------------------------------------------------------------------- */

function kpi(label, value, sub, cls = '') {
  return `<div class="kpi"><div class="k-label">${esc(label)}</div><div class="k-value ${esc(cls)}">${esc(value)}</div><div class="k-sub">${esc(sub)}</div></div>`;
}

const COMPONENT_LABEL = { alignment: 'Domain alignment', coherence: 'Comp taste overlap', conceptFit: 'Concept fit', demographics: 'Demographic fit' };

export function renderMemo(result, brief) {
  const { memo, scorecard: card, grounding, evidence } = result;
  const n = (v) => (v === null || v === undefined ? 'n/a' : v);

  const recs = memo.recommendations.map((r) => `
    <article class="rec${r.whiteSpace ? ' rec-ws' : ''}">
      <div class="rec-head"><span class="chip">${esc(DOMAIN_LABELS[r.domain] || r.domain)}</span>${r.whiteSpace ? '<span class="chip chip-ok">White space</span>' : ''}</div>
      <h4>${esc(r.name)}</h4>
      <p class="rec-action">${esc(r.action)}</p>
      <p class="rec-evidence">${esc(r.evidence)}</p>
      <code class="rec-id" title="${r.grounded ? 'Returned by Qloo in this session' : 'Not found in this session'}">${r.grounded ? '✓ ' : ''}${esc(r.entityId)}</code>
    </article>`).join('');

  const traps = memo.popularityTraps.length ? `
    <section class="memo-sec why-qloo">
      <h3>What you'd get wrong without Qloo</h3>
      <p class="sec-lede">The obvious play is the biggest name. Qloo shows this audience is lukewarm on these, and the money is better spent on the white-space picks above.</p>
      <div class="traps">${memo.popularityTraps.map((t) => `
        <div class="trap">
          <div class="trap-name">${esc(t.name)} <small>${esc(DOMAIN_LABELS[t.domain])}</small></div>
          <div class="trap-bars">
            <div class="metric"><span class="m-label">POPULARITY</span><div class="bar pop"><span style="width:${barWidth(t.popularity)}%"></span></div><span class="m-val">${pct(t.popularity)}</span></div>
            <div class="metric"><span class="m-label">AFFINITY</span><div class="bar"><span style="width:${barWidth(t.affinity)}%"></span></div><span class="m-val">${pct(t.affinity)}</span></div>
          </div>
        </div>`).join('')}</div>
    </section>` : '';

  const risks = memo.risks.map((r) => `<tr><td><span class="sev sev-${esc(r.severity)}">${esc(r.severity)}</span></td><td>${esc(r.risk)}</td><td>${esc(r.mitigation)}</td></tr>`).join('');

  return `
    <header class="memo-head">
      <div class="memo-eyebrow">Greenlight memo · ${esc(brief.title)}${brief.budgetMillions ? ` · $${esc(brief.budgetMillions)}M` : ''}</div>
      <div class="verdict-row">
        <div class="v-text ${verdictClass(memo.verdict)}">${esc(memo.verdict)}</div>
        <div class="risk-dial" style="--risk:${n(card.cultureRiskScore) === 'n/a' ? 0 : card.cultureRiskScore}"><span>${esc(n(card.cultureRiskScore))}</span><small>risk</small></div>
      </div>
      <p class="memo-headline">${esc(memo.headline)}</p>
      <div class="memo-meta">
        <span>${esc(memo.confidence)} confidence</span>
        <span>${esc(evidence.calls.length)} Qloo calls</span>
        <span>${esc(grounding.grounded)}/${esc(grounding.total)} recommendations verified against Qloo IDs</span>
        <span class="prov prov-${evidence.liveData ? 'live' : 'simulated'}">${evidence.liveData ? 'live Qloo data' : 'simulated data'}</span>
      </div>
    </header>

    <div class="kpis">
      ${kpi('Alignment', n(card.alignment), 'Mean audience affinity /100')}
      ${kpi('Comp overlap', card.coherence === null ? 'n/a' : `${card.coherence}%`, 'Do the comps share a taste audience?')}
      ${kpi('Demographic fit', card.demographics === null ? 'n/a' : `${card.demographics}%`, 'Do the comps share a demo?')}
      ${kpi('Concept fit', card.conceptFit === null ? 'n/a' : `${card.conceptFit}%`, 'Does the script match its comps?')}
    </div>

    <p class="formula" aria-label="How the risk score is built">
      <span>Risk = 100 −</span> ${card.components.map((c) => `<span class="term"><b>${Math.round(c.weight * 100)}%</b> ${esc(COMPONENT_LABEL[c.key].toLowerCase())} <em>${esc(c.value)}</em></span>`).join('<span>+</span>')}
      ${card.dispersion ? `<span>+ dispersion penalty</span>` : ''}
    </p>

    <section class="memo-sec"><h3>Executive summary</h3><p>${esc(memo.executiveSummary)}</p></section>
    <section class="memo-sec"><h3>The audience</h3><p>${esc(memo.audiencePortrait)}</p></section>
    <section class="memo-sec two-col">
      <div><h3>Comp stress test</h3><p>${esc(memo.compFinding)}</p></div>
      <div><h3>Concept fit</h3><p>${esc(memo.conceptFinding)}</p></div>
    </section>
    <section class="memo-sec"><h3>Recommendations</h3><div class="recs">${recs}</div></section>
    ${traps}
    <section class="memo-sec"><h3>Risk register</h3>
      <div class="table-wrap"><table class="risks"><thead><tr><th>Severity</th><th>Risk</th><th>Mitigation</th></tr></thead><tbody>${risks}</tbody></table></div>
    </section>
    <section class="memo-sec"><h3>Next steps</h3><ol class="next">${memo.nextSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>`;
}

/* -------------------------------------------------------------------------- */
/* Audience                                                                    */
/* -------------------------------------------------------------------------- */

function demoChart(profile) {
  const rows = AGE_ORDER.filter((b) => b in (profile.age || {})).map((b) => {
    const v = profile.age[b];
    const w = Math.min(50, Math.abs(v) * 50);
    return `<div class="demo-row"><span class="demo-label">${esc(AGE_LABEL[b])}</span>
      <div class="demo-track"><span class="demo-bar ${v >= 0 ? 'pos' : 'neg'}" style="${v >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`}"></span></div>
      <span class="demo-val">${v > 0 ? '+' : ''}${esc(v)}</span></div>`;
  }).join('');
  const male = profile.gender?.male ?? 0;
  return `<div class="demo-card"><div class="demo-title">${esc(profile.name)}</div>${rows}
    <div class="gender"><span>♀</span><div class="gender-track"><span style="left:${50 + male * 50}%"></span></div><span>♂</span></div>
    <p class="hint">Bars show Qloo age affinity: right of centre over-indexes, left under-indexes.</p></div>`;
}

export function renderAudience(evidence) {
  const demo = evidence.demographics;
  const parts = [];
  if (demo?.byComp?.length) {
    parts.push(`<section class="memo-sec"><h3>Demographics by comp <small>filter.type=urn:demographics</small></h3>
      ${demo.coherence !== null && demo.coherence !== undefined ? `<p class="sec-lede">Demographic similarity between comps: <strong>${pct(demo.coherence)}</strong></p>` : ''}
      <div class="demo-grid">${demo.byComp.map(demoChart).join('')}</div></section>`);
  }
  if (evidence.tasteDna?.length) {
    parts.push(`<section class="memo-sec"><h3>Taste DNA <small>filter.type=urn:tag</small></h3>
      <div class="dna">${evidence.tasteDna.map((t) => `<span class="dna-tag" style="--w:${typeof t.affinity === 'number' ? t.affinity : 0.5}">${esc(t.name)}</span>`).join('')}</div></section>`);
  }
  if (evidence.compLists) {
    const shared = new Set(evidence.compLists.flatMap((l, i) => l.top.filter((n) => evidence.compLists.some((o, j) => j !== i && o.top.includes(n)))));
    parts.push(`<section class="memo-sec"><h3>What each comp's audience watches <small>per-comp /v2/insights</small></h3>
      <p class="sec-lede">Taste overlap: <strong>${pct(evidence.coherence?.value)}</strong>. Highlighted titles are loved by more than one comp's audience.</p>
      <div class="coh-grid">${evidence.compLists.map((l) => `<div class="coh-col"><div class="coh-title">${esc(l.anchor)}</div><ol>${l.top.map((nm) => `<li class="${shared.has(nm) ? 'shared' : ''}">${esc(nm)}</li>`).join('')}</ol></div>`).join('')}</div>
      ${evidence.compare?.shared?.length ? `<p class="hint">Qloo /v2/analysis/compare shared markers: ${esc(evidence.compare.shared.join(', '))}</p>` : ''}
      ${evidence.bridges?.length ? `<p class="bridge">Bridge titles: <strong>${esc(evidence.bridges.map((b) => b.name).join(', '))}</strong></p>` : ''}
    </section>`);
  }
  if (evidence.conceptFit) {
    parts.push(`<section class="memo-sec"><h3>Concept fit <small>tags: ${esc(evidence.conceptTags.map((t) => t.name).join(', '))}</small></h3>
      <p>The audience for the script's own themes loves <strong>${esc(evidence.conceptFit.conceptTop.slice(0, 4).join(', '))}</strong>. Overlap with the comps' audience: <strong>${pct(evidence.conceptFit.value)}</strong>.</p>
      ${Object.keys(evidence.conceptFit.perComp || {}).length ? `<div class="domains">${Object.entries(evidence.conceptFit.perComp).map(([k, v]) => `<div class="drow"><span class="dlabel">${esc(k)}</span><div class="bar"><span style="width:${barWidth(v)}%"></span></div><span class="dval">${pct(v)}</span><span></span></div>`).join('')}</div>` : ''}
    </section>`);
  }
  return parts.join('') || '<div class="empty"><h3>No audience data</h3></div>';
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

export function renderEvidence(evidence) {
  const comps = evidence.comps.map((c) => `
    <li><strong>${esc(c.name)}</strong>${c.year ? ` (${esc(c.year)})` : ''}${c.disambiguation ? ` <small>${esc(c.disambiguation)}</small>` : ''} <code>${esc(c.entityId)}</code>
    <span class="prov prov-${esc(c.provenance)}">${esc(c.provenance)}</span>${c.exactMatch ? '' : ' <span class="chip chip-warn">closest match</span>'}</li>`).join('');

  const domains = Object.entries(evidence.domains).map(([urn, d]) => `
    <h4>${esc(DOMAIN_LABELS[urn] || urn)} <small>alignment ${esc(d.profile.alignment ?? 'n/a')} · σ ${esc(d.profile.dispersion ?? 'n/a')}${d.retried ? ' · re-queried' : ''}</small></h4>
    ${d.drivers ? `<p class="hint">Driven by: ${esc(Object.entries(d.drivers).map(([k, v]) => `${k} ${pct(v)}`).join(' · '))} (feature.explainability)</p>` : ''}
    <div class="table-wrap"><table><thead><tr><th>Entity</th><th>Affinity</th><th>Popularity</th><th>Gap</th></tr></thead><tbody>
    ${[...d.entities, ...(d.probe || [])].map((e) => {
      const gap = typeof e.affinity === 'number' && typeof e.popularity === 'number' ? e.affinity - e.popularity : null;
      return `<tr><td>${esc(e.name)} <code>${esc(e.entityId)}</code></td><td>${pct(e.affinity)}</td><td>${pct(e.popularity)}</td><td class="${gap > 0.08 ? 'gap-pos' : ''}">${gap === null ? 'n/a' : `${gap > 0 ? '+' : ''}${Math.round(gap * 100)}`}</td></tr>`;
    }).join('')}</tbody></table></div>`).join('');

  const calls = evidence.calls.map((c, i) => `
    <tr><td>${i + 1}</td><td><code>${esc(c.endpoint)}</code></td><td class="sig">${esc(callDetail(c)).replace(/\n/g, '<br>')}</td>
    <td><span class="prov prov-${esc(c.provenance)}">${esc(c.provenance)}</span>${c.failure ? ` <small>${esc(c.failure)}</small>` : ''}</td><td>${esc(c.count)}</td><td>${esc(c.ms)} ms</td></tr>`).join('');

  return `
    <h4>Resolved comparable titles</h4><ul class="anchors">${comps || '<li>None</li>'}</ul>
    ${evidence.droppedComps?.length ? `<p class="hint">Not found in Qloo: ${esc(evidence.droppedComps.join(', '))}</p>` : ''}
    ${domains}
    <h4>Qloo call audit <small>${evidence.calls.length} calls</small></h4>
    <div class="table-wrap"><table class="calls"><thead><tr><th>#</th><th>Endpoint</th><th>Parameters</th><th>Provenance</th><th>Results</th><th>Latency</th></tr></thead><tbody>${calls}</tbody></table></div>`;
}

/* -------------------------------------------------------------------------- */
/* Quick scan                                                                  */
/* -------------------------------------------------------------------------- */

export function renderQuickScan(data) {
  const s = data.summary || {};
  const ws = new Set((data.whiteSpace || []).map((w) => w.entityId));
  const cards = (data.results || []).map((r, i) => `
    <article class="card">
      <div class="card-head"><div class="card-name">${esc(r.name)}</div><div class="card-rank">#${i + 1}</div></div>
      <div class="metric"><span class="m-label">AFFINITY</span><div class="bar"><span style="width:${barWidth(r.affinity)}%"></span></div><span class="m-val">${pct(r.affinity)}</span></div>
      <div class="metric"><span class="m-label">POPULARITY</span><div class="bar pop"><span style="width:${barWidth(r.popularity)}%"></span></div><span class="m-val">${pct(r.popularity)}</span></div>
      ${(r.tags || []).length ? `<div class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${ws.has(r.entityId) ? '<span class="chip chip-ok">White space: affinity &gt; popularity</span>' : ''}
    </article>`).join('');

  return `
    <div class="result-meta">
      <span class="badge ${data.mode === 'live' ? 'live' : 'mock'}">${data.mode === 'live' ? 'LIVE · QLOO' : 'SIMULATED'}</span>
      <span>Anchor: ${esc(data.anchor?.title)}</span><span>Layer: ${esc(data.domainLabel)}</span>
      ${data.reason ? `<span>reason: ${esc(data.reason)}</span>` : ''}
    </div>
    <div class="kpis">
      ${kpi('Verdict', s.verdict, 'Single-domain read', verdictClass(s.verdict))}
      ${kpi('Culture risk', s.cultureRiskScore ?? 'n/a', '0 safest · 100 riskiest')}
      ${kpi('Alignment', s.alignmentIndex ?? 'n/a', 'Mean affinity /100')}
      ${kpi('Dispersion σ', s.dispersion ?? 'n/a', 'Audience consistency')}
    </div>
    <div class="cards">${cards}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

export function memoToMarkdown(brief, result) {
  const { memo, scorecard: card, evidence } = result;
  const p = (v) => (v === null || v === undefined ? 'n/a' : `${v}%`);
  return [
    `# Greenlight Memo: ${brief.title}`,
    '',
    `**Verdict:** ${memo.verdict} (${memo.confidence} confidence) · **Culture risk:** ${card.cultureRiskScore}/100`,
    `**Alignment:** ${card.alignment}/100 · **Comp overlap:** ${p(card.coherence)} · **Demographic fit:** ${p(card.demographics)} · **Concept fit:** ${p(card.conceptFit)}`,
    `**Comparables:** ${evidence.comps.map((c) => c.name).join(', ')}`,
    '',
    `> ${memo.headline}`,
    '',
    '## Executive summary', memo.executiveSummary, '',
    '## The audience', memo.audiencePortrait, '',
    '## Comp stress test', memo.compFinding, '',
    '## Concept fit', memo.conceptFinding, '',
    '## Recommendations',
    ...memo.recommendations.map((r) => `- **${r.name}** (${DOMAIN_LABELS[r.domain] || r.domain}, \`${r.entityId}\`): ${r.action} _${r.evidence}_`),
    '',
    ...(memo.popularityTraps.length ? ['## Popularity traps', ...memo.popularityTraps.map((t) => `- ${t.name}: popularity ${pct(t.popularity)}, audience affinity ${pct(t.affinity)}`), ''] : []),
    '## Risks',
    ...memo.risks.map((r) => `- **[${r.severity}]** ${r.risk} → ${r.mitigation}`),
    '',
    '## Next steps',
    ...memo.nextSteps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `_Generated by CultureRisk AI from ${evidence.calls.length} Qloo API calls (${evidence.liveData ? 'live data' : 'simulated data'})._`,
  ].join('\n');
}
