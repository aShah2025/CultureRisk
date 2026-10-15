/**
 * CultureRisk AI — scripted agent engine (no-LLM fallback).
 *
 * Runs when ANTHROPIC_API_KEY is not configured. It follows the same research
 * protocol the Claude engine is prompted with, as a fixed plan, through the
 * *same* Qloo tool executors and evidence ledger. The cockpit experience,
 * scorecard, and audit trail are identical; only the memo prose is templated
 * instead of written by a model.
 *
 * Plan: resolve anchors → theme tags → affinities per domain → comp stress
 * test (2+ anchors) → compose memo. One phase per HTTP step.
 */

'use strict';

const { DOMAINS } = require('../config');
const { executeTool } = require('./tools');
const { createLedger, hydrateLedger, recordCalls } = require('./ledger');
const { finalizeSession, composeMemoFromLedger } = require('./finalize');

/** Pull up to two theme phrases from the script for tag search. */
const THEME_PATTERNS = [
  [/cyber|neon|android|synthetic|dystop/i, 'cyberpunk'],
  [/noir|detective|forensic|crime/i, 'neo-noir thriller'],
  [/royal|king|queen|princess|regent|empire|parliament/i, 'royal period drama'],
  [/survival|arctic|expedition|wilderness|stranded/i, 'survival adventure'],
  [/horror|haunt|ghost|demon/i, 'supernatural horror'],
  [/romance|love story|affair/i, 'romantic drama'],
  [/comedy|satire/i, 'comedy'],
  [/war|battle|soldier/i, 'war drama'],
];

function themesFromScript(script) {
  return THEME_PATTERNS.filter(([re]) => re.test(script || '')).map(([, t]) => t).slice(0, 2);
}

function buildPlan(brief) {
  const plan = ['resolve'];
  if (themesFromScript(brief.script).length) plan.push('tags');
  brief.domains.forEach((d) => plan.push(`affinity:${d}`));
  if (brief.anchors.length >= 2) plan.push('coherence');
  plan.push('memo');
  return plan;
}

const NARRATION = {
  resolve: (b) => `Resolving ${b.anchors.length} comparable title(s) to Qloo entity IDs.`,
  tags: (b) => `Mapping the script's themes (${themesFromScript(b.script).join(', ')}) to Qloo taste tags.`,
  affinity: (d) => `Pulling Qloo cross-domain affinities for ${DOMAINS[d]}.`,
  coherence: () => 'Stress-testing whether the comparable titles share one taste audience.',
};

/** Tool call (name + input) for a plan phase, derived from brief + ledger. */
function toolCallFor(phase, brief, ledger) {
  const anchorIds = ledger.anchors.map((a) => a.entityId);
  const tagIds = ledger.tags.slice(0, 2).map((t) => t.tagId);
  if (phase === 'resolve') return [{ name: 'resolve_entities', input: { queries: brief.anchors, entity_type: 'urn:entity:movie' } }];
  if (phase === 'tags') return themesFromScript(brief.script).map((q) => ({ name: 'find_taste_tags', input: { query: q } }));
  if (phase.startsWith('affinity:')) {
    return [{ name: 'get_audience_affinities', input: { target_domain: phase.slice(9), entity_ids: anchorIds, tag_ids: tagIds } }];
  }
  if (phase === 'coherence') {
    return [{
      name: 'stress_test_comps',
      input: { entity_ids: anchorIds, labels: ledger.anchors.map((a) => a.name), target_domain: brief.domains[0] },
    }];
  }
  return [];
}

async function runScriptedStep({ brief, state, qloo }) {
  const plan = buildPlan(brief);
  const ledger = state?.ledger ? hydrateLedger(state.ledger) : createLedger();
  const phaseIndex = Number.isInteger(state?.phaseIndex) ? state.phaseIndex : 0;
  const phase = plan[Math.min(phaseIndex, plan.length - 1)];
  const step = phaseIndex + 1;

  if (phase === 'memo') {
    return {
      status: 'done',
      step,
      events: [{ type: 'narration', text: 'Composing the greenlight memo from the Qloo evidence ledger.' }],
      ...finalizeSession(ledger, composeMemoFromLedger(ledger, brief), 'scripted'),
    };
  }

  const sep = phase.indexOf(':');
  const kind = sep === -1 ? phase : phase.slice(0, sep);
  const domain = sep === -1 ? null : phase.slice(sep + 1);
  const events = [{ type: 'narration', text: kind === 'affinity' ? NARRATION.affinity(domain) : NARRATION[kind](brief) }];
  const calls = toolCallFor(phase, brief, ledger);
  const before = qloo.calls.length;

  // Sequential within a phase keeps the trace order deterministic.
  for (let i = 0; i < calls.length; i += 1) {
    const id = `scripted_${step}_${i}`;
    events.push({ type: 'tool_call', id, tool: calls[i].name, input: calls[i].input });
    // eslint-disable-next-line no-await-in-loop
    const r = await executeTool(calls[i].name, calls[i].input, { qloo, ledger });
    events.push({ type: 'tool_result', id, tool: calls[i].name, ok: !r.isError, summary: r.summary });
  }
  recordCalls(ledger, qloo.calls.slice(before));

  return { status: 'continue', step, events, state: { phaseIndex: phaseIndex + 1, ledger }, totalSteps: plan.length };
}

module.exports = { runScriptedStep, buildPlan, themesFromScript };
