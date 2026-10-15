'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Force simulated mode for every handler test.
delete process.env.QLOO_HACKATHON_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const bridge = require('../netlify/functions/qloo_bridge');
const agent = require('../netlify/functions/agent');
const baseline = require('../netlify/functions/baseline');

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
  assert.equal(body.engine, 'scripted');
  assert.equal(body.qlooMode, 'simulated');
});

test('agent: rejects bad methods, bad JSON, and briefs without anchors', async () => {
  assert.equal((await agent.handler({ httpMethod: 'DELETE' })).statusCode, 405);
  assert.equal((await agent.handler({ httpMethod: 'POST', body: '{nope' })).statusCode, 400);
  assert.equal((await agent.handler(post({ brief: { anchors: [] } }))).statusCode, 400);
});

test('agent: a full scripted session completes through the HTTP handler', async () => {
  const brief = { title: 'T', anchors: ["The King's Speech", 'The Favourite'], domains: ['urn:entity:destination'], script: 'royal period drama' };
  let state = null;
  let body;
  for (let i = 0; i < 10; i += 1) {
    const res = await agent.handler(post({ brief, state }));
    assert.equal(res.statusCode, 200);
    body = parse(res);
    if (body.status === 'done') break;
    state = body.state;
    assert.equal(state.engine, 'scripted');
  }
  assert.equal(body.status, 'done');
  assert.ok(body.memo.executive_summary.includes('T'));
});

test('baseline: reports unavailable without an LLM key', async () => {
  const body = parse(await baseline.handler(post({ brief: { anchors: ['Dune'] } })));
  assert.equal(body.available, false);
});

test('baseline: parses structured guesses from an injected client', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-key';
  baseline.__setClientFactory(() => ({
    messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ 'urn:entity:brand': ['Nike', 'Apple'] }) }] }) },
  }));
  try {
    const body = parse(await baseline.handler(post({ brief: { anchors: ['Dune'], domains: ['urn:entity:brand'] } })));
    assert.equal(body.available, true);
    assert.deepEqual(body.guesses['urn:entity:brand'], ['Nike', 'Apple']);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});
