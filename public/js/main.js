/**
 * CultureRisk AI — cockpit controller (entry module).
 */

import { $, $$, esc } from './dom.js';
import { PRESETS } from './presets.js';
import { getCapabilities, getBaseline, quickScan } from './api.js';
import { AgentSession } from './session.js';
import { appendTraceEvents, renderScorecard, renderMemo, renderEvidence, renderQuickScan, memoToMarkdown } from './render.js';
import { computeBlindSpots, renderBlindSpots } from './blindspot.js';

const state = { session: null, result: null, brief: null, baseline: null, caps: null, activePreset: null };

/* -------------------------------------------------------------------------- */
/* Status pills                                                                */
/* -------------------------------------------------------------------------- */

function setPill(el, tone, text) {
  el.querySelector('.dot').className = `dot ${tone}`;
  el.querySelector('span:last-child').textContent = text;
}

async function loadCapabilities() {
  try {
    const caps = await getCapabilities();
    state.caps = caps;
    setPill($('#enginePill'), caps.engine === 'claude' ? 'ok' : 'warn', caps.engine === 'claude' ? `Agent: ${caps.model}` : 'Agent: scripted planner');
    setPill($('#qlooPill'), caps.qlooMode === 'live' ? 'ok' : 'warn', caps.qlooMode === 'live' ? 'Qloo: live' : 'Qloo: simulated');
  } catch {
    setPill($('#enginePill'), 'bad', 'API offline');
    setPill($('#qlooPill'), 'bad', 'Qloo: unknown');
  }
}

/* -------------------------------------------------------------------------- */
/* Presets & brief                                                             */
/* -------------------------------------------------------------------------- */

function renderPresets() {
  $('#presets').innerHTML = PRESETS.map((p) => `
    <button type="button" class="preset" role="listitem" data-id="${esc(p.id)}">
      <span class="p-name">${esc(p.name)}</span>
      <span class="p-meta">${esc(p.anchors.join(' × '))}</span>
    </button>`).join('');

  $('#presets').addEventListener('click', (e) => {
    const btn = e.target.closest('.preset');
    if (!btn) return;
    const p = PRESETS.find((x) => x.id === btn.dataset.id);
    $('#title').value = p.title;
    $('#anchors').value = p.anchors.join(', ');
    $('#budget').value = p.budgetMillions;
    $('#script').value = p.script;
    $$('#domainChecks input').forEach((c) => { c.checked = p.domains.includes(c.value); });
    $$('.preset').forEach((b) => b.classList.toggle('is-active', b === btn));
    $('#runBtn').focus();
  });
}

function readBrief() {
  return {
    title: $('#title').value.trim(),
    anchors: $('#anchors').value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    budgetMillions: Number($('#budget').value) || null,
    domains: $$('#domainChecks input:checked').map((c) => c.value),
    script: $('#script').value.trim(),
  };
}

function formError(message) {
  const el = $('#formError');
  el.hidden = !message;
  el.textContent = message || '';
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

function enableResultTabs(enabled) {
  ['#tab-memo', '#tab-blind', '#tab-evidence'].forEach((s) => { $(s).disabled = !enabled; });
}

/* -------------------------------------------------------------------------- */
/* Agent run                                                                   */
/* -------------------------------------------------------------------------- */

function setRunning(running) {
  $('#runBtn').disabled = running;
  $('#runBtn').textContent = running ? 'Agent working…' : 'Run greenlight analysis';
  $('#stopBtn').hidden = !running;
  $('#progress').hidden = !running;
  $$('#briefForm input, #briefForm textarea, .preset').forEach((el) => { el.disabled = running; });
}

function setProgress(step, total) {
  const max = total || state.caps?.maxSteps || 8;
  $('#progressBar').style.width = `${Math.min(96, (step / max) * 100)}%`;
}

async function runAnalysis(event) {
  event.preventDefault();
  const brief = readBrief();
  if (brief.anchors.length === 0) return formError('Add at least one comparable title.');
  if (brief.domains.length === 0) return formError('Select at least one taste domain.');
  formError('');

  state.brief = { ...brief, title: brief.title || 'Untitled Project' };
  state.result = null;
  state.baseline = null;
  $('#trace').innerHTML = '';
  $('#traceEmpty').hidden = true;
  $('#reportTools').hidden = true;
  enableResultTabs(false);
  selectTab('tab-trace');
  setRunning(true);
  setProgress(0);

  const session = new AgentSession(state.brief, {
    onStep: (r) => {
      appendTraceEvents($('#trace'), r.step, r.events || []);
      setProgress(r.step, r.totalSteps);
    },
    onRetry: (err, n) => appendTraceEvents($('#trace'), '↻', [{ type: 'narration', text: `${err.message} (retry ${n})` }]),
  });
  state.session = session;

  // The LLM-only baseline runs in parallel and never blocks the agent.
  const baselinePromise = getBaseline(state.brief, session.controller.signal).catch(() => ({ available: false }));

  try {
    const result = await session.run();
    state.result = result;
    state.baseline = await baselinePromise;
    showResult();
  } catch (err) {
    if (!err.cancelled) {
      appendTraceEvents($('#trace'), '!', [{ type: 'narration', text: `Analysis failed: ${err.message}` }]);
    } else {
      appendTraceEvents($('#trace'), '■', [{ type: 'narration', text: 'Stopped by user.' }]);
    }
  } finally {
    setRunning(false);
    state.session = null;
  }
}

function showResult() {
  const r = state.result;
  $('#scorecard').innerHTML = renderScorecard(r.scorecard, r.memo);
  $('#memo').innerHTML = renderMemo(r.memo, r.memoAuthor, r.grounding);
  $('#evidence').innerHTML = renderEvidence(r.evidence);

  if (state.baseline?.available) {
    const report = computeBlindSpots(state.baseline.guesses, r.evidence.domains);
    $('#blind').innerHTML = renderBlindSpots(report, state.baseline.model);
  } else {
    $('#blind').innerHTML = `
      <div class="empty"><h3>LLM-only baseline unavailable</h3>
      <p>This comparison needs the Claude engine (set <code>ANTHROPIC_API_KEY</code>). It asks the same model to guess this audience's tastes with no Qloo access, then shows what only Qloo surfaced.</p></div>`;
  }

  enableResultTabs(true);
  $('#reportTools').hidden = false;
  selectTab('tab-memo');
  $('#reportTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

async function copyMarkdown() {
  const md = memoToMarkdown(state.brief, state.result);
  try {
    await navigator.clipboard.writeText(md);
    flash($('#copyMd'), 'Copied ✓');
  } catch {
    flash($('#copyMd'), 'Copy failed');
  }
}

function downloadJson() {
  const blob = new Blob([JSON.stringify({ brief: state.brief, ...state.result, baseline: state.baseline }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `culturerisk-${(state.brief.title || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function flash(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1600);
}

/* -------------------------------------------------------------------------- */
/* Quick scan & mode switch                                                    */
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

function setMode(mode) {
  $$('.mode').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('#workspace').hidden = mode !== 'agent';
  $('.hero').hidden = mode !== 'agent';
  $('#scanView').hidden = mode !== 'scan';
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

renderPresets();
loadCapabilities();
$('#briefForm').addEventListener('submit', runAnalysis);
$('#stopBtn').addEventListener('click', () => state.session?.stop());
$('#copyMd').addEventListener('click', copyMarkdown);
$('#downloadJson').addEventListener('click', downloadJson);
$('#scanForm').addEventListener('submit', runScan);
$$('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$$('.tab').forEach((t) => t.addEventListener('click', () => !t.disabled && selectTab(t.id)));
