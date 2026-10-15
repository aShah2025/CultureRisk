/**
 * CultureRisk AI — LLM-only baseline ("what would a model guess without Qloo?").
 *
 * The hackathon's core test: the agent must beat a generic LLM-only approach.
 * This module asks the same model, with no tools and no Qloo access, to
 * predict the brands, artists, and places the anchor audience loves. The
 * cockpit then diffs these guesses against what Qloo actually returned and
 * renders a "Blind-spot report": the audience signals that only Qloo's taste
 * graph surfaced.
 *
 * Structured output (json_schema) guarantees a parseable shape.
 */

'use strict';

const { DOMAINS } = require('../config');

const BASELINE_SYSTEM =
  'You are a film-marketing strategist with no access to data tools. Answer from general knowledge only. ' +
  'Be specific: name real brands, artists, places, shows, or podcasts.';

function baselineSchema(domains) {
  return {
    type: 'object',
    properties: Object.fromEntries(domains.map((d) => [d, { type: 'array', items: { type: 'string' } }])),
    required: domains,
    additionalProperties: false,
  };
}

/**
 * @param {object} args
 * @param {object} args.brief   Normalised brief.
 * @param {object} args.client  Anthropic client.
 * @param {object} args.config  agentConfig().
 * @returns {Promise<Object<string, string[]>>} domain URN → guessed entity names
 */
async function runBaseline({ brief, client, config }) {
  const prompt = [
    `Audience: people who love ${brief.anchors.join(' and ')}.`,
    'For each category below, list the 6 entities you predict this audience over-indexes on most:',
    ...brief.domains.map((d) => `- ${d}: ${DOMAINS[d]}`),
  ].join('\n');

  const response = await client.messages.create(
    {
      model: config.model,
      max_tokens: 4000,
      system: BASELINE_SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: baselineSchema(brief.domains) } },
      messages: [{ role: 'user', content: prompt }],
    },
    { timeout: config.requestTimeoutMs, maxRetries: 1 },
  );

  if (response.stop_reason === 'refusal') throw new Error('baseline_refused');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('baseline_empty');
  const parsed = JSON.parse(text);
  return Object.fromEntries(
    brief.domains.map((d) => [d, (Array.isArray(parsed[d]) ? parsed[d] : []).map(String).slice(0, 8)]),
  );
}

module.exports = { runBaseline, baselineSchema };
