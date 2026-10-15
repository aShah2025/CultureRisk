/**
 * CultureRisk AI — agent tool surface.
 *
 * Four Qloo-backed research tools and one terminal "submit" tool. Every tool
 * schema uses strict mode (additionalProperties:false, all fields required) so
 * the model's arguments are always schema-valid. Executors still re-validate
 * and clamp, because the scripted engine and tests call them directly.
 *
 *   resolve_entities         Qloo /search      titles/names → entity IDs
 *   find_taste_tags          Qloo /v2/tags     themes → tag IDs
 *   get_audience_affinities  Qloo /v2/insights blended anchor signal → one domain
 *   stress_test_comps        Qloo /v2/insights per-anchor → comp coherence
 *   submit_greenlight_memo   (terminal)        structured board memo
 *
 * Executors return compact JSON for the model and write durable facts into
 * the evidence ledger.
 */

'use strict';

const { DOMAINS, SEARCH_TYPES } = require('../config');
const { domainProfile, whiteSpace, compCoherence } = require('../risk-model');
const { recordAnchor, recordDomain } = require('./ledger');
const { cleanText } = require('../http');

const DOMAIN_KEYS = Object.keys(DOMAINS);
const INSIGHT_TAKE = 8;

/* -------------------------------------------------------------------------- */
/* Tool definitions (Anthropic Messages API format)                            */
/* -------------------------------------------------------------------------- */

const stringArray = (description) => ({ type: 'array', items: { type: 'string' }, description });

const TOOL_DEFINITIONS = [
  {
    name: 'resolve_entities',
    description:
      'Resolve up to 4 free-text names (film titles, artists, brands, places) to Qloo entity IDs using Qloo /search. ' +
      'Always resolve comparable/anchor films with entity_type "urn:entity:movie" before requesting affinities. ' +
      'Returns the top matches per query with year and popularity so you can disambiguate remakes or same-name titles.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        queries: stringArray('Names to resolve, max 4.'),
        entity_type: { type: 'string', enum: SEARCH_TYPES, description: 'Qloo entity type URN to search within.' },
      },
      required: ['queries', 'entity_type'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_taste_tags',
    description:
      'Find Qloo taste tag IDs for a theme, genre, or tone drawn from the script (e.g. "cyberpunk", "royal period drama", "arctic survival"). ' +
      'Tag IDs can be added as signals to get_audience_affinities to steer results toward the script\'s themes, not only the comps.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Theme or genre phrase.' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_audience_affinities',
    description:
      'Query Qloo /v2/insights: given anchor entity IDs (and optional tag IDs) as signals, return the entities in target_domain that this audience over-indexes on, ' +
      'with affinity (0-1), popularity (0-1), a domain profile (alignment 0-100, dispersion), and "white space" entities whose affinity exceeds their popularity ' +
      '(under-priced partners). Call once per domain you need evidence for.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        target_domain: { type: 'string', enum: DOMAIN_KEYS, description: 'Qloo output domain URN.' },
        entity_ids: stringArray('Anchor entity IDs from resolve_entities (max 4).'),
        tag_ids: stringArray('Optional tag IDs from find_taste_tags (max 4). Pass [] for none.'),
      },
      required: ['target_domain', 'entity_ids', 'tag_ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'stress_test_comps',
    description:
      'Stress-test an "X meets Y" pitch. Queries Qloo /v2/insights separately for each anchor entity in one domain and measures how much their audiences\' tastes overlap ' +
      '(comp coherence 0-1: Jaccard on top results blended with rank agreement). Low coherence means the hybrid audience the pitch assumes may not exist. Needs 2-4 entity IDs.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        entity_ids: stringArray('2-4 anchor entity IDs.'),
        labels: stringArray('Human-readable names for each entity ID, same order.'),
        target_domain: { type: 'string', enum: DOMAIN_KEYS, description: 'Domain in which to compare tastes.' },
      },
      required: ['entity_ids', 'labels', 'target_domain'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_greenlight_memo',
    description:
      'Submit the final greenlight memo. Call exactly once, after gathering evidence. Every recommendation must cite a Qloo entity_id returned by a tool in this session. ' +
      'The system attaches a deterministic Qloo scorecard alongside your memo; your verdict should be consistent with the evidence.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['GREENLIGHT', 'CONDITIONAL GREENLIGHT', 'REWORK', 'PASS'] },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        executive_summary: { type: 'string', description: '3-4 sentences for a studio chair.' },
        audience_thesis: { type: 'string', description: 'Who the audience is, grounded in Qloo affinities.' },
        comp_coherence_finding: { type: 'string', description: 'What the comp stress test showed, or why it was not run.' },
        recommendations: {
          type: 'array',
          description: '3-8 concrete partnership, soundtrack, location, or media-buy recommendations.',
          items: {
            type: 'object',
            properties: {
              domain: { type: 'string', enum: DOMAIN_KEYS },
              name: { type: 'string' },
              qloo_entity_id: { type: 'string' },
              action: { type: 'string', description: 'What the studio should do.' },
              evidence: { type: 'string', description: 'Cite affinity/popularity/white-space numbers.' },
            },
            required: ['domain', 'name', 'qloo_entity_id', 'action', 'evidence'],
            additionalProperties: false,
          },
        },
        risks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              risk: { type: 'string' },
              severity: { type: 'string', enum: ['low', 'medium', 'high'] },
              mitigation: { type: 'string' },
            },
            required: ['risk', 'severity', 'mitigation'],
            additionalProperties: false,
          },
        },
        next_steps: stringArray('Ordered next actions for the development team.'),
      },
      required: [
        'verdict',
        'confidence',
        'executive_summary',
        'audience_thesis',
        'comp_coherence_finding',
        'recommendations',
        'risks',
        'next_steps',
      ],
      additionalProperties: false,
    },
  },
];

const TERMINAL_TOOL = 'submit_greenlight_memo';

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

class ToolInputError extends Error {}

function strings(value, field, { min = 0, max }) {
  if (!Array.isArray(value)) throw new ToolInputError(`${field} must be an array of strings.`);
  const cleaned = value.map((v) => cleanText(String(v), 160)).filter(Boolean);
  if (cleaned.length < min) throw new ToolInputError(`${field} needs at least ${min} item(s).`);
  return cleaned.slice(0, max);
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw new ToolInputError(`${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}

/** Compact entity view for the model (keeps tool results small). */
const brief = (e) => ({ entity_id: e.entityId, name: e.name, affinity: e.affinity, popularity: e.popularity, tags: e.tags });

/* -------------------------------------------------------------------------- */
/* Executors                                                                   */
/* -------------------------------------------------------------------------- */

const EXECUTORS = {
  async resolve_entities(input, { qloo, ledger }) {
    const queries = strings(input.queries, 'queries', { min: 1, max: 4 });
    const type = oneOf(input.entity_type, SEARCH_TYPES, 'entity_type');
    const results = await Promise.all(queries.map((q) => qloo.search(q, type, 3)));
    const out = queries.map((q, i) => {
      const { data, provenance } = results[i];
      if (type === 'urn:entity:movie') recordAnchor(ledger, q, data[0], provenance);
      return {
        query: q,
        provenance,
        matches: data.map((e) => ({ entity_id: e.entityId, name: e.name, year: e.year, popularity: e.popularity })),
      };
    });
    return {
      result: { entity_type: type, resolved: out },
      summary: out.map((r) => `${r.query} → ${r.matches[0]?.name ?? 'no match'}`).join(' · '),
    };
  },

  async find_taste_tags(input, { qloo, ledger }) {
    const query = cleanText(input.query, 80);
    if (!query) throw new ToolInputError('query is required.');
    const { data, provenance } = await qloo.tags(query, 5);
    data.forEach((t) => {
      if (!ledger.tags.some((x) => x.tagId === t.tagId)) ledger.tags.push({ query, tagId: t.tagId, name: t.name });
    });
    return {
      result: { query, provenance, tags: data.map((t) => ({ tag_id: t.tagId, name: t.name, type: t.type })) },
      summary: `${data.length} tag(s): ${data.map((t) => t.name).join(', ')}`,
    };
  },

  async get_audience_affinities(input, { qloo, ledger }) {
    const domain = oneOf(input.target_domain, Object.keys(DOMAINS), 'target_domain');
    const entityIds = strings(input.entity_ids, 'entity_ids', { min: 0, max: 4 });
    const tagIds = strings(input.tag_ids, 'tag_ids', { min: 0, max: 4 });
    if (entityIds.length + tagIds.length === 0) throw new ToolInputError('Provide at least one entity_id or tag_id.');

    const { data, provenance, failure } = await qloo.insights({ filterType: domain, entityIds, tagIds, take: INSIGHT_TAKE });
    recordDomain(ledger, domain, data);
    const profile = domainProfile(data);
    const gaps = whiteSpace(data).slice(0, 3);
    return {
      result: {
        target_domain: domain,
        domain_label: DOMAINS[domain],
        provenance,
        ...(failure ? { live_failure: failure } : {}),
        profile,
        white_space: gaps,
        entities: data.map(brief),
      },
      summary: `${DOMAINS[domain]}: alignment ${profile.alignment ?? '—'}, top = ${data[0]?.name ?? '—'}${gaps.length ? `, white space: ${gaps[0].name}` : ''}`,
    };
  },

  async stress_test_comps(input, { qloo, ledger }) {
    const domain = oneOf(input.target_domain, Object.keys(DOMAINS), 'target_domain');
    const ids = strings(input.entity_ids, 'entity_ids', { min: 2, max: 4 });
    const labels = strings(input.labels, 'labels', { min: 0, max: 4 });
    const runs = await Promise.all(ids.map((id) => qloo.insights({ filterType: domain, entityIds: [id], tagIds: [], take: INSIGHT_TAKE })));
    const perAnchor = ids.map((id, i) => ({ anchor: labels[i] || id, entities: runs[i].data }));
    const result = compCoherence(perAnchor);
    ledger.coherence = {
      target: domain,
      coherence: result.coherence,
      pairs: result.pairs,
      perAnchor: perAnchor.map((p) => ({ anchor: p.anchor, top: p.entities.slice(0, 5).map((e) => e.name) })),
    };
    return {
      result: {
        target_domain: domain,
        provenance: [...new Set(runs.map((r) => r.provenance))],
        comp_coherence: result.coherence,
        interpretation:
          result.coherence >= 0.5 ? 'coherent: comps share a taste audience'
            : result.coherence >= 0.25 ? 'partial: the hybrid audience is narrower than either comp'
              : 'divergent: comps attract different audiences; the "X meets Y" premise is unproven',
        pairs: result.pairs,
        per_anchor_top: ledger.coherence.perAnchor,
      },
      summary: `Comp coherence ${Math.round(result.coherence * 100)}% across ${ids.length} anchors`,
    };
  },
};

/**
 * Execute one tool call.
 * @returns {Promise<{content: string, isError: boolean, summary: string}>}
 */
async function executeTool(name, input, ctx) {
  const exec = EXECUTORS[name];
  if (!exec) return { content: JSON.stringify({ error: `Unknown tool: ${name}` }), isError: true, summary: `unknown tool ${name}` };
  try {
    const { result, summary } = await exec(input || {}, ctx);
    return { content: JSON.stringify(result), isError: false, summary };
  } catch (err) {
    const message = err instanceof ToolInputError ? err.message : 'Tool execution failed.';
    if (!(err instanceof ToolInputError)) console.error(`[agent] tool ${name} crashed:`, err);
    return { content: JSON.stringify({ error: message }), isError: true, summary: `error: ${message}` };
  }
}

module.exports = { TOOL_DEFINITIONS, TERMINAL_TOOL, executeTool, ToolInputError };
