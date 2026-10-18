/**
 * CultureRisk — comparable-title picker with live Qloo search.
 *
 * Typing in the comps field queries Qloo /search (via /api/search) and shows
 * matching films with their Qloo posters and years, so users pick real Qloo
 * entities before the agent runs. Chosen comps render as poster chips.
 * The text field stays the source of truth, so free typing still works.
 */

import { esc } from './dom.js';
import { searchTitles } from './api.js';
import { frame, wireImageFallbacks } from './render.js';

const MAX_COMPS = 3;

export function createPicker({ input, list, chips }) {
  const known = new Map(); // lower-cased name → {name, image, year, entityId}
  let timer = null;
  let controller = null;
  let active = -1;
  let results = [];

  const names = () => input.value.split(',').map((s) => s.trim()).filter(Boolean);
  const current = () => input.value.slice(input.value.lastIndexOf(',') + 1).trim();

  function renderChips() {
    chips.innerHTML = names().slice(0, MAX_COMPS).map((n) => {
      const hit = known.get(n.toLowerCase()) || { name: n, entityId: n };
      return `<div class="chip-comp">${frame(hit, 'Comp')}<span>${esc(hit.name)}${hit.year ? ` <small>${esc(hit.year)}</small>` : ''}</span>
        <button type="button" aria-label="Remove ${esc(hit.name)}" data-remove="${esc(n)}">×</button></div>`;
    }).join('');
    wireImageFallbacks(chips);
  }

  function close() {
    list.hidden = true;
    list.innerHTML = '';
    active = -1;
    input.setAttribute('aria-expanded', 'false');
  }

  function choose(i) {
    const hit = results[i];
    if (!hit) return;
    known.set(hit.name.toLowerCase(), hit);
    const kept = names();
    kept.pop();
    input.value = [...kept, hit.name].slice(0, MAX_COMPS).join(', ') + (kept.length + 1 < MAX_COMPS ? ', ' : '');
    close();
    renderChips();
    input.focus();
  }

  function renderList() {
    if (!results.length) { close(); return; }
    list.innerHTML = results.map((r, i) => `<li role="option" id="pick-${i}" aria-selected="${i === active}" data-i="${i}" class="${i === active ? 'is-active' : ''}">
      <div class="pick-thumb">${frame(r, 'Film')}</div><div><strong>${esc(r.name)}</strong>${r.year ? ` <small>${esc(r.year)}</small>` : ''}${r.disambiguation && String(r.disambiguation) !== String(r.year) ? `<br><small>${esc(r.disambiguation)}</small>` : ''}</div></li>`).join('');
    wireImageFallbacks(list);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  async function lookup(q) {
    controller?.abort();
    controller = new AbortController();
    try {
      const data = await searchTitles(q, controller.signal);
      if (current() !== q) return;
      results = data.results || [];
      active = -1;
      renderList();
    } catch {
      /* search is a convenience; typing still works */
    }
  }

  input.addEventListener('input', () => {
    renderChips();
    const q = current();
    clearTimeout(timer);
    if (q.length < 2 || names().length > MAX_COMPS) { close(); return; }
    timer = setTimeout(() => lookup(q), 220);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); renderList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); renderList(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); choose(Number(li.dataset.i)); }
  });
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    input.value = names().filter((n) => n !== b.dataset.remove).join(', ');
    renderChips();
  });

  return {
    refresh: renderChips,
    remember(entity) { if (entity?.name) known.set(entity.name.toLowerCase(), entity); },
  };
}
