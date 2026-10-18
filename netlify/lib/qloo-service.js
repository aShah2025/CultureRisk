/**
 * CultureRisk AI — Qloo service facade (the product's data engine).
 *
 * Qloo is the single source of truth for every metric CultureRisk produces.
 * This facade wraps the live client with per-call resilience:
 *
 *   • No key configured        → simulated backend, provenance "simulated"
 *   • Live call succeeds       → provenance "live"
 *   • Live call fails/empty    → simulated backend, provenance "fallback",
 *                                with the failure code recorded
 *
 * Every call is appended to an audit log (`calls`), so the UI can show exactly
 * which Qloo endpoints were hit, with which parameters, and what came back:
 * the evidence trail behind each recommendation.
 */

'use strict';

const { createQlooClient } = require('./qloo-client');
const { createMockQlooClient } = require('./qloo-mock');
const { qlooConfig } = require('./config');

const isSimulatedId = (id) => String(id).startsWith('mock:');

/**
 * @param {object} [opts]
 * @param {object} [opts.config]     Override qlooConfig() (tests).
 * @param {object} [opts.liveClient] Inject a live client (tests).
 */
function createQlooService(opts = {}) {
  const config = opts.config || qlooConfig();
  const live = opts.liveClient || (config.apiKey ? createQlooClient(config) : null);
  const mock = createMockQlooClient();
  const calls = [];

  /**
   * @param {string} endpoint   Display label for the audit log.
   * @param {object} params     Qloo parameters, recorded verbatim.
   * @param {Function} invoke   (client) => Promise<data>
   * @param {string[]} ids      Signal IDs; simulated IDs skip the live API.
   */
  async function run(endpoint, params, invoke, ids = []) {
    const started = Date.now();
    let provenance = 'simulated';
    let failure = null;
    let data;

    if (live) {
      if (ids.some(isSimulatedId)) {
        failure = 'simulated_signal';
      } else {
        try {
          data = await invoke(live);
          provenance = 'live';
        } catch (err) {
          failure = err?.code || 'upstream_error';
          console.warn(`[qloo] ${endpoint} live call failed (${failure}); using simulated data.`);
        }
      }
    }
    if (data === undefined) {
      data = await invoke(mock);
      provenance = live ? 'fallback' : 'simulated';
    }

    calls.push({ endpoint, params, provenance, failure, count: Array.isArray(data) ? data.length : 0, ms: Date.now() - started });
    return { data, provenance, failure };
  }

  return {
    /** "live" when a key is configured, else "simulated". */
    mode: live ? 'live' : 'simulated',
    calls,

    search(query, type, take = 3) {
      return run('GET /search', { query, types: type, take }, (c) => c.search(query, type, take));
    },

    tags(query, take = 5) {
      return run('GET /v2/tags', { 'filter.query': query, 'feature.typo_tolerance': true, take }, (c) => c.tags(query, take));
    },

    insights(q) {
      const params = {
        'filter.type': q.filterType,
        'signal.interests.entities': q.entityIds || [],
        'signal.interests.tags': q.tagIds || [],
        ...(q.explain ? { 'feature.explainability': true } : {}),
        ...(typeof q.popularityMax === 'number' ? { 'filter.popularity.max': q.popularityMax } : {}),
        take: q.take,
      };
      return run('GET /v2/insights', params, (c) => c.insights(q), [...(q.entityIds || []), ...(q.tagIds || [])]);
    },

    demographics(q) {
      const params = { 'filter.type': 'urn:demographics', 'signal.interests.entities': q.entityIds || [], 'signal.interests.tags': q.tagIds || [] };
      return run('GET /v2/insights', params, (c) => c.demographics(q), [...(q.entityIds || []), ...(q.tagIds || [])]);
    },

    tasteTags(q) {
      const params = { 'filter.type': 'urn:tag', 'signal.interests.entities': q.entityIds || [], 'signal.interests.tags': q.tagIds || [], take: q.take };
      return run('GET /v2/insights', params, (c) => c.tasteTags(q), [...(q.entityIds || []), ...(q.tagIds || [])]);
    },

    compare(q) {
      const params = { 'a.signal.interests.entities': q.a, 'b.signal.interests.entities': q.b, take: q.take };
      return run('GET /v2/analysis/compare', params, (c) => c.compare(q), [...q.a, ...q.b]);
    },
  };
}

module.exports = { createQlooService };
