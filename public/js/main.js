/**
 * CultureRisk AI — cockpit controller (entry module).
 */

import { $, $$, esc } from './dom.js';
import { PRESETS } from './presets.js';
import { getCapabilities, quickScan } from './api.js';
import { AgentSession } from './session.js';
import { appendTraceEvents, renderMemo, renderAudience, renderEvidence, renderQuickScan, memoToMarkdown } from './render.js';

const state = { session: null, result: null, brief: null, caps: null };

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

function setPill(el, tone, text) {
  el.querySelector('.dot').className = `dot ${tone}`;
  el.querySelector('span:last-child').textContent = text;
}

async function loadCapabilities() {
  try {
    state.caps = await getCapabilities();
    const live = state.caps.qlooMode === 'live';
    setPill($('#qlooPill'), live ? 'ok' : 'warn', live ? 'Qloo: live data' : 'Qloo: simulated data');
  } catch {
    setPill($('#qlooPill'), 'bad', 'API offline');
  }
}

/* -------------------------------------------------------------------------- */
/* Presets & brief                                                             */
/* -------------------------------------------------------------------------- */

function applyPreset(p, btn) {
  $('#title').value = p.title;
  $('#anchors').value = p.anchors.join(', ');
  $('#budget').value = p.budgetMillions;
  $('#script').value = p.script;
  $$('#domainChecks input').forEach((c) => { c.checked = p.domains.includes(c.value); });
  $$('.preset').forEach((b) => b.classList.toggle('is-active', b === btn));
}

function renderPresets() {
  $('#presets').innerHTML = PRESETS.map((p) => `
    <button type="button" class="preset" role="listitem" data-id="${esc(p.id)}">
      <span class="p-name">${esc(p.name)}</span>
      <span class="p-meta">${esc(p.anchors.join(' × '))}</span>
    </button>`).join('');

  $('#presets').addEventListener('click', (e) => {
    const btn = e.target.closest('.preset');
    if (!btn) return;
    applyPreset(PRESETS.find((x) => x.id === btn.dataset.id), btn);
    $('#runBtn').focus();
  });
}

function readBrief() {
  return {
    title: $('#title').value.trim() || 'Untitled Project',
    anchors: $('#anchors').value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    budgetMillions: Number($('#budget').value) || null,
    domains: $$('#domainChecks input:checked').map((c) => c.value),
    script: $('#script').value.trim(),
  };
}

function formError(message) {
  $('#formError').hidden = !message;
  $('#formError').textContent = message || '';
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                        */
/* -------------------------------------------------------------------------- */

function selectTab(id) {
  $$('.tab').forEach((t) => {
    const on = t.id === id;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
  });
}

const enableResultTabs = (enabled) => ['#tab-memo', '#tab-audience', '#tab-evidence'].forEach((s) => { $(s).disabled = !enabled; });

/* -------------------------------------------------------------------------- */
/* Agent run                                                                   */
/* -------------------------------------------------------------------------- */

function setRunning(running) {
  $('#runBtn').disabled = running;
  $('#runBtn').textContent = running ? 'Researching…' : 'Run greenlight analysis';
  $('#stopBtn').hidden = !running;
  $('#progress').hidden = !running;
  $$('#briefForm input, #briefForm textarea, .preset').forEach((el) => { el.disabled = running; });
}

function setProgress(done, total, calls) {
  $('#progressBar').style.width = `${Math.min(97, (done / Math.max(total, 1)) * 100)}%`;
  $('#progressText').textContent = `Step ${done} of ~${total} · ${calls} Qloo calls`;
}

async function runAnalysis(event) {
  event.preventDefault();
  const brief = readBrief();
  if (brief.anchors.length === 0) return formError('Add at least one comparable title.');
  if (brief.domains.length === 0) return formError('Select at least one partner domain.');
  formError('');

  state.brief = brief;
  state.result = null;
  $('#trace').innerHTML = '';
  $('#traceEmpty').hidden = true;
  $('#reportTools').hidden = true;
  enableResultTabs(false);
  selectTab('tab-trace');
  setRunning(true);
  setProgress(0, 10, 0);
  if (window.innerWidth < 1020) $('#reportTitle').scrollIntoView({ behavior: 'smooth' });

  let calls = 0;
  const session = new AgentSession(brief, {
    onStep: (r) => {
      appendTraceEvents($('#trace'), r.step, r.events || []);
      calls += (r.events || []).filter((e) => e.type === 'calls').reduce((s, e) => s + e.calls.length, 0);
      if (r.progress) setProgress(r.progress.done, r.progress.total, calls);
    },
    onRetry: (err, n) => appendTraceEvents($('#trace'), '↻', [{ type: 'decision', text: `${err.message} Retrying (${n}).` }]),
  });
  state.session = session;

  try {
    state.result = await session.run();
    showResult();
  } catch (err) {
    appendTraceEvents($('#trace'), '!', [{ type: 'decision', text: err.cancelled ? 'Stopped by user.' : `Analysis failed: ${err.message}` }]);
  } finally {
    setRunning(false);
    state.session = null;
  }
}

function showResult() {
  const r = state.result;
  $('#memo').innerHTML = renderMemo(r, state.brief);
  $('#audience').innerHTML = renderAudience(r.evidence);
  $('#evidence').innerHTML = renderEvidence(r.evidence);
  enableResultTabs(true);
  $('#reportTools').hidden = false;
  selectTab('tab-memo');
  $('#reportTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

function flash(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1600);
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(memoToMarkdown(state.brief, state.result));
    flash($('#copyMd'), 'Copied ✓');
  } catch {
    flash($('#copyMd'), 'Copy failed');
  }
}

function downloadJson() {
  const blob = new Blob([JSON.stringify({ brief: state.brief, ...state.result }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `culturerisk-${state.brief.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* -------------------------------------------------------------------------- */
/* Quick scan, MCP page & mode switch                                          */
/* -------------------------------------------------------------------------- */

async function runScan(event) {
  event.preventDefault();
  const anchor = $('#scanAnchor').value.trim();
  if (!anchor) return;
  $('#scanBtn').disabled = true;
  $('#scanResults').innerHTML = '<div class="skeleton"></div>';
  try {
    $('#scanResults').innerHTML = renderQuickScan(await quickScan(anchor, $('#scanDomain').value));
  } catch (err) {
    $('#scanResults').innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  } finally {
    $('#scanBtn').disabled = false;
  }
}

function fillMcpUrls() {
  const url = `${location.origin}/api/mcp`;
  $('#mcpUrl').textContent = url;
  $('#mcpCmd').textContent = `claude mcp add --transport http culturerisk ${url}`;
  $('#mcpCurl').textContent = `curl -s ${url} -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;
}

function setMode(mode) {
  $$('.mode').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('#hero').hidden = mode !== 'agent';
  $('#workspace').hidden = mode !== 'agent';
  $('#scanView').hidden = mode !== 'scan';
  $('#mcpView').hidden = mode !== 'mcp';
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

renderPresets();
applyPreset(PRESETS[0], $('.preset'));
fillMcpUrls();
loadCapabilities();
$('#briefForm').addEventListener('submit', runAnalysis);
$('#stopBtn').addEventListener('click', () => state.session?.stop());
$('#copyMd').addEventListener('click', copyMarkdown);
$('#downloadJson').addEventListener('click', downloadJson);
$('#scanForm').addEventListener('submit', runScan);
$$('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$$('.tab').forEach((t) => t.addEventListener('click', () => !t.disabled && selectTab(t.id)));
