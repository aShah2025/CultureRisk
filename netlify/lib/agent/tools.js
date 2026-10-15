/**
 * CultureRisk AI — tool surface for external agents (served over MCP).
 *
 * Any MCP-capable agent (Claude Desktop, Claude Code, ChatGPT connectors,
 * Cursor, …) can call these tools to get Qloo-grounded film-audience
 * intelligence. Each tool reuses the same autonomous agent and Qloo service
 * as the cockpit, so answers match what the UI shows.
 */

'use strict';

const { DOMAINS } = require('../config');
const { normalizeBrief } = require('./brief');
const { runToCompletion } = require('./runner');
const { createQlooService } = require('../qloo-service');

const DOMAIN_KEYS = Object.keys(DOMAINS);

const TOOLS = [
  {
    name: 'greenlight_analysis',
    title: 'Film greenlight risk analysis',
    description:
      'Run CultureRisk\'s autonomous Qloo research agent on a film project. Resolves the comparable titles, profiles the audience (taste DNA, demographics), ' +
      'stress-tests whether the comps share an audience, measures concept fit, and maps brand / music / location partners. ' +
      'Returns a verdict, a 0-100 culture-risk score, and Qloo-grounded recommendations with entity IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Working title of the project.' },
        comparable_titles: { type: 'array', items: { type: 'string' }, description: '1-3 released comparable films ("X meets Y").' },
        treatment: { type: 'string', description: 'Logline / tone / treatment notes (optional).' },
        domains: { type: 'array', items: { type: 'string', enum: DOMAIN_KEYS }, description: 'Qloo domains to map (default: brand, artist, destination).' },
      },
      required: ['comparable_titles'],
      additionalProperties: false,
    },
  },
  {
    name: 'audience_affinities',
    title: 'Qloo audience affinities for comparable films',
    description: 'What the combined audience of the given films over-indexes on in one Qloo domain (brands, artists, destinations, TV shows, or podcasts), with affinity, popularity, and white-space gaps.',
    inputSchema: {
      type: 'object',
      properties: {
        comparable_titles: { type: 'array', items: { type: 'string' } },
        domain: { type: 'string', enum: DOMAIN_KEYS },
      },
      required: ['comparable_titles', 'domain'],
      additionalProperties: false,
    },
  },
];

function text(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], structuredContent: obj };
}

async function callTool(name, args = {}) {
  if (name === 'greenlight_analysis') {
    const b = normalizeBrief({ title: args.title, anchors: args.comparable_titles, script: args.treatment, domains: args.domains });
    if (!b.ok) return { ...text({ error: b.message }), isError: true };
    const r = await runToCompletion({ brief: b.brief, makeQloo: () => createQlooService() });
    return text({
      verdict: r.memo.verdict,
      culture_risk_score: r.scorecard.cultureRiskScore,
      confidence: r.memo.confidence,
      headline: r.memo.headline,
      executive_summary: r.memo.executiveSummary,
      audience: r.memo.audiencePortrait,
      comp_stress_test: r.memo.compFinding,
      concept_fit: r.memo.conceptFinding,
      recommendations: r.memo.recommendations.map((x) => ({ domain: x.domain, name: x.name, qloo_entity_id: x.entityId, action: x.action, evidence: x.evidence })),
      popularity_traps: r.memo.popularityTraps,
      risks: r.memo.risks,
      next_steps: r.memo.nextSteps,
      data_provenance: r.evidence.liveData ? 'live Qloo data' : 'simulated (no Qloo key configured)',
      qloo_calls: r.evidence.calls.length,
    });
  }

  if (name === 'audience_affinities') {
    const titles = (args.comparable_titles || []).slice(0, 3);
    if (!titles.length || !DOMAIN_KEYS.includes(args.domain)) return { ...text({ error: 'comparable_titles and a valid domain are required.' }), isError: true };
    const qloo = createQlooService();
    const resolved = await Promise.all(titles.map((t) => qloo.search(t, 'urn:entity:movie', 1)));
    const ids = resolved.map((r) => r.data[0]?.entityId).filter(Boolean);
    const { data, provenance } = await qloo.insights({ filterType: args.domain, entityIds: ids, take: 10 });
    return text({
      domain: args.domain,
      provenance,
      anchors: resolved.map((r, i) => ({ query: titles[i], entity_id: r.data[0]?.entityId ?? null, name: r.data[0]?.name ?? null })),
      entities: data.map((e) => ({ name: e.name, qloo_entity_id: e.entityId, affinity: e.affinity, popularity: e.popularity, white_space: typeof e.affinity === 'number' && typeof e.popularity === 'number' ? Math.round((e.affinity - e.popularity) * 100) / 100 : null })),
    });
  }

  return { ...text({ error: `Unknown tool: ${name}` }), isError: true };
}

module.exports = { TOOLS, callTool };
