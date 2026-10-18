/**
 * CultureRisk AI — runtime configuration.
 *
 * Every tunable lives here so functions and tests read one source of truth.
 * Values are resolved lazily (per call) so tests can mutate process.env.
 */

'use strict';

/** Values treated as "no real key configured". */
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
]);

/** Qloo output domains the product maps, with cockpit labels. */
const DOMAINS = Object.freeze({
  'urn:entity:brand': 'Brand Partnerships',
  'urn:entity:artist': 'Soundtrack & Talent',
  'urn:entity:destination': 'Location & Tourism',
  'urn:entity:tv_show': 'Streaming Adjacency',
  'urn:entity:podcast': 'Podcast Media Buys',
});

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
    timeoutMs: Number(process.env.QLOO_TIMEOUT_MS) || 12000,
  };
}

module.exports = { DOMAINS, DEFAULT_DOMAIN, isPlaceholderKey, qlooConfig };
