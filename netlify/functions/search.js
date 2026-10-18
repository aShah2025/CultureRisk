/**
 * =============================================================================
 * CultureRisk — Qloo title search (Netlify Function)
 * =============================================================================
 *
 *   GET /api/search?q=<text>   → up to 6 Qloo films: {entityId, name, year, image, popularity}
 *
 * Powers the comp picker's type-ahead, so users choose real Qloo entities
 * (with posters) before the agent ever runs.
 * =============================================================================
 */

'use strict';

const { json, methodNotAllowed, badRequest, cleanText } = require('../lib/http');
const { createQlooService } = require('../lib/qloo-service');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET');
  const q = cleanText(event.queryStringParameters?.q, 80);
  if (q.length < 2) return badRequest('Query parameter "q" needs at least 2 characters.');

  const qloo = createQlooService();
  const { data, provenance } = await qloo.search(q, 'urn:entity:movie', 6);
  return json(200, {
    provenance,
    results: data.map((e) => ({ entityId: e.entityId, name: e.name, year: e.year, image: e.image, popularity: e.popularity, disambiguation: e.disambiguation })),
  }, { 'Cache-Control': 'public, max-age=300' });
};
