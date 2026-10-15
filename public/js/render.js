/**
 * CultureRisk AI — view rendering. Pure functions from data to HTML strings;
 * every dynamic value is escaped.
 */

import { esc, pct, barWidth, DOMAIN_LABELS, TOOL_ENDPOINTS, verdictClass } from './dom.js';

/* -------------------------------------------------------------------------- */
/* Agent trace                                                                 */
/* -------------------------------------------------------------------------- */

function describeInput(tool, input = {}) {
  switch (tool) {
    case 'resolve_entities': return `${(input.queries || []).join(', ')} · ${String(input.entity_type || '').split(':').pop()}`;
    case 'find_taste_tags': return `"${input.query}"`;
    case 'get_audience_affinities':
      return `${DOMAIN_LABELS[input.target_domain] || input.target_domain} ← ${(input.entity_ids || []).length} entity + ${(input.tag_ids || []).length} tag signal(s)`;
    case 'stress_test_comps': return `${(input.labels || input.entity_ids || []).join(' vs ')} in ${DOMAIN_LABELS[input.target_domain] || input.target_domain}`;
    default: return '';
  }
}

/** Append one step's events to the trace list. */
export function appendTraceEvents(list, step, events) {
  const html = events.map((ev) => {
    if (ev.type === 'narration') {
      return `<li class="tr tr-narr"><span class="tr-step">S${step}</span><p>${esc(ev.text)}</p></li>`;
    }
    if (ev.type === 'thinking') {
      return `<li class="tr tr-think"><span class="tr-step">S${step}</span><details><summary>Agent reasoning</summary><p>${esc(ev.text)}</p></details></li>`;
    }
    if (ev.type === 'tool_call') {
      return `<li class="tr tr-call" data-call="${esc(ev.id)}"><span class="tr-step">S${step}</span>
        <div><span class="chip chip-qloo">${esc(TOOL_ENDPOINTS[ev.tool] || ev.tool)}</span>
        <code>${esc(ev.tool)}</code><span class="tr-args">${esc(describeInput(ev.tool, ev.input))}</span>
        <span class="tr-res pending">querying Qloo…</span></div></li>`;
    }
    return '';
  }).join('');
  list.insertAdjacentHTML('beforeend', html);

  // Attach results to their calls.
  events.filter((ev) => ev.type === 'tool_result').forEach((ev) => {
    const slot = list.querySelector(`[data-call="${CSS.escape(ev.id)}"] .tr-res`);
    if (slot) {
      slot.className = `tr-res ${ev.ok ? 'ok' : 'err'}`;
      slot.textContent = ev.summary;
    }
  });
  list.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* -------------------------------------------------------------------------- */
/* Scorecard                                                                   */
/* -------------------------------------------------------------------------- */

export function renderScorecard(card, memo) {
  const tiles = [
    { label: 'Culture risk', value: card.cultureRiskScore ?? '—', sub: '0 safest · 100 riskiest' },
    { label: 'Alignment', value: card.alignment ?? '—', sub: 'Mean Qloo affinity /100' },
    { label: 'Comp coherence', value: card.coherence === null ? 'n/a' : `${card.coherence}%`, sub: 'Do the comps share an audience?' },
  ];
  const domainRows = Object.entries(card.profiles || {}).map(([urn, p]) => `
    <div class="drow">
      <span class="dlabel">${esc(DOMAIN_LABELS[urn] || urn)}</span>
      <div class="bar"><span style="width:${barWidth((p.alignment ?? 0) / 100)}%"></span></div>
      <span class="dval">${esc(p.alignment ?? '—')}</span>
      <span class="dsig">σ ${esc(p.dispersion ?? '—')}</span>
    </div>`).join('');

  const agrees = memo.verdict === card.verdict;
  return `
    <div class="verdicts">
      <div class="verdict">
        <div class="k-label">Agent verdict</div>
        <div class="v-text ${verdictClass(memo.verdict)}">${esc(memo.verdict)}</div>
        <div class="k-sub">${esc(memo.confidence)} confidence · reasoned from the Qloo evidence</div>
      </div>
      <div class="verdict">
        <div class="k-label">Risk-model verdict</div>
        <div class="v-text ${verdictClass(card.verdict)}">${esc(card.verdict)}</div>
        <div class="k-sub">Deterministic, computed only from Qloo data · ${agrees ? 'agrees with the agent' : 'differs from the agent: read the risk register'}</div>
      </div>
    </div>
    <div class="kpis kpis-3">${tiles.map((t) => `
      <div class="kpi"><div class="k-label">${esc(t.label)}</div>
      <div class="k-value ${esc(t.cls || '')}">${esc(t.value)}</div>
      <div class="k-sub">${esc(t.sub)}</div></div>`).join('')}
    </div>
    <div class="domains">${domainRows}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Memo                                                                        */
/* -------------------------------------------------------------------------- */

export function renderMemo(memo, author, grounding) {
  const recs = (memo.recommendations || []).map((r) => `
    <article class="rec">
      <div class="rec-head">
        <span class="chip">${esc(DOMAIN_LABELS[r.domain] || r.domain)}</span>
        ${r.grounded
          ? '<span class="chip chip-ok" title="This entity ID was returned by Qloo in this session">✓ Qloo-verified</span>'
          : '<span class="chip chip-warn" title="This ID was not returned by Qloo in this session">unverified</span>'}
      </div>
      <h4>${esc(r.name)}</h4>
      <p class="rec-action">${esc(r.action)}</p>
      <p class="rec-evidence">${esc(r.evidence)}</p>
      <code class="rec-id">${esc(r.qloo_entity_id)}</code>
    </article>`).join('');

  const risks = (memo.risks || []).map((r) => `
    <tr><td><span class="sev sev-${esc(r.severity)}">${esc(r.severity)}</span></td><td>${esc(r.risk)}</td><td>${esc(r.mitigation)}</td></tr>`).join('');

  return `
    <div class="memo-meta">
      <span>Written by <strong>${author === 'claude' ? 'Claude agent' : 'Scripted planner'}</strong></span>
      <span>Grounding: <strong>${esc(grounding.grounded)}/${esc(grounding.total)}</strong> recommendations cite Qloo IDs returned in this session</span>
    </div>
    <section class="memo-sec"><h3>Executive summary</h3><p>${esc(memo.executive_summary)}</p></section>
    <section class="memo-sec"><h3>Audience thesis</h3><p>${esc(memo.audience_thesis)}</p></section>
    <section class="memo-sec"><h3>Comp stress test</h3><p>${esc(memo.comp_coherence_finding)}</p></section>
    <section class="memo-sec"><h3>Recommendations</h3><div class="recs">${recs}</div></section>
    <section class="memo-sec"><h3>Risk register</h3>
      <div class="table-wrap"><table class="risks"><thead><tr><th>Severity</th><th>Risk</th><th>Mitigation</th></tr></thead><tbody>${risks}</tbody></table></div>
    </section>
    <section class="memo-sec"><h3>Next steps</h3><ol>${(memo.next_steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>`;
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

export function renderEvidence(evidence) {
  const anchors = (evidence.anchors || []).map((a) => `
    <li><strong>${esc(a.name)}</strong>${a.year ? ` (${esc(a.year)})` : ''} <code>${esc(a.entityId)}</code> <span class="prov prov-${esc(a.provenance)}">${esc(a.provenance)}</span></li>`).join('');

  const coh = evidence.coherence;
  const cohHtml = coh ? `
    <h4>Comp taste graphs: ${esc(DOMAIN_LABELS[coh.target] || coh.target)} (coherence ${Math.round(coh.coherence * 100)}%)</h4>
    <div class="coh-grid">${coh.perAnchor.map((p) => `
      <div class="coh-col"><div class="coh-title">${esc(p.anchor)}</div><ol>${p.top.map((n) => {
        const shared = coh.perAnchor.filter((o) => o !== p && o.top.includes(n)).length > 0;
        return `<li class="${shared ? 'shared' : ''}">${esc(n)}</li>`;
      }).join('')}</ol></div>`).join('')}
    </div><p class="hint">Highlighted entities appear in more than one comp's top results.</p>` : '';

  const calls = (evidence.calls || []).map((c) => `
    <tr><td><code>${esc(c.endpoint)}</code></td>
    <td class="sig">${esc(Object.entries(c.signals || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`).filter((s) => !s.endsWith('=')).join('  '))}</td>
    <td><span class="prov prov-${esc(c.provenance)}">${esc(c.provenance)}</span>${c.failure ? ` <small>${esc(c.failure)}</small>` : ''}</td>
    <td>${esc(c.count)}</td><td>${esc(c.ms)} ms</td></tr>`).join('');

  return `
    <h4>Resolved anchors</h4><ul class="anchors">${anchors || '<li>None</li>'}</ul>
    ${cohHtml}
    <h4>Qloo call audit (${(evidence.calls || []).length} calls)</h4>
    <div class="table-wrap"><table class="calls"><thead><tr><th>Endpoint</th><th>Signals</th><th>Provenance</th><th>Results</th><th>Latency</th></tr></thead><tbody>${calls}</tbody></table></div>`;
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
    <div class="kpis kpis-4">
      <div class="kpi"><div class="k-label">Verdict</div><div class="k-value ${verdictClass(s.verdict)}">${esc(s.verdict)}</div></div>
      <div class="kpi"><div class="k-label">Culture risk</div><div class="k-value">${esc(s.cultureRiskScore ?? '—')}</div></div>
      <div class="kpi"><div class="k-label">Alignment</div><div class="k-value">${esc(s.alignmentIndex ?? '—')}</div></div>
      <div class="kpi"><div class="k-label">Dispersion σ</div><div class="k-value">${esc(s.dispersion ?? '—')}</div></div>
    </div>
    <div class="cards">${cards}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

export function memoToMarkdown(brief, result) {
  const { memo, scorecard: card } = result;
  const lines = [
    `# Greenlight Memo: ${brief.title}`,
    '',
    `**Agent verdict:** ${memo.verdict} (${memo.confidence} confidence) · **Qloo model verdict:** ${card.verdict}`,
    `**Culture risk:** ${card.cultureRiskScore}/100 · **Alignment:** ${card.alignment}/100 · **Comp coherence:** ${card.coherence ?? 'n/a'}${card.coherence !== null ? '%' : ''}`,
    `**Comparables:** ${brief.anchors.join(', ')}`,
    '',
    '## Executive summary', memo.executive_summary, '',
    '## Audience thesis', memo.audience_thesis, '',
    '## Comp stress test', memo.comp_coherence_finding, '',
    '## Recommendations',
    ...(memo.recommendations || []).map((r) => `- **${r.name}** (${DOMAIN_LABELS[r.domain] || r.domain}, \`${r.qloo_entity_id}\`${r.grounded ? ', Qloo-verified' : ''}): ${r.action} _${r.evidence}_`),
    '',
    '## Risks',
    ...(memo.risks || []).map((r) => `- **[${r.severity}]** ${r.risk} → ${r.mitigation}`),
    '',
    '## Next steps',
    ...(memo.next_steps || []).map((s, i) => `${i + 1}. ${s}`),
    '',
    `_Generated by CultureRisk AI from ${(result.evidence.calls || []).length} Qloo API calls (${result.evidence.liveData ? 'live data' : 'simulated data'})._`,
  ];
  return lines.join('\n');
}
