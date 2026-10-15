/**
 * =============================================================================
 * CultureRisk AI — Quick Scan bridge (Netlify Function)
 * =============================================================================
 *
 * Public route:   GET /api/qloo_bridge?scriptAnchor=<title>&targetDomain=<urn>
 * Internal route: /.netlify/functions/qloo_bridge  (rewritten by netlify.toml)
 *
 * A single-shot, non-agentic Qloo lookup: it resolves the anchor title with
 * /search, then pulls /v2/insights for one domain using
 *   filter.type               = <targetDomain>
 *   signal.interests.entities = <resolved anchor entity ID>
 * and returns ranked affinities with a deterministic domain scorecard.
 *
 * The full agentic workflow lives in agent.js. This endpoint powers the
 * cockpit's "Quick Scan" tab and is useful for API-level testing.
 *
 * Always responds 200 with a usable payload when inputs are valid: live Qloo
 * data when QLOO_HACKATHON_API_KEY is configured and the call succeeds,
 * otherwise clearly labelled simulated data (`mode: "mock"`, with `reason`).
 * =============================================================================
 */

'use strict';

const { DOMAINS, DEFAULT_DOMAIN } = require('../lib/config');
const { json, methodNotAllowed, badRequest, cleanText } = require('../lib/http');
const { createQlooService } = require('../lib/qloo-service');
const { scorecard, whiteSpace } = require('../lib/risk-model');

const RESULT_LIMIT = 6;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET');

  const query = event.queryStringParameters || {};
  const anchor = cleanText(query.scriptAnchor, 120);
  if (!anchor) return badRequest('Query parameter "scriptAnchor" (anchor film title) is required.');

  const requested = typeof query.targetDomain === 'string' ? query.targetDomain.trim() : '';
  if (requested && !Object.prototype.hasOwnProperty.call(DOMAINS, requested)) {
    return badRequest(`Unsupported "targetDomain". Expected one of: ${Object.keys(DOMAINS).join(', ')}.`);
  }
  const targetDomain = requested || DEFAULT_DOMAIN;

  const qloo = createQlooService();
  const search = await qloo.search(anchor, 'urn:entity:movie', 1);
  const anchorEntity = search.data[0];
  const insights = await qloo.insights({ filterType: targetDomain, entityIds: [anchorEntity.entityId], tagIds: [], take: RESULT_LIMIT });

  const live = insights.provenance === 'live';
  const card = scorecard({ domains: { [targetDomain]: insights.data }, coherence: null, liveData: live });
  const profile = card.profiles[targetDomain];

  return json(200, {
    mode: live ? 'live' : 'mock',
    reason: live ? null : insights.failure || search.failure || 'api_key_not_configured',
    anchor: { title: anchorEntity.name, entityId: anchorEntity.entityId },
    targetDomain,
    domainLabel: DOMAINS[targetDomain],
    generatedAt: new Date().toISOString(),
    summary: {
      alignmentIndex: profile.alignment,
      cultureRiskScore: card.cultureRiskScore,
      dispersion: profile.dispersion,
      verdict: card.verdict,
      sampleSize: profile.sampleSize,
    },
    whiteSpace: whiteSpace(insights.data).slice(0, 3),
    results: insights.data,
    calls: qloo.calls,
  });
};
