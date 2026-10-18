'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Force simulated mode for every handler test.
delete process.env.QLOO_HACKATHON_API_KEY;

const bridge = require('../netlify/functions/qloo_bridge');
const agent = require('../netlify/functions/agent');
const mcp = require('../netlify/functions/mcp');

const get = (params) => ({ httpMethod: 'GET', queryStringParameters: params });
const post = (body) => ({ httpMethod: 'POST', body: JSON.stringify(body) });
const parse = (res) => JSON.parse(res.body);

test('qloo_bridge: GET only, validates input, returns labelled simulated data', async () => {
  assert.equal((await bridge.handler({ httpMethod: 'POST' })).statusCode, 405);
  assert.equal((await bridge.handler(get({}))).statusCode, 400);
  assert.equal((await bridge.handler(get({ scriptAnchor: 'x', targetDomain: 'urn:entity:bogus' }))).statusCode, 400);

  const res = await bridge.handler(get({ scriptAnchor: 'Blade Runner 2049', targetDomain: 'urn:entity:artist' }));
  const body = parse(res);
  assert.equal(res.statusCode, 200);
  assert.equal(body.mode, 'mock');
  assert.equal(body.results.length, 6);
  assert.ok(body.summary.verdict);
  assert.equal(body.calls.length, 2);
});

test('agent: GET reports capabilities', async () => {
  const body = parse(await agent.handler({ httpMethod: 'GET' }));
  assert.equal(body.engine, 'autonomous-qloo-agent');
  assert.equal(body.qlooMode, 'simulated');
});

test('qloo_bridge: an unknown live title returns not found without a simulated recommendation', async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.QLOO_HACKATHON_API_KEY;
  process.env.QLOO_HACKATHON_API_KEY = 'test-live-key';
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  try {
    const res = await bridge.handler(get({ scriptAnchor: 'Unknown title' }));
    assert.equal(res.statusCode, 404);
    assert.equal(parse(res).error, 'not_found');
    assert.match(parse(res).message, /no film matching/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.QLOO_HACKATHON_API_KEY;
    else process.env.QLOO_HACKATHON_API_KEY = oldKey;
  }
});

test('MCP audience affinities stops when live Qloo cannot resolve any title', async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.QLOO_HACKATHON_API_KEY;
  const paths = [];
  process.env.QLOO_HACKATHON_API_KEY = 'test-live-key';
  globalThis.fetch = async (url) => { paths.push(new URL(url).pathname); return { ok: false, status: 404 }; };
  try {
    const reply = parse(await mcp.handler(post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'audience_affinities', arguments: { comparable_titles: ['Unknown A', 'Unknown B'], domain: 'urn:entity:brand' } } })));
    assert.equal(reply.result.isError, true);
    assert.deepEqual(reply.result.structuredContent.entities, []);
    assert.match(reply.result.structuredContent.error, /could not resolve/);
    assert.deepEqual(paths, ['/search', '/search']);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.QLOO_HACKATHON_API_KEY;
    else process.env.QLOO_HACKATHON_API_KEY = oldKey;
  }
});

test('MCP greenlight output discloses mixed data and simulated recommendation IDs', async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.QLOO_HACKATHON_API_KEY;
  process.env.QLOO_HACKATHON_API_KEY = 'test-live-key';
  globalThis.fetch = async (url) => new URL(url).pathname === '/search'
    ? { ok: true, json: async () => ({ results: [{ entity_id: 'real-film', name: 'Real Film' }] }) }
    : { ok: false, status: 401 };
  try {
    const reply = parse(await mcp.handler(post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'greenlight_analysis', arguments: { comparable_titles: ['Real Film'], domains: ['urn:entity:brand'] } } })));
    const result = reply.result.structuredContent;
    assert.equal(result.data_provenance, 'mixed live and simulated data');
    assert.equal(result.data_source_counts.mode, 'mixed');
    assert.notEqual(result.confidence, 'high');
    assert.ok(result.recommendations.length > 0);
    assert.ok(result.recommendations.every((r) => r.simulated && !r.qloo_verified));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.QLOO_HACKATHON_API_KEY;
    else process.env.QLOO_HACKATHON_API_KEY = oldKey;
  }
});

test('agent: rejects bad methods, bad JSON, and briefs without anchors', async () => {
  assert.equal((await agent.handler({ httpMethod: 'DELETE' })).statusCode, 405);
  assert.equal((await agent.handler({ httpMethod: 'POST', body: '{nope' })).statusCode, 400);
  assert.equal((await agent.handler(post({ brief: { anchors: [] } }))).statusCode, 400);
});

test('agent: a full session completes through the HTTP handler with echoed state', async () => {
  const brief = { title: 'T', anchors: ["The King's Speech", 'The Favourite'], domains: ['urn:entity:destination'], script: 'royal period drama' };
  let state = null;
  let body;
  for (let i = 0; i < 30; i += 1) {
    const res = await agent.handler(post({ brief, state }));
    assert.equal(res.statusCode, 200);
    body = parse(res);
    if (body.status === 'done') break;
    state = body.state;
  }
  assert.equal(body.status, 'done');
  assert.match(body.memo.executiveSummary, /T scores/);
  assert.equal(body.evidence.dataProvenance.mode, 'simulated');
});

test('mcp: initialize, tools/list, tools/call, notifications, and errors', async () => {
  const init = parse(await mcp.handler(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })));
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.capabilities.tools);

  const note = await mcp.handler(post({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(note.statusCode, 202);

  const list = parse(await mcp.handler(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })));
  assert.deepEqual(list.result.tools.map((t) => t.name), ['greenlight_analysis', 'audience_affinities']);

  const call = parse(await mcp.handler(post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'greenlight_analysis', arguments: { title: 'X', comparable_titles: ['Arrival', 'Her'] } } })));
  assert.equal(call.result.isError, undefined);
  assert.ok(call.result.structuredContent.verdict);
  assert.ok(call.result.structuredContent.recommendations.length > 0);

  const aff = parse(await mcp.handler(post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'audience_affinities', arguments: { comparable_titles: ['Arrival'], domain: 'urn:entity:artist' } } })));
  assert.ok(aff.result.structuredContent.entities.length > 0);

  const bad = parse(await mcp.handler(post({ jsonrpc: '2.0', id: 5, method: 'nope' })));
  assert.equal(bad.error.code, -32601);
  assert.equal((await mcp.handler({ httpMethod: 'POST', body: '{' })).statusCode, 400);
});
