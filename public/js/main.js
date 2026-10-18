/**
 * CultureRisk — page controller (entry module).
 */

import { $, $$, esc } from './dom.js';
import { PRESETS } from './presets.js';
import { getCapabilities, quickScan } from './api.js';
import { AgentSession } from './session.js';
import { notesHtml, renderCoverage, renderQuickScan, memoToMarkdown, wireImageFallbacks } from './render.js';

const state = { session: null, result: null, brief: null, allNotes: '' };

/* -------------------------------------------------------------------------- */
/* Masthead                                                                    */
/* -------------------------------------------------------------------------- */

function masthead() {
  $('#mastDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

async function loadCapabilities() {
  const el = $('#dataStatus');
  try {
    const caps = await getCapabilities();
    const live = caps.qlooMode === 'live';
    el.textContent = live ? 'Qloo: live key configured' : 'Qloo data: simulated';
    el.className = `data-status ${live ? 'live' : 'sim'}`;
  } catch {
    el.textContent = 'Qloo data: offline';
  }
}

/* -------------------------------------------------------------------------- */
/* Slate (presets) & brief                                                     */
/* -------------------------------------------------------------------------- */

function applyPreset(p) {
  $('#title').value = p.title;
  $('#anchors').value = p.anchors.join(', ');
  $('#budget').value = p.budgetMillions;
  $('#script').value = p.script;
  $$('#domainChecks input').forEach((c) => { c.checked = p.domains.includes(c.value); });
  $$('.slate-item').forEach((b) => b.classList.toggle('is-active', b.dataset.id === p.id));
}

function renderSlate() {
  $('#presets').innerHTML = PRESETS.map((p) => `
    <button type="button" class="slate-item" data-id="${esc(p.id)}">
      <span class="s-genre">${esc(p.name)}</span>
      <span class="s-title">${esc(p.title)}</span>
      <span class="s-comps">${esc(p.anchors.join(' × '))}</span>
    </button>`).join('');
  $('#presets').addEventListener('click', (e) => {
    const btn = e.target.closest('.slate-item');
    if (btn) applyPreset(PRESETS.find((x) => x.id === btn.dataset.id));
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
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

function setRunning(running) {
  $('#runBtn').disabled = running;
  $('#runBtn').textContent = running ? 'Researching…' : 'Request coverage';
  $('#stopBtn').hidden = !running;
  $$('#briefForm input, #briefForm textarea, .slate-item').forEach((el) => { el.disabled = running; });
}

function setProgress(done, total, calls) {
  $('#progressBar').style.width = `${Math.min(97, (done / Math.max(total, 1)) * 100)}%`;
  $('#deskStatus').textContent = `Step ${done} of ~${total} · ${calls} Qloo calls`;
}

function addNotes(step, events) {
  const html = notesHtml(step, events);
  state.allNotes += html;
  $('#notes').insertAdjacentHTML('beforeend', html);
  $('#notes').lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function runAnalysis(event) {
  event.preventDefault();
  const brief = readBrief();
  if (brief.anchors.length === 0) return formError('Add at least one comparable title.');
  if (brief.domains.length === 0) return formError('Pick at least one partner category.');
  formError('');

  state.brief = brief;
  state.result = null;
  state.allNotes = '';
  $('#notes').innerHTML = '';
  $('#coverage').hidden = true;
  $('#desk').hidden = false;
  setRunning(true);
  setProgress(0, 10, 0);
  $('#desk').scrollIntoView({ behavior: 'smooth', block: 'start' });

  let calls = 0;
  const session = new AgentSession(brief, {
    onStep: (r) => {
      addNotes(r.step, r.events || []);
      calls += (r.events || []).filter((e) => e.type === 'calls').reduce((s, e) => s + e.calls.length, 0);
      if (r.progress) setProgress(r.progress.done, r.progress.total, calls);
    },
    onRetry: (err, attempt) => addNotes('↻', [{ type: 'decision', text: `${err.message} Retrying (${attempt}).` }]),
  });
  state.session = session;

  try {
    state.result = await session.run();
    showCoverage();
  } catch (err) {
    addNotes('!!', [{ type: 'decision', text: err.cancelled ? 'Stopped at your request.' : `Coverage could not be completed: ${err.message}` }]);
  } finally {
    setRunning(false);
    state.session = null;
  }
}

function coverageNumber(brief) {
  let h = 0;
  for (const ch of `${brief.title}|${brief.anchors.join()}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(h % 10000).padStart(4, '0');
}

function showCoverage() {
  const el = $('#coverage');
  el.innerHTML = renderCoverage(state.result, state.brief, coverageNumber(state.brief));
  el.querySelector('[data-appendix-notes]').innerHTML = state.allNotes;
  wireImageFallbacks(el);
  el.hidden = false;
  $('#desk').hidden = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* -------------------------------------------------------------------------- */
/* Document tools                                                              */
/* -------------------------------------------------------------------------- */

function flash(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1600);
}

async function onDocTool(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'print') {
    $$('#coverage details').forEach((d) => { d.open = true; });
    window.print();
  } else if (btn.dataset.act === 'copy') {
    try {
      await navigator.clipboard.writeText(memoToMarkdown(state.brief, state.result));
      flash(btn, 'Copied ✓');
    } catch {
      flash(btn, 'Copy failed');
    }
  } else if (btn.dataset.act === 'json') {
    const blob = new Blob([JSON.stringify({ brief: state.brief, ...state.result }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `culturerisk-${state.brief.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

/* -------------------------------------------------------------------------- */
/* Quick read, MCP page, navigation                                            */
/* -------------------------------------------------------------------------- */

async function runScan(event) {
  event.preventDefault();
  const anchor = $('#scanAnchor').value.trim();
  if (!anchor) return;
  $('#scanBtn').disabled = true;
  $('#scanResults').innerHTML = '<p class="page-lede">Reading Qloo…</p>';
  try {
    $('#scanResults').innerHTML = renderQuickScan(await quickScan(anchor, $('#scanDomain').value));
    wireImageFallbacks($('#scanResults'));
  } catch (err) {
    $('#scanResults').innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  } finally {
    $('#scanBtn').disabled = false;
  }
}

function fillMcp() {
  const url = `${location.origin}/api/mcp`;
  $('#mcpUrl').textContent = url;
  $('#mcpCmd').textContent = `claude mcp add --transport http culturerisk ${url}`;
  $('#mcpCurl').textContent = `curl -s ${url} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"greenlight_analysis","arguments":{"comparable_titles":["La La Land","Hereditary"]}}}'`;
}

function setMode(mode) {
  $$('.nav-link').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('#agentView').hidden = mode !== 'agent';
  $('#scanView').hidden = mode !== 'scan';
  $('#mcpView').hidden = mode !== 'mcp';
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

masthead();
renderSlate();
applyPreset(PRESETS[3]); // open on the most revealing case: the risky hybrid
fillMcp();
loadCapabilities();
$('#briefForm').addEventListener('submit', runAnalysis);
$('#stopBtn').addEventListener('click', () => state.session?.stop());
$('#coverage').addEventListener('click', onDocTool);
$('#scanForm').addEventListener('submit', runScan);
$$('.nav-link').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
