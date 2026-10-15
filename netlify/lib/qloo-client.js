/**
 * CultureRisk AI — live Qloo Taste AI client.
 *
 * Thin, dependency-free wrapper over the three Qloo hackathon endpoints the
 * product uses:
 *
 *   GET /search        free-text → entity IDs        (types=<urn>)
 *   GET /v2/tags       free-text → tag IDs           (filter.query=<text>)
 *   GET /v2/insights   signals → ranked affinities   (filter.type, signal.interests.*)
 *
 * All responses are normalised into a stable internal shape so the rest of the
 * system never depends on raw upstream field names. Normalisation is tolerant:
 * it accepts the documented field names plus common variants, and rescales
 * 0–100 scores to 0–1.
 *
 * Every failure throws QlooError with a machine-readable `code`; callers decide
 * whether to degrade to simulated data (see qloo-service.js).
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

/** Normalise one upstream entity object. */
function normalizeEntity(raw) {
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean).slice(0, 4)
    : [];
  const year = raw?.properties?.release_year ?? raw?.properties?.year ?? null;
  return {
    entityId: raw?.entity_id || raw?.id || null,
    name: raw?.name || 'Unnamed entity',
    type: raw?.types?.[0] || raw?.type || null,
    year: typeof year === 'number' ? year : null,
    affinity: unitScore(raw?.query?.affinity ?? raw?.affinity),
    popularity: unitScore(raw?.popularity),
    tags,
  };
}

function normalizeTag(raw) {
  return {
    tagId: raw?.id || raw?.tag_id || null,
    name: raw?.name || raw?.id || 'Unnamed tag',
    type: raw?.subtype || raw?.type || null,
  };
}

/**
 * Create a live client.
 * @param {{apiKey: string, baseUrl: string, timeoutMs: number, fetchImpl?: typeof fetch}} opts
 */
function createQlooClient({ apiKey, baseUrl, timeoutMs, fetchImpl = globalThis.fetch }) {
  if (!apiKey) throw new QlooError('no_api_key', 'Qloo API key is not configured.');

  async function get(path, params) {
    const url = `${baseUrl}${path}?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      throw new QlooError(err?.name === 'AbortError' ? 'upstream_timeout' : 'upstream_network', err?.message);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new QlooError(`http_${res.status}`, `Qloo ${path} returned ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new QlooError('bad_json', `Qloo ${path} returned non-JSON`);
    }
  }

  return {
    /** Resolve free text to entities of one type. */
    async search(query, type, take = 3) {
      const params = new URLSearchParams({ query, types: type, take: String(take) });
      const data = await get('/search', params);
      const results = Array.isArray(data?.results) ? data.results : [];
      return results.slice(0, take).map(normalizeEntity);
    },

    /** Resolve free text to Qloo tag IDs. */
    async tags(query, take = 5) {
      const params = new URLSearchParams();
      params.set('filter.query', query);
      params.set('take', String(take));
      const data = await get('/v2/tags', params);
      const list = data?.results?.tags ?? data?.results ?? data?.tags ?? [];
      return (Array.isArray(list) ? list : []).slice(0, take).map(normalizeTag);
    },

    /** Cross-domain affinities for a set of entity and/or tag signals. */
    async insights({ filterType, entityIds = [], tagIds = [], take = 8 }) {
      if (entityIds.length === 0 && tagIds.length === 0) {
        throw new QlooError('no_signal', 'At least one entity or tag signal is required.');
      }
      const params = new URLSearchParams();
      params.set('filter.type', filterType);
      if (entityIds.length) params.set('signal.interests.entities', entityIds.join(','));
      if (tagIds.length) params.set('signal.interests.tags', tagIds.join(','));
      params.set('take', String(take));
      const data = await get('/v2/insights', params);
      const entities = data?.results?.entities ?? data?.entities ?? [];
      if (!Array.isArray(entities) || entities.length === 0) {
        throw new QlooError('insights_empty', 'Qloo returned no entities for these signals.');
      }
      return entities.slice(0, take).map(normalizeEntity);
    },
  };
}

module.exports = { createQlooClient, QlooError, normalizeEntity, normalizeTag, unitScore };
