/**
 * =============================================================================
 * CultureRisk AI — Agent endpoint (Netlify Function)
 * =============================================================================
 *
 *   GET  /api/agent   → capabilities: which engine and data mode are active
 *   POST /api/agent   → run ONE agent step
 *        body: { brief: {...}, state: <echoed from previous step> | null }
 *        200:  { status: "continue", step, events[], state }
 *              { status: "done", step, events[], memo, scorecard, grounding, evidence }
 *        4xx/5xx: { status: "error", message, retryable }
 *
 * ENGINES
 *   claude    ANTHROPIC_API_KEY set: Claude plans and runs the Qloo research
 *             itself, then writes the memo.
 *   scripted  No Anthropic key: a fixed research plan runs through the same
 *             Qloo tools and ledger, and the memo is templated.
 *
 * Qloo data mode is independent: live when QLOO_HACKATHON_API_KEY is set,
 * otherwise simulated, with per-call fallback on upstream failure.
 * =============================================================================
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { agentConfig } = require('../lib/config');
const { json, methodNotAllowed, badRequest, parseJsonBody } = require('../lib/http');
const { createQlooService } = require('../lib/qloo-service');
const { normalizeBrief } = require('../lib/agent/prompt');
const { runClaudeStep } = require('../lib/agent/claude-runner');
const { runScriptedStep } = require('../lib/agent/scripted-runner');

/** Map SDK errors to a client-safe response. Most specific class first. */
function anthropicErrorResponse(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return json(502, { status: 'error', retryable: false, message: 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.' });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return json(429, { status: 'error', retryable: true, message: 'Model rate limit reached. Retrying shortly.' });
  }
  if (err instanceof Anthropic.BadRequestError) {
    console.error('[agent] bad request to Anthropic:', err.message);
    return json(400, { status: 'error', retryable: false, message: 'The session state was rejected by the model API. Start a new analysis.' });
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIConnectionError) {
    return json(504, { status: 'error', retryable: true, message: 'The model took too long on this step. Retrying.' });
  }
  if (err instanceof Anthropic.APIError) {
    return json(502, { status: 'error', retryable: (err.status ?? 500) >= 500, message: `Model API error (${err.status ?? 'unknown'}).` });
  }
  return null;
}

/** Factory seam so tests can inject a fake SDK client. */
let makeClient = (config) => new Anthropic({ apiKey: config.apiKey });

async function handler(event) {
  const config = agentConfig();
  const engine = config.apiKey ? 'claude' : 'scripted';

  if (event.httpMethod === 'GET') {
    const qloo = createQlooService();
    return json(200, { engine, model: engine === 'claude' ? config.model : null, qlooMode: qloo.mode, maxSteps: config.maxSteps });
  }
  if (event.httpMethod !== 'POST') return methodNotAllowed('GET, POST');

  const parsed = parseJsonBody(event, config.maxStateBytes);
  if (!parsed.ok) return parsed.response;

  const briefResult = normalizeBrief(parsed.value.brief);
  if (!briefResult.ok) return badRequest(briefResult.message);

  // Restart cleanly if the echoed state belongs to a different engine (e.g. a key was added mid-session).
  const rawState = parsed.value.state && typeof parsed.value.state === 'object' ? parsed.value.state : null;
  const state = rawState && rawState.engine === engine ? rawState : null;

  const qloo = createQlooService();
  try {
    const result = engine === 'claude'
      ? await runClaudeStep({ brief: briefResult.brief, state, client: makeClient(config), qloo, config })
      : await runScriptedStep({ brief: briefResult.brief, state, qloo });

    if (result.state) result.state.engine = engine;
    return json(result.status === 'error' ? 502 : 200, { engine, qlooMode: qloo.mode, ...result });
  } catch (err) {
    const mapped = anthropicErrorResponse(err);
    if (mapped) return mapped;
    console.error('[agent] unexpected failure:', err);
    return json(500, { status: 'error', retryable: true, message: 'Unexpected agent failure.' });
  }
}

module.exports = {
  handler,
  /** @internal test seam */
  __setClientFactory(fn) { makeClient = fn; },
};
