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
 * Every call is appended to an audit log (`calls`) so the UI can show judges
 * exactly which Qloo endpoints were hit, with which signals, and what came
 * back — the evidence trail behind each recommendation.
 */

'use strict';

const { createQlooClient } = require('./qloo-client');
const { createMockQlooClient } = require('./qloo-mock');
const { qlooConfig } = require('./config');

/**
 * @param {object} [opts]
 * @param {object} [opts.config]    Override qlooConfig() (tests).
 * @param {object} [opts.liveClient] Inject a live client (tests).
 */
function createQlooService(opts = {}) {
  const config = opts.config || qlooConfig();
  const live = opts.liveClient || (config.apiKey ? createQlooClient(config) : null);
  const mock = createMockQlooClient();
  const calls = [];

  async function run(endpoint, signals, liveFn, mockFn) {
    const started = Date.now();
    let provenance = 'simulated';
    let failure = null;
    let data;

    if (live) {
      try {
        data = await liveFn(live);
        provenance = 'live';
      } catch (err) {
        failure = err?.code || 'upstream_error';
        console.warn(`[qloo] ${endpoint} live call failed (${failure}); using simulated data.`);
      }
    }
    if (data === undefined) {
      data = await mockFn(mock);
      provenance = live ? 'fallback' : 'simulated';
    }

    calls.push({ endpoint, signals, provenance, failure, count: Array.isArray(data) ? data.length : 0, ms: Date.now() - started });
    return { data, provenance, failure };
  }

  return {
    /** "live" when a key is configured, else "simulated". */
    mode: live ? 'live' : 'simulated',
    calls,

    search(query, type, take = 3) {
      return run('/search', { query, types: type }, (c) => c.search(query, type, take), (c) => c.search(query, type, take));
    },

    tags(query, take = 5) {
      return run('/v2/tags', { 'filter.query': query }, (c) => c.tags(query, take), (c) => c.tags(query, take));
    },

    insights(params) {
      const signals = {
        'filter.type': params.filterType,
        'signal.interests.entities': params.entityIds || [],
        'signal.interests.tags': params.tagIds || [],
      };
      // Simulated IDs are meaningless to the live API; route those straight to the simulator.
      const usesMockIds = [...(params.entityIds || []), ...(params.tagIds || [])].some((id) => String(id).startsWith('mock:'));
      return run(
        '/v2/insights',
        signals,
        usesMockIds ? () => Promise.reject(Object.assign(new Error('simulated_signal'), { code: 'simulated_signal' })) : (c) => c.insights(params),
        (c) => c.insights(params),
      );
    },
  };
}

module.exports = { createQlooService };
