/**
 * CultureRisk — interactive layer over a finished coverage report.
 *
 *   • Category toggle   distinctive picks ↔ Qloo's unfiltered mass-market list
 *   • Evidence drawer   click a partner: affinity vs popularity, which comp's
 *                       fans drive it (feature.explainability), Qloo tags and ID
 *   • Deal sheet        pin partners, then copy or download them as CSV
 *
 * Everything shown is already in the session's Qloo evidence; nothing is generated.
 */

import { $, esc, pct, barWidth, DOMAIN_LABELS } from './dom.js';
import { partnerCard, frame, bars, wireImageFallbacks } from './render.js';

const SHORT = { 'urn:entity:brand': 'Brand', 'urn:entity:artist': 'Music', 'urn:entity:destination': 'Location', 'urn:entity:tv_show': 'TV', 'urn:entity:podcast': 'Podcast' };

export function createExplorer(root, result) {
  const { memo, evidence } = result;
  const pinned = new Map(); // entityId → entity row
  const byId = new Map();

  // Index every entity Qloo returned for the partner categories.
  for (const [urn, d] of Object.entries(evidence.domains)) {
    for (const e of [...(d.entities || []), ...(d.probe || []), ...(d.mainstream || [])]) {
      if (!byId.has(e.entityId)) byId.set(e.entityId, { ...e, domain: urn });
    }
  }
  memo.recommendations.forEach((r) => byId.set(r.entityId, { ...byId.get(r.entityId), ...r }));

  const liveRun = (evidence.dataProvenance?.live ?? 0) > 0;
  const card = (e) => partnerCard(
    {
      ...e,
      grounded: true,
      qlooVerified: e.qlooVerified ?? (liveRun && !String(e.entityId).startsWith('mock:')),
      action: e.action || '',
      evidence: e.evidence || `Audience affinity ${pct(e.affinity)}, popularity percentile ${pct(e.popularity)}.`,
    },
    { pinned: pinned.has(e.entityId) },
  );

  function renderGrid(urn, view) {
    const d = evidence.domains[urn];
    const list = view === 'mass'
      ? (d.mainstream || []).map((e) => byId.get(e.entityId) || { ...e, domain: urn })
      : memo.recommendations.filter((r) => r.domain === urn).concat((d.entities || []).filter((e) => !memo.recommendations.some((r) => r.entityId === e.entityId)).slice(0, 3).map((e) => byId.get(e.entityId)));
    const grid = root.querySelector(`[data-grid="${CSS.escape(urn)}"]`);
    grid.innerHTML = list.slice(0, 6).map(card).join('') || '<p class="hint">Qloo returned nothing here.</p>';
    grid.classList.toggle('mass', view === 'mass');
    wireImageFallbacks(grid);
  }

  function refreshPins() {
    root.querySelectorAll('[data-act="pin"]').forEach((b) => {
      const on = pinned.has(b.dataset.entity);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? '✓ On deal sheet' : '+ Deal sheet';
    });
    const bar = $('#dealBar');
    bar.hidden = pinned.size === 0;
    $('#dealCount').textContent = `${pinned.size} on the deal sheet`;
    $('#dealList').innerHTML = [...pinned.values()].map((e) => `<li><strong>${esc(e.name)}</strong> <small>${esc(DOMAIN_LABELS[e.domain] || '')} · affinity ${pct(e.affinity)}</small></li>`).join('');
  }

  function openDrawer(id) {
    const e = byId.get(id);
    if (!e) return;
    const drivers = e.explainability
      ? evidence.comps.map((c) => ({ name: c.name, share: e.explainability[c.entityId] ?? 0 }))
      : null;
    const total = drivers ? drivers.reduce((s, x) => s + x.share, 0) || 1 : 1;
    $('#drawerBody').innerHTML = `
      <div class="drawer-media">${frame(e, SHORT[e.domain] || '')}</div>
      <div class="drawer-kicker">${esc(DOMAIN_LABELS[e.domain] || '')}</div>
      <h3 class="drawer-title">${esc(e.name)}</h3>
      ${bars(e.affinity, e.popularity)}
      <p class="drawer-note">${typeof e.popularity === 'number' && e.popularity >= 0.97
        ? 'A household name: it tops most audiences\' lists, so it says little about this one.'
        : 'Specific to this audience: strong affinity without household-name popularity.'}</p>
      ${drivers ? `<h4 class="sub">Which comp's fans drive this</h4>${drivers.map((x) => `<div class="cross-row"><span>${esc(x.name)}</span><div class="track"><div class="fill aff" style="width:${barWidth(x.share / total)}%"></div></div><span class="v">${pct(x.share / total)}</span></div>`).join('')}<p class="source">Qloo feature.explainability</p>` : ''}
      ${e.tags?.length ? `<h4 class="sub">Qloo tags</h4><p>${esc(e.tags.join(' · '))}</p>` : ''}
      ${e.action ? `<h4 class="sub">Recommended move</h4><p>${esc(e.action)}</p>` : ''}
      <p class="p-id">Qloo ID ${esc(e.entityId)}</p>
      <button type="button" class="btn btn-ink" data-act="pin" data-entity="${esc(e.entityId)}">${pinned.has(e.entityId) ? '✓ On deal sheet' : '+ Add to deal sheet'}</button>`;
    wireImageFallbacks($('#drawerBody'));
    const dlg = $('#drawer');
    if (!dlg.open) dlg.showModal();
  }

  function togglePin(id) {
    const e = byId.get(id);
    if (!e) return;
    if (pinned.has(id)) pinned.delete(id); else pinned.set(id, e);
    refreshPins();
  }

  function onClick(ev) {
    const act = ev.target.closest('[data-act]');
    if (act?.dataset.act === 'pin') { ev.stopPropagation(); togglePin(act.dataset.entity); return; }
    if (act?.dataset.act === 'view') {
      act.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === act));
      renderGrid(act.dataset.domain, act.dataset.view);
      refreshPins();
      return;
    }
    const partner = ev.target.closest('.partner[data-entity]');
    if (partner && root.contains(partner) && !act) openDrawer(partner.dataset.entity);
  }

  function onKey(ev) {
    const partner = ev.target.closest?.('.partner[data-entity]');
    if (partner && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openDrawer(partner.dataset.entity); }
  }

  function dealRows() {
    return [...pinned.values()].map((e) => ({
      category: DOMAIN_LABELS[e.domain] || e.domain, name: e.name, affinity: e.affinity, popularity: e.popularity, qloo_id: e.entityId,
    }));
  }

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  $('#drawer').addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act="pin"]');
    if (act) { togglePin(act.dataset.entity); openDrawer(act.dataset.entity); }
    if (ev.target === $('#drawer') || ev.target.closest('[data-act="close"]')) $('#drawer').close();
  });
  refreshPins();

  return {
    dealRows,
    destroy() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
      pinned.clear();
      refreshPins();
    },
  };
}

export function dealSheetCsv(rows, title) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [`# Deal sheet: ${title} (source: Qloo Taste AI)`, 'category,name,audience_affinity,popularity_percentile,qloo_id',
    ...rows.map((r) => [r.category, r.name, r.affinity, r.popularity, r.qloo_id].map(cell).join(','))].join('\n');
}
