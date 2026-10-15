/**
 * =============================================================================
 * CultureRisk AI — LLM-only baseline endpoint (Netlify Function)
 * =============================================================================
 *
 *   POST /api/baseline   body: { brief }
 *   200: { available: true,  guesses: { <domain urn>: [names] } }
 *        { available: false, reason }   when no Anthropic key is configured
 *
 * The cockpit calls this in parallel with the agent and diffs the guesses
 * against Qloo's results to show what only Qloo knew (see lib/agent/baseline.js).
 * =============================================================================
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { agentConfig } = require('../lib/config');
const { json, methodNotAllowed, badRequest, parseJsonBody } = require('../lib/http');
const { normalizeBrief } = require('../lib/agent/prompt');
const { runBaseline } = require('../lib/agent/baseline');

let makeClient = (config) => new Anthropic({ apiKey: config.apiKey });

async function handler(event) {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST');
  const config = agentConfig();

  const parsed = parseJsonBody(event, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const briefResult = normalizeBrief(parsed.value.brief);
  if (!briefResult.ok) return badRequest(briefResult.message);

  if (!config.apiKey) return json(200, { available: false, reason: 'no_llm_configured' });

  try {
    const guesses = await runBaseline({ brief: briefResult.brief, client: makeClient(config), config });
    return json(200, { available: true, model: config.model, guesses });
  } catch (err) {
    // The baseline is a comparison aid; failure must never break the main flow.
    console.warn('[baseline] failed:', err?.message);
    return json(200, { available: false, reason: 'baseline_failed' });
  }
}

module.exports = {
  handler,
  /** @internal test seam */
  __setClientFactory(fn) { makeClient = fn; },
};
