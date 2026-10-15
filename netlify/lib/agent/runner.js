/**
 * CultureRisk AI — autonomous agent runner (one action per HTTP request).
 *
 * The loop:  plan → act (Qloo) → observe → update ledger → re-plan → … → synthesize
 *
 * Why stepwise: Netlify synchronous functions are capped at 30 s, and a full
 * investigation is 15–30 Qloo calls. Each request executes exactly one action
 * and returns the updated session state for the browser to echo back. That
 * gives unlimited depth, no session database, and a live trace of every
 * decision as it happens.
 */

'use strict';

const { createLedger, hydrateLedger, recordCalls } = require('./ledger');
const { nextAction, describePlan, estimateTotal } = require('./policy');
const { finalizeSession } = require('./synthesis');

const MAX_STEPS = 24;

/**
 * @param {object} args
 * @param {object} args.brief       Normalised brief.
 * @param {object|null} args.state  {ledger, step} echoed from the previous step, or null.
 * @param {object} args.qloo        Qloo service (fresh per request).
 */
async function runAgentStep({ brief, state, qloo }) {
  const ledger = state?.ledger ? hydrateLedger(state.ledger) : createLedger();
  const step = Number.isInteger(state?.step) ? state.step + 1 : 1;
  const events = [];
  if (step === 1) events.push({ type: 'plan', goal: `Decide whether ${brief.title} should be greenlit, using Qloo's taste graph as evidence.`, items: describePlan(brief) });

  const action = step > MAX_STEPS ? null : nextAction(brief, ledger);

  if (!action) {
    if (ledger.flags.abort) events.push({ type: 'decision', text: `Stopping research: ${ledger.flags.abort}` });
    events.push({ type: 'action', id: 'synthesize', title: 'Synthesize the greenlight memo', why: `Research complete after ${ledger.actions.length} actions and ${ledger.calls.length} Qloo calls.` });
    return { status: 'done', step, events, ...finalizeSession(brief, ledger) };
  }

  events.push({ type: 'action', id: action.id, title: action.title, why: action.why, conditional: Boolean(action.conditional) });

  const before = qloo.calls.length;
  let result = { observations: [], decisions: [] };
  try {
    result = await action.run({ brief, ledger, qloo });
  } catch (err) {
    console.error(`[agent] action ${action.id} failed:`, err);
    result.decisions.push('This step failed unexpectedly. Continuing with the evidence gathered so far.');
  }
  ledger.actions.push(action.id);
  const newCalls = qloo.calls.slice(before);
  recordCalls(ledger, newCalls);

  events.push({ type: 'calls', calls: newCalls });
  result.observations.forEach((text) => events.push({ type: 'observation', text }));
  result.decisions.forEach((text) => events.push({ type: 'decision', text }));

  return {
    status: 'continue',
    step,
    events,
    progress: { done: ledger.actions.length, total: estimateTotal(brief, ledger) },
    state: { ledger, step },
  };
}

/** Run a full session in-process (used by the MCP endpoint and tests). */
async function runToCompletion({ brief, makeQloo, onStep }) {
  let state = null;
  for (let i = 0; i <= MAX_STEPS + 1; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await runAgentStep({ brief, state, qloo: makeQloo() });
    if (onStep) onStep(r);
    if (r.status === 'done') return r;
    state = r.state;
  }
  throw new Error('Agent exceeded its step budget.');
}

module.exports = { runAgentStep, runToCompletion, MAX_STEPS };
