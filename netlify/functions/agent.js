/**
 * =============================================================================
 * CultureRisk AI — Agent endpoint (Netlify Function)
 * =============================================================================
 *
 *   GET  /api/agent   → capabilities (Qloo data mode, step budget)
 *   POST /api/agent   → run ONE agent action
 *        body: { brief: {...}, state: <echoed from the previous step> | null }
 *        200:  { status: "continue", step, events[], progress, state }
 *              { status: "done", step, events[], memo, scorecard, grounding, evidence }
 *
 * The agent is an autonomous, deterministic planner over Qloo's API (see
 * lib/agent/policy.js). No LLM is involved: every decision is a rule over
 * Qloo evidence, and every number is reproducible and auditable.
 * =============================================================================
 */

'use strict';

const { json, methodNotAllowed, badRequest, parseJsonBody } = require('../lib/http');
const { createQlooService } = require('../lib/qloo-service');
const { normalizeBrief } = require('../lib/agent/brief');
const { runAgentStep, MAX_STEPS } = require('../lib/agent/runner');

const MAX_BODY_BYTES = 400 * 1024;

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    return json(200, { engine: 'autonomous-qloo-agent', qlooMode: createQlooService().mode, maxSteps: MAX_STEPS });
  }
  if (event.httpMethod !== 'POST') return methodNotAllowed('GET, POST');

  const parsed = parseJsonBody(event, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const briefResult = normalizeBrief(parsed.value.brief);
  if (!briefResult.ok) return badRequest(briefResult.message);

  const state = parsed.value.state && typeof parsed.value.state === 'object' ? parsed.value.state : null;
  const qloo = createQlooService();

  try {
    const result = await runAgentStep({ brief: briefResult.brief, state, qloo });
    return json(200, { qlooMode: qloo.mode, ...result });
  } catch (err) {
    console.error('[agent] unexpected failure:', err);
    return json(500, { status: 'error', retryable: true, message: 'Unexpected agent failure.' });
  }
};
