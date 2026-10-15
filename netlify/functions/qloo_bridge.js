/**
 * =============================================================================
 * CultureRisk AI — Qloo Bridge (Netlify Serverless Function)
 * =============================================================================
 *
 * Public route:   GET /api/qloo_bridge?scriptAnchor=<title>&targetDomain=<urn>
 * Internal route: /.netlify/functions/qloo_bridge  (rewritten by netlify.toml)
 *
 * PURPOSE
 *   A thin, secure proxy between the browser cockpit and the Qloo Taste AI
 *   Insights API. The Qloo API key lives only in the server environment and is
 *   never exposed to the client.
 *
 * DUAL-MODE WORKFLOW
 *   1. LIVE  — QLOO_HACKATHON_API_KEY is configured: the anchor film title is
 *              resolved to a Qloo entity ID, then cross-domain affinities are
 *              requested via:
 *                filter.type              = <targetDomain URN>
 *                signal.interests.entities = <resolved anchor entity ID>
 *   2. MOCK  — Key missing / placeholder, OR any upstream failure (network,
 *              timeout, non-2xx, empty result set): the bridge returns HTTP 200
 *              with deterministic, studio-grade simulated metrics for the
 *              requested domain. The payload is flagged `mode: "mock"` so the UI
 *              can label it honestly.
 *
 * ENVIRONMENT VARIABLES
 *   QLOO_HACKATHON_API_KEY  (required for live mode)  Qloo API key.
 *   QLOO_API_BASE           (optional) Defaults to https://hackathon.api.qloo.com
 *
 * RUNTIME
 *   Node 18+ (global fetch + AbortController). No npm dependencies.
 * =============================================================================
 */

'use strict';

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

const QLOO_API_BASE = (process.env.QLOO_API_BASE || 'https://hackathon.api.qloo.com').replace(/\/+$/, '');

/** Upstream request budget. Netlify sync functions time out at 10s by default. */
const UPSTREAM_TIMEOUT_MS = 7000;

/** Number of affinity results returned to the cockpit. */
const RESULT_LIMIT = 6;

/** Max accepted length of the anchor title (defensive input bound). */
const MAX_ANCHOR_LENGTH = 120;

/**
 * Values treated as "no real key configured". Any of these force mock mode
 * without attempting an outbound request.
 */
const MOCK_KEY_SENTINELS = new Set([
  '',
  'mock',
  'mock_key',
  'mock-key',
  'demo',
  'test',
  'changeme',
  'your_api_key_here',
  'your-qloo-api-key',
  'qloo_hackathon_api_key',
]);

/** Supported Qloo output domains and their cockpit display labels. */
const DOMAINS = Object.freeze({
  'urn:entity:brand': 'Brand Partnerships',
  'urn:entity:artist': 'Soundtrack & Talent',
  'urn:entity:destination': 'Location & Tourism',
});

const DEFAULT_DOMAIN = 'urn:entity:brand';

const BASE_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
});

/* -------------------------------------------------------------------------- */
/* Studio mock dataset (served when live data is unavailable)                  */
/* -------------------------------------------------------------------------- */

/**
 * Baseline simulated entities per domain. Affinity / popularity values are
 * baselines; a deterministic per-anchor jitter is applied at request time so
 * different anchors yield stable but distinct results.
 * Entity IDs use a `mock:` prefix so they can never be confused with real Qloo IDs.
 */
const MOCK_LIBRARY = Object.freeze({
  'urn:entity:brand': [
    { name: 'Porsche', affinity: 0.91, popularity: 0.88, tags: ['Luxury Automotive', 'Design-Led'], rationale: 'High-income, design-literate audience; precedent for hero-vehicle placement in premium genre releases.' },
    { name: 'Bang & Olufsen', affinity: 0.87, popularity: 0.71, tags: ['Premium Audio', 'Scandinavian Design'], rationale: 'Strong overlap with audiophile and production-design enthusiasts; ideal for co-branded home-entertainment SKUs.' },
    { name: 'Patagonia', affinity: 0.82, popularity: 0.84, tags: ['Outdoor', 'Values-Driven'], rationale: 'Resonates with purpose-driven millennial cohorts; low brand-safety risk for mature narratives.' },
    { name: 'Rolex', affinity: 0.79, popularity: 0.93, tags: ['Luxury Horology', 'Heritage'], rationale: 'Prestige signalling aligns with awards-season positioning; historically selective on placement.' },
    { name: 'Apple', affinity: 0.76, popularity: 0.98, tags: ['Consumer Tech', 'Mass Premium'], rationale: 'Near-universal reach dilutes niche affinity but guarantees four-quadrant visibility.' },
    { name: 'Aesop', affinity: 0.73, popularity: 0.58, tags: ['Luxury Grooming', 'Tastemaker'], rationale: 'Concentrated urban tastemaker audience; efficient for limited-run premiere activations.' },
  ],
  'urn:entity:artist': [
    { name: 'Hans Zimmer', affinity: 0.93, popularity: 0.95, tags: ['Film Score', 'Epic Orchestral'], rationale: 'Dominant affinity with prestige genre audiences; proven trailer-cue conversion.' },
    { name: 'Max Richter', affinity: 0.88, popularity: 0.74, tags: ['Neo-Classical', 'Contemplative'], rationale: 'Strong crossover with arthouse and streaming-drama audiences; high sync licensing efficiency.' },
    { name: 'Vangelis', affinity: 0.85, popularity: 0.79, tags: ['Synth Score', 'Legacy Icon'], rationale: 'Nostalgia lever for 35+ cohorts; catalogue licensing reinforces genre authenticity.' },
    { name: 'Daft Punk', affinity: 0.81, popularity: 0.92, tags: ['Electronic', 'Pop Crossover'], rationale: 'Broad-reach electronic affinity; strong for teaser campaigns targeting under-35s.' },
    { name: 'Hildur Guðnadóttir', affinity: 0.78, popularity: 0.66, tags: ['Avant-Garde Score', 'Awards Pedigree'], rationale: 'Awards-circuit credibility; signals auteur intent to critics and guild voters.' },
    { name: 'Ludovico Einaudi', affinity: 0.74, popularity: 0.83, tags: ['Minimalist Piano', 'Streaming Native'], rationale: 'Exceptional playlist penetration; low-cost emotional anchor for social cut-downs.' },
  ],
  'urn:entity:destination': [
    { name: 'Tokyo, Japan', affinity: 0.92, popularity: 0.94, tags: ['Neon Metropolis', 'Tech Culture'], rationale: 'Highest visual-identity overlap; strong international box-office uplift in APAC.' },
    { name: 'Reykjavík, Iceland', affinity: 0.86, popularity: 0.69, tags: ['Sublime Landscape', 'Production Incentives'], rationale: '35% production rebate; landscapes over-index with prestige-drama audiences.' },
    { name: 'Edinburgh, Scotland', affinity: 0.83, popularity: 0.77, tags: ['Historic Architecture', 'Period Authenticity'], rationale: 'Period-accurate streetscapes; tourism-board co-marketing precedent.' },
    { name: 'Los Angeles, USA', affinity: 0.79, popularity: 0.97, tags: ['Industry Hub', 'Domestic Core'], rationale: 'Maximum logistics efficiency; domestic audience familiarity reduces marketing friction.' },
    { name: 'Berlin, Germany', affinity: 0.77, popularity: 0.81, tags: ['Brutalist Modern', 'Creative Economy'], rationale: 'Studio Babelsberg infrastructure and German Federal Film Fund eligibility.' },
    { name: 'Kyoto, Japan', affinity: 0.72, popularity: 0.75, tags: ['Heritage Craft', 'Contemplative'], rationale: 'Distinctive aesthetic signature; strong affinity with contemplative-drama viewers.' },
  ],
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Build a JSON response with standard headers. */
function respond(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...BASE_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  };
}

/** Clamp a number into [min, max]. */
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Round to a fixed number of decimal places. */
function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Deterministic 32-bit FNV-1a hash — used for stable per-anchor jitter. */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic jitter in [-spread, +spread] derived from a seed string. */
function jitter(seed, spread) {
  const unit = (hashString(seed) % 10000) / 10000; // [0, 1)
  return (unit * 2 - 1) * spread;
}

/** True when the configured key is missing or a known placeholder. */
function isMockKey(key) {
  if (typeof key !== 'string') return true;
  return MOCK_KEY_SENTINELS.has(key.trim().toLowerCase());
}

/** Normalise and validate the anchor title. Returns null if unusable. */
function sanitizeAnchor(raw) {
  if (typeof raw !== 'string') return null;
  // Strip control characters and collapse whitespace.
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_ANCHOR_LENGTH);
}

/** fetch() with a hard timeout. */
async function fetchWithTimeout(url, options, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Derive executive summary metrics from a normalised result set.
 *   alignmentIndex  — mean affinity scaled to 0–100 (higher = stronger cultural fit)
 *   cultureRisk     — inverse of alignment, weighted by affinity dispersion
 *   verdict         — GREENLIGHT / CONDITIONAL / HIGH RISK
 */
function buildSummary(results) {
  const affinities = results.map((r) => r.affinity).filter((a) => typeof a === 'number');
  if (affinities.length === 0) {
    return { alignmentIndex: null, cultureRiskScore: null, dispersion: null, verdict: 'INSUFFICIENT SIGNAL', sampleSize: 0 };
  }
  const mean = affinities.reduce((s, a) => s + a, 0) / affinities.length;
  const variance = affinities.reduce((s, a) => s + (a - mean) ** 2, 0) / affinities.length;
  const dispersion = Math.sqrt(variance);

  const alignmentIndex = Math.round(clamp(mean, 0, 1) * 100);
  // Dispersion penalty: a scattered affinity profile is a less predictable audience.
  const cultureRiskScore = Math.round(clamp((1 - mean) * 100 + dispersion * 120, 0, 100));

  let verdict = 'HIGH RISK';
  if (cultureRiskScore <= 25) verdict = 'GREENLIGHT';
  else if (cultureRiskScore <= 45) verdict = 'CONDITIONAL';

  return {
    alignmentIndex,
    cultureRiskScore,
    dispersion: round(dispersion, 3),
    verdict,
    sampleSize: affinities.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Mock mode                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Build a deterministic, domain-tailored simulated payload.
 * @param {string} anchor        Sanitised anchor title.
 * @param {string} targetDomain  Validated Qloo URN.
 * @param {string} reason        Machine-readable reason mock mode was used.
 */
function buildMockPayload(anchor, targetDomain, reason) {
  const seedBase = `${anchor.toLowerCase()}|${targetDomain}`;
  const library = MOCK_LIBRARY[targetDomain] || MOCK_LIBRARY[DEFAULT_DOMAIN];

  const results = library
    .map((entry) => {
      const affinity = round(clamp(entry.affinity + jitter(`${seedBase}|a|${entry.name}`, 0.06), 0.4, 0.99), 3);
      const popularity = round(clamp(entry.popularity + jitter(`${seedBase}|p|${entry.name}`, 0.03), 0.3, 0.99), 3);
      return {
        name: entry.name,
        entityId: `mock:${targetDomain.split(':').pop()}:${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
        affinity,
        popularity,
        tags: entry.tags,
        rationale: entry.rationale,
      };
    })
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, RESULT_LIMIT);

  return {
    mode: 'mock',
    reason,
    anchor: { title: anchor, entityId: null },
    targetDomain,
    domainLabel: DOMAINS[targetDomain],
    generatedAt: new Date().toISOString(),
    summary: buildSummary(results),
    results,
  };
}

/* -------------------------------------------------------------------------- */
/* Live mode                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a free-text film title to a Qloo entity ID via the Search API.
 * signal.interests.entities requires entity IDs, not titles.
 * @returns {Promise<{entityId: string, name: string}>}
 */
async function resolveAnchorEntity(anchor, apiKey) {
  const params = new URLSearchParams({ query: anchor, types: 'urn:entity:movie', take: '1' });
  const res = await fetchWithTimeout(`${QLOO_API_BASE}/search?${params.toString()}`, {
    method: 'GET',
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`search_http_${res.status}`);

  const data = await res.json();
  const first = Array.isArray(data?.results) ? data.results[0] : null;
  const entityId = first?.entity_id || first?.id;
  if (!entityId) throw new Error('anchor_not_found');
  return { entityId, name: first.name || anchor };
}

/**
 * Query Qloo Insights for cross-domain affinities to the anchor entity.
 * @returns {Promise<Array>} Normalised result rows.
 */
async function fetchInsights(anchorEntityId, targetDomain, apiKey) {
  const params = new URLSearchParams();
  params.set('filter.type', targetDomain);
  params.set('signal.interests.entities', anchorEntityId);
  params.set('take', String(RESULT_LIMIT));

  const res = await fetchWithTimeout(`${QLOO_API_BASE}/v2/insights?${params.toString()}`, {
    method: 'GET',
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`insights_http_${res.status}`);

  const data = await res.json();
  const entities = Array.isArray(data?.results?.entities) ? data.results.entities : [];
  if (entities.length === 0) throw new Error('insights_empty');

  return entities.slice(0, RESULT_LIMIT).map((e) => {
    const rawAffinity = e?.query?.affinity ?? e?.affinity;
    const tags = Array.isArray(e?.tags)
      ? e.tags.slice(0, 3).map((t) => t?.name).filter(Boolean)
      : [];
    return {
      name: e?.name || 'Unnamed entity',
      entityId: e?.entity_id || null,
      affinity: typeof rawAffinity === 'number' ? round(rawAffinity, 3) : null,
      popularity: typeof e?.popularity === 'number' ? round(e.popularity, 3) : null,
      tags,
      rationale: null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                     */
/* -------------------------------------------------------------------------- */

exports.handler = async (event) => {
  // 1. Method gate — GET only.
  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'method_not_allowed', message: 'Only GET is supported.' }, { Allow: 'GET' });
  }

  // 2. Parse and validate inputs.
  const query = event.queryStringParameters || {};
  const anchor = sanitizeAnchor(query.scriptAnchor);
  if (!anchor) {
    return respond(400, { error: 'invalid_request', message: 'Query parameter "scriptAnchor" (anchor film title) is required.' });
  }

  const requestedDomain = typeof query.targetDomain === 'string' ? query.targetDomain.trim() : '';
  if (requestedDomain && !Object.prototype.hasOwnProperty.call(DOMAINS, requestedDomain)) {
    return respond(400, {
      error: 'invalid_request',
      message: `Unsupported "targetDomain". Expected one of: ${Object.keys(DOMAINS).join(', ')}.`,
    });
  }
  const targetDomain = requestedDomain || DEFAULT_DOMAIN;

  // 3. Mode selection — fail fast to mock if no real key is configured.
  const apiKey = process.env.QLOO_HACKATHON_API_KEY;
  if (isMockKey(apiKey)) {
    return respond(200, buildMockPayload(anchor, targetDomain, 'api_key_not_configured'));
  }

  // 4. Live path, with graceful degradation on any failure.
  try {
    const anchorEntity = await resolveAnchorEntity(anchor, apiKey.trim());
    const results = await fetchInsights(anchorEntity.entityId, targetDomain, apiKey.trim());

    return respond(200, {
      mode: 'live',
      reason: null,
      anchor: { title: anchorEntity.name, entityId: anchorEntity.entityId },
      targetDomain,
      domainLabel: DOMAINS[targetDomain],
      generatedAt: new Date().toISOString(),
      summary: buildSummary(results),
      results,
    });
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'upstream_timeout' : String(err?.message || 'upstream_error');
    // Log server-side only; never leak the key or raw upstream body to clients.
    console.warn(`[qloo_bridge] Live request failed (${reason}); serving studio fallback.`);
    return respond(200, buildMockPayload(anchor, targetDomain, reason));
  }
};
