/**
 * CultureRisk AI — runtime configuration.
 *
 * Every tunable lives here so functions and tests read one source of truth.
 * Values are resolved lazily (per call) so tests can mutate process.env.
 */

'use strict';

/** Values treated as "no real key configured" for any provider. */
const PLACEHOLDER_KEYS = new Set([
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
  'your-anthropic-api-key',
]);

/** Qloo output domains the product exposes, with cockpit labels. */
const DOMAINS = Object.freeze({
  'urn:entity:brand': 'Brand Partnerships',
  'urn:entity:artist': 'Soundtrack & Talent',
  'urn:entity:destination': 'Location & Tourism',
  'urn:entity:tv_show': 'Streaming Adjacency',
  'urn:entity:podcast': 'Podcast Media Buys',
});

/** Entity types accepted by Qloo's /search `types` parameter that the agent may use. */
const SEARCH_TYPES = Object.freeze([
  'urn:entity:movie',
  'urn:entity:tv_show',
  'urn:entity:artist',
  'urn:entity:brand',
  'urn:entity:destination',
  'urn:entity:person',
  'urn:entity:podcast',
  'urn:entity:book',
  'urn:entity:video_game',
]);

const DEFAULT_DOMAIN = 'urn:entity:brand';

function isPlaceholderKey(key) {
  if (typeof key !== 'string') return true;
  return PLACEHOLDER_KEYS.has(key.trim().toLowerCase());
}

function qlooConfig() {
  const apiKey = process.env.QLOO_HACKATHON_API_KEY;
  return {
    apiKey: isPlaceholderKey(apiKey) ? null : apiKey.trim(),
    baseUrl: (process.env.QLOO_API_BASE || 'https://hackathon.api.qloo.com').replace(/\/+$/, ''),
    timeoutMs: Number(process.env.QLOO_TIMEOUT_MS) || 7000,
  };
}

function agentConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return {
    apiKey: isPlaceholderKey(apiKey) ? null : apiKey.trim(),
    model: process.env.CULTURERISK_MODEL || 'claude-opus-5-5',
    effort: process.env.CULTURERISK_EFFORT || 'medium',
    // Netlify synchronous functions are capped at 30s; leave headroom for tool execution.
    requestTimeoutMs: Number(process.env.CULTURERISK_LLM_TIMEOUT_MS) || 24000,
    maxSteps: Number(process.env.CULTURERISK_MAX_STEPS) || 10,
    maxStateBytes: 600 * 1024,
  };
}

module.exports = {
  DOMAINS,
  SEARCH_TYPES,
  DEFAULT_DOMAIN,
  isPlaceholderKey,
  qlooConfig,
  agentConfig,
};
