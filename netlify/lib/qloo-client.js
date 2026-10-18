/**
 * CultureRisk AI — live Qloo client.
 *
 * Dependency-free wrapper over the Qloo hackathon API (https://hackathon.api.qloo.com),
 * using only documented endpoints and parameters:
 *
 *   GET /search                 title → entity IDs                    (query, types, take)
 *   GET /v2/tags                theme → tag IDs                       (filter.query, feature.typo_tolerance)
 *   GET /v2/insights            cross-domain affinities               (filter.type=<entity urn>, signal.interests.*,
 *                                                                      feature.explainability, filter.popularity.max)
 *   GET /v2/insights            audience demographics                 (filter.type=urn:demographics)
 *   GET /v2/insights            taste analysis (audience-defining tags) (filter.type=urn:tag)
 *   GET /v2/analysis/compare    compare two entity groups             (a./b.signal.interests.entities)
 *
 * Every response is normalised into a stable internal shape so nothing
 * downstream depends on raw upstream field names. Normalisation is tolerant:
 * it accepts documented field names plus common variants, and rescales
 * 0–100 scores to 0–1.
 *
 * Failures throw QlooError with a machine-readable `code`; callers decide
 * whether to degrade (see qloo-service.js).
 */

'use strict';

class QlooError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'QlooError';
    this.code = code;
  }
}

/** Convert a 0–1 or 0–100 score into 0–1, or null when absent. */
function unitScore(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const scaled = value > 1 ? value / 100 : value;
  return Math.round(Math.min(1, Math.max(0, scaled)) * 1000) / 1000;
}

/**
 * Pull {entityId → contribution} pairs out of a per-result explainability
 * block, whatever its exact nesting (the docs describe normalised 0–1 scores
 * keyed by input entity).
 */
function parseExplainability(block) {
  const out = {};
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const id = node.entity_id || node.id;
    const score = node.score ?? node.value;
    if (typeof id === 'string' && typeof score === 'number') out[id] = Math.round(score * 1000) / 1000;
    Object.values(node).forEach(visit);
  };
  visit(block);
  return Object.keys(out).length ? out : null;
}

/** Normalise one upstream entity object. */
function normalizeEntity(raw) {
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean).slice(0, 4)
    : [];
  const year = raw?.properties?.release_year ?? raw?.properties?.year ?? null;
  const growth = raw?.query?.measurements?.audience_growth;
  const image = raw?.properties?.image?.url;
  return {
    entityId: raw?.entity_id || raw?.id || null,
    name: raw?.name || 'Unnamed entity',
    type: raw?.subtype || raw?.types?.[0] || raw?.type || null,
    year: typeof year === 'number' ? year : null,
    disambiguation: raw?.disambiguation || null,
    affinity: unitScore(raw?.query?.affinity ?? raw?.affinity),
    popularity: unitScore(raw?.popularity),
    audienceGrowth: typeof growth === 'number' ? Math.round(growth * 1000) / 1000 : null,
    explainability: parseExplainability(raw?.query?.explainability),
    image: typeof image === 'string' && /^https:\/\//.test(image) ? image : null,
    tags,
  };
}

function normalizeTag(raw) {
  return {
    tagId: raw?.tag_id || raw?.id || raw?.tag_value || null,
    name: raw?.name || raw?.id || 'Unnamed tag',
    type: raw?.subtype || raw?.type || null,
    affinity: unitScore(raw?.query?.affinity ?? raw?.affinity),
  };
}

/** Demographic block: {id, age:{bucket:score}, gender:{male,female}} with scores in [-1, 1]. */
function normalizeDemographics(raw) {
  const age = raw?.query?.age && typeof raw.query.age === 'object' ? raw.query.age : {};
  const gender = raw?.query?.gender && typeof raw.query.gender === 'object' ? raw.query.gender : {};
  const clean = (obj) => Object.fromEntries(
    Object.entries(obj).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, Math.round(v * 100) / 100]),
  );
  return { id: raw?.entity_id || raw?.id || null, age: clean(age), gender: clean(gender) };
}

/**
 * Create a live client.
 * @param {{apiKey: string, baseUrl: string, timeoutMs: number, fetchImpl?: typeof fetch}} opts
 */
function createQlooClient({ apiKey, baseUrl, timeoutMs, fetchImpl = globalThis.fetch, sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!apiKey) throw new QlooError('no_api_key', 'Qloo API key is not configured.');

  async function get(path, params) {
    const url = `${baseUrl}${path}?${params.toString()}`;
    const controller = new AbortController();
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
          signal: controller.signal,
        });
        // Retry a brief throttle or service interruption once, within the same
        // total deadline. Longer Retry-After values fall back without hammering Qloo.
        if (attempt === 0 && (res.status === 429 || res.status === 503)) {
          const retryAfter = res.headers?.get('retry-after');
          const seconds = retryAfter == null ? NaN : Number(retryAfter);
          const date = retryAfter == null ? NaN : Date.parse(retryAfter);
          const delay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
            : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 1000;
          if (delay <= 2000 && Date.now() + delay < deadline) {
            await res.body?.cancel();
            await sleepImpl(delay);
            if (controller.signal.aborted) throw new QlooError('upstream_timeout');
            continue;
          }
        }
        if (!res.ok) throw new QlooError(`http_${res.status}`, `Qloo ${path} returned ${res.status}`);
        try {
          return await res.json();
        } catch (err) {
          if (controller.signal.aborted || err?.name === 'AbortError') throw new QlooError('upstream_timeout');
          throw new QlooError('bad_json', `Qloo ${path} returned non-JSON`);
        }
      }
    } catch (err) {
      if (err instanceof QlooError) throw err;
      throw new QlooError(controller.signal.aborted || err?.name === 'AbortError' ? 'upstream_timeout' : 'upstream_network', err?.message);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Shared builder for /v2/insights signal parameters. */
  function signalParams(filterType, { entityIds = [], tagIds = [], take }) {
    if (entityIds.length === 0 && tagIds.length === 0) {
      throw new QlooError('no_signal', 'At least one entity or tag signal is required.');
    }
    const params = new URLSearchParams();
    params.set('filter.type', filterType);
    if (entityIds.length) params.set('signal.interests.entities', entityIds.join(','));
    if (tagIds.length) params.set('signal.interests.tags', tagIds.join(','));
    if (take) params.set('take', String(take));
    return params;
  }

  return {
    /** Resolve free text to entities of one type. */
    async search(query, type, take = 3) {
      const params = new URLSearchParams({ query, types: type, take: String(take) });
      let data;
      try {
        data = await get('/search', params);
      } catch (err) {
        // Qloo documents 404 as a valid "No results" search response.
        if (err.code === 'http_404') return [];
        throw err;
      }
      const results = Array.isArray(data?.results) ? data.results : [];
      return results.slice(0, take).map(normalizeEntity);
    },

    /** Resolve free text to Qloo tag IDs (typo tolerant). */
    async tags(query, take = 5, parentTypes = ['urn:entity:movie']) {
      const params = new URLSearchParams();
      params.set('filter.query', query);
      if (parentTypes.length) params.set('filter.parents.types', parentTypes.join(','));
      params.set('feature.typo_tolerance', 'true');
      params.set('take', String(take));
      const data = await get('/v2/tags', params);
      const list = data?.results?.tags ?? data?.results ?? [];
      return (Array.isArray(list) ? list : []).slice(0, take).map(normalizeTag);
    },

    /**
     * Cross-domain affinities.
     * @param {object} q
     * @param {string} q.filterType      Output entity URN.
     * @param {string[]} [q.entityIds]   signal.interests.entities
     * @param {string[]} [q.tagIds]      signal.interests.tags
     * @param {number} [q.take]
     * @param {boolean} [q.explain]      feature.explainability
     * @param {number} [q.popularityMax] filter.popularity.max (white-space hunting)
     */
    async insights({ filterType, entityIds = [], tagIds = [], take = 8, explain = false, popularityMax = null, popularityMin = null, excludeIds = [], filterTags = [], filterResults = [] }) {
      const params = signalParams(filterType, { entityIds, tagIds, take });
      if (filterTags.length) params.set('filter.tags', filterTags.join(','));
      if (filterResults.length) params.set('filter.results.entities', filterResults.join(','));
      if (explain) params.set('feature.explainability', 'true');
      if (typeof popularityMax === 'number') params.set('filter.popularity.max', String(popularityMax));
      if (typeof popularityMin === 'number') params.set('filter.popularity.min', String(popularityMin));
      if (excludeIds.length) params.set('filter.exclude.entities', excludeIds.join(','));
      const data = await get('/v2/insights', params);
      const entities = data?.results?.entities ?? [];
      if (!Array.isArray(entities) || entities.length === 0) {
        throw new QlooError('insights_empty', 'Qloo returned no entities for these signals.');
      }
      return entities.slice(0, take).map(normalizeEntity);
    },

    /** Age/gender affinity per input signal (filter.type=urn:demographics). */
    async demographics({ entityIds = [], tagIds = [] }) {
      const params = signalParams('urn:demographics', { entityIds, tagIds });
      const data = await get('/v2/insights', params);
      const list = data?.results?.demographics ?? [];
      if (!Array.isArray(list) || list.length === 0) throw new QlooError('demographics_empty');
      return list.map(normalizeDemographics);
    },

    /** Taste analysis: the tags that best describe an audience (filter.type=urn:tag). */
    async tasteTags({ entityIds = [], tagIds = [], take = 10, tagTypes = [], parentTypes = [] }) {
      const params = signalParams('urn:tag', { entityIds, tagIds, take });
      if (tagTypes.length) params.set('filter.tag.types', tagTypes.join(','));
      if (parentTypes.length) params.set('filter.parents.types', parentTypes.join(','));
      const data = await get('/v2/insights', params);
      const list = data?.results?.tags ?? [];
      if (!Array.isArray(list) || list.length === 0) throw new QlooError('tags_empty');
      return list.slice(0, take).map(normalizeTag);
    },

    /** Qloo-native comparison of two entity groups. */
    async compare({ a = [], b = [], take = 10 }) {
      if (!a.length || !b.length) throw new QlooError('no_signal', 'Both comparison groups need entities.');
      const params = new URLSearchParams();
      params.set('a.signal.interests.entities', a.join(','));
      params.set('b.signal.interests.entities', b.join(','));
      params.set('take', String(take));
      const data = await get('/v2/analysis/compare', params);
      const list = Array.isArray(data?.results) ? data.results : data?.results?.tags ?? data?.results?.entities ?? [];
      if (!Array.isArray(list) || list.length === 0) throw new QlooError('compare_empty');
      const seen = new Set();
      return list
        .map((r) => ({ name: r?.name || r?.tag_id || r?.entity_id || 'Unnamed', id: r?.tag_id || r?.entity_id || r?.id || null }))
        .filter((r) => { const k = r.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, take);
    },
  };
}

module.exports = {
  createQlooClient,
  QlooError,
  normalizeEntity,
  normalizeTag,
  normalizeDemographics,
  parseExplainability,
  unitScore,
};
