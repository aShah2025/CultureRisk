'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQlooClient, unitScore, QlooError } = require('../netlify/lib/qloo-client');
const { createQlooService } = require('../netlify/lib/qloo-service');
const { createMockQlooClient } = require('../netlify/lib/qloo-mock');

/** Build a fake fetch that records URLs and replies from a route table. */
function fakeFetch(routes) {
  const seen = [];
  const impl = async (url, init) => {
    seen.push({ url: new URL(url), headers: init.headers });
    const path = new URL(url).pathname;
    const reply = routes[path];
    if (!reply) return { ok: false, status: 404, json: async () => ({}) };
    if (reply instanceof Error) throw reply;
    return { ok: reply.status ? reply.status < 400 : true, status: reply.status || 200, json: async () => reply.body };
  };
  return { impl, seen };
}

const cfg = (fetchImpl) => ({ apiKey: 'k-123', baseUrl: 'https://q.test', timeoutMs: 1000, fetchImpl });

test('unitScore rescales 0-100 values and clamps', () => {
  assert.equal(unitScore(0.73), 0.73);
  assert.equal(unitScore(87), 0.87);
  assert.equal(unitScore(null), null);
});

test('insights sends documented query params and X-Api-Key header', async () => {
  const { impl, seen } = fakeFetch({
    '/v2/insights': { body: { results: { entities: [{ entity_id: 'E1', name: 'Porsche', popularity: 0.9, query: { affinity: 0.8 }, tags: [{ name: 'Luxury' }] }] } } },
  });
  const client = createQlooClient(cfg(impl));
  const out = await client.insights({ filterType: 'urn:entity:brand', entityIds: ['A', 'B'], tagIds: ['T'], take: 5 });

  const { url, headers } = seen[0];
  assert.equal(url.searchParams.get('filter.type'), 'urn:entity:brand');
  assert.equal(url.searchParams.get('signal.interests.entities'), 'A,B');
  assert.equal(url.searchParams.get('signal.interests.tags'), 'T');
  assert.equal(headers['X-Api-Key'], 'k-123');
  assert.deepEqual(out[0], { entityId: 'E1', name: 'Porsche', type: null, year: null, affinity: 0.8, popularity: 0.9, tags: ['Luxury'] });
});

test('insights throws QlooError on empty results and HTTP errors', async () => {
  const empty = createQlooClient(cfg(fakeFetch({ '/v2/insights': { body: { results: { entities: [] } } } }).impl));
  await assert.rejects(empty.insights({ filterType: 'urn:entity:brand', entityIds: ['A'] }), (e) => e instanceof QlooError && e.code === 'insights_empty');

  const denied = createQlooClient(cfg(fakeFetch({ '/v2/insights': { status: 403, body: {} } }).impl));
  await assert.rejects(denied.insights({ filterType: 'urn:entity:brand', entityIds: ['A'] }), (e) => e.code === 'http_403');
});

test('search normalises results', async () => {
  const { impl, seen } = fakeFetch({ '/search': { body: { results: [{ entity_id: 'M1', name: 'Blade Runner 2049', properties: { release_year: 2017 } }] } } });
  const out = await createQlooClient(cfg(impl)).search('Blade Runner 2049', 'urn:entity:movie', 1);
  assert.equal(seen[0].url.searchParams.get('types'), 'urn:entity:movie');
  assert.equal(out[0].entityId, 'M1');
  assert.equal(out[0].year, 2017);
});

test('service uses simulated data when no key is configured', async () => {
  const svc = createQlooService({ config: { apiKey: null } });
  assert.equal(svc.mode, 'simulated');
  const r = await svc.insights({ filterType: 'urn:entity:artist', entityIds: ['x'], take: 6 });
  assert.equal(r.provenance, 'simulated');
  assert.equal(r.data.length, 6);
  assert.equal(svc.calls[0].endpoint, '/v2/insights');
});

test('service falls back per call when live Qloo fails, recording the failure', async () => {
  const failing = { insights: async () => { throw new QlooError('http_500'); } };
  const svc = createQlooService({ config: { apiKey: 'k' }, liveClient: failing });
  const r = await svc.insights({ filterType: 'urn:entity:brand', entityIds: ['A'], take: 4 });
  assert.equal(r.provenance, 'fallback');
  assert.equal(r.failure, 'http_500');
  assert.equal(svc.calls[0].provenance, 'fallback');
});

test('service routes simulated IDs straight to the simulator', async () => {
  let liveCalled = false;
  const live = { insights: async () => { liveCalled = true; return []; } };
  const svc = createQlooService({ config: { apiKey: 'k' }, liveClient: live });
  await svc.insights({ filterType: 'urn:entity:brand', entityIds: ['mock:movie:x'] });
  assert.equal(liveCalled, false);
});

test('simulator is deterministic and anchor-sensitive', async () => {
  const mock = createMockQlooClient();
  const a1 = await mock.insights({ filterType: 'urn:entity:brand', entityIds: ['A'], take: 6 });
  const a2 = await mock.insights({ filterType: 'urn:entity:brand', entityIds: ['A'], take: 6 });
  const b = await mock.insights({ filterType: 'urn:entity:brand', entityIds: ['B'], take: 6 });
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1.map((e) => e.name), b.map((e) => e.name));
  assert.ok(a1.every((e) => e.entityId.startsWith('mock:')));
});
