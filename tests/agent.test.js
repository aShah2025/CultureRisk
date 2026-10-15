'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQlooService } = require('../netlify/lib/qloo-service');
const { createLedger } = require('../netlify/lib/agent/ledger');
const { executeTool, TOOL_DEFINITIONS } = require('../netlify/lib/agent/tools');
const { runClaudeStep } = require('../netlify/lib/agent/claude-runner');
const { runScriptedStep, buildPlan } = require('../netlify/lib/agent/scripted-runner');
const { normalizeBrief } = require('../netlify/lib/agent/prompt');

const simulatedQloo = () => createQlooService({ config: { apiKey: null } });
const brief = normalizeBrief({
  title: 'Test',
  anchors: ['Blade Runner 2049', 'Ghost in the Shell'],
  domains: ['urn:entity:brand', 'urn:entity:artist'],
  script: 'A neon cyberpunk detective story.',
}).brief;
const config = { model: 'claude-opus-5-5', effort: 'medium', requestTimeoutMs: 1000, maxSteps: 6 };

test('every tool schema is strict-mode compatible', () => {
  for (const tool of TOOL_DEFINITIONS) {
    assert.equal(tool.strict, true, tool.name);
    assert.equal(tool.input_schema.additionalProperties, false, tool.name);
    assert.deepEqual([...tool.input_schema.required].sort(), Object.keys(tool.input_schema.properties).sort(), tool.name);
  }
});

test('normalizeBrief validates anchors and filters unknown domains', () => {
  assert.equal(normalizeBrief({ anchors: [] }).ok, false);
  const b = normalizeBrief({ anchors: 'A, B, C, D', domains: ['urn:entity:brand', 'urn:entity:bogus'] }).brief;
  assert.deepEqual(b.anchors, ['A', 'B', 'C']);
  assert.deepEqual(b.domains, ['urn:entity:brand']);
});

test('tools write resolved anchors and domain evidence to the ledger', async () => {
  const ledger = createLedger();
  const qloo = simulatedQloo();
  const r1 = await executeTool('resolve_entities', { queries: ['Dune'], entity_type: 'urn:entity:movie' }, { qloo, ledger });
  assert.equal(r1.isError, false);
  assert.equal(ledger.anchors.length, 1);

  const r2 = await executeTool('get_audience_affinities', { target_domain: 'urn:entity:brand', entity_ids: [ledger.anchors[0].entityId], tag_ids: [] }, { qloo, ledger });
  assert.equal(r2.isError, false);
  assert.ok(ledger.domains['urn:entity:brand'].length > 0);
  assert.ok(JSON.parse(r2.content).profile.alignment > 0);
});

test('tool input errors are returned to the model, not thrown', async () => {
  const r = await executeTool('stress_test_comps', { entity_ids: ['one'], labels: [], target_domain: 'urn:entity:brand' }, { qloo: simulatedQloo(), ledger: createLedger() });
  assert.equal(r.isError, true);
  assert.match(JSON.parse(r.content).error, /at least 2/);
});

test('scripted engine runs its full plan to a grounded memo', async () => {
  const plan = buildPlan(brief);
  assert.deepEqual(plan, ['resolve', 'tags', 'affinity:urn:entity:brand', 'affinity:urn:entity:artist', 'coherence', 'memo']);

  let state = null;
  let result;
  const narration = [];
  for (let i = 0; i < plan.length; i += 1) {
    result = await runScriptedStep({ brief, state, qloo: simulatedQloo() });
    narration.push(...result.events.filter((e) => e.type === 'narration').map((e) => e.text));
    state = result.state;
  }
  assert.ok(narration.some((t) => t.includes('Brand Partnerships')));
  assert.ok(!narration.some((t) => t.includes('undefined')));
  assert.equal(result.status, 'done');
  assert.equal(result.memoAuthor, 'scripted');
  assert.ok(result.memo.recommendations.length >= 2);
  assert.equal(result.grounding.grounded, result.grounding.total);
  assert.ok(result.scorecard.coherence !== null);
  assert.ok(result.evidence.calls.length >= 5);
});

/** Fake Anthropic client that replays scripted assistant turns. */
function fakeClient(turns) {
  const requests = [];
  return {
    requests,
    beta: { messages: { create: async (params) => { requests.push(params); return turns.shift(); } } },
  };
}

const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });

test('claude engine executes tool calls, then finalises on submit_greenlight_memo', async () => {
  const client = fakeClient([
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: 'Resolve comps first.', signature: 'sig' },
        { type: 'text', text: 'Resolving the comparable titles.' },
        toolUse('t1', 'resolve_entities', { queries: ['Blade Runner 2049'], entity_type: 'urn:entity:movie' }),
      ],
    },
    {
      stop_reason: 'tool_use',
      content: [toolUse('t2', 'get_audience_affinities', { target_domain: 'urn:entity:brand', entity_ids: ['mock:movie:blade-runner-2049'], tag_ids: [] })],
    },
    {
      stop_reason: 'tool_use',
      content: [toolUse('t3', 'submit_greenlight_memo', {
        verdict: 'GREENLIGHT', confidence: 'medium', executive_summary: 's', audience_thesis: 'a', comp_coherence_finding: 'c',
        recommendations: [
          { domain: 'urn:entity:brand', name: 'Porsche', qloo_entity_id: 'mock:brand:porsche', action: 'x', evidence: 'y' },
          { domain: 'urn:entity:brand', name: 'Invented', qloo_entity_id: 'made-up-id', action: 'x', evidence: 'y' },
        ],
        risks: [], next_steps: [],
      })],
    },
  ]);
  const qloo = simulatedQloo();

  const s1 = await runClaudeStep({ brief, state: null, client, qloo, config });
  assert.equal(s1.status, 'continue');
  assert.deepEqual(s1.events.map((e) => e.type), ['thinking', 'narration', 'tool_call', 'tool_result']);
  // Assistant content (including the thinking block) is echoed back unchanged.
  assert.equal(s1.state.messages[1].content[0].signature, 'sig');
  assert.equal(s1.state.messages[2].content[0].tool_use_id, 't1');

  const s2 = await runClaudeStep({ brief, state: s1.state, client, qloo: simulatedQloo(), config });
  assert.equal(s2.status, 'continue');

  const s3 = await runClaudeStep({ brief, state: s2.state, client, qloo: simulatedQloo(), config });
  assert.equal(s3.status, 'done');
  assert.equal(s3.memoAuthor, 'claude');
  // Grounding check flags the invented entity.
  assert.deepEqual(s3.memo.recommendations.map((r) => r.grounded), [true, false]);
  assert.equal(s3.grounding.grounded, 1);

  const req = client.requests[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual(req.thinking, { type: 'adaptive', display: 'summarized' });
  assert.equal(req.fallbacks, 'default');
});

test('claude engine surfaces refusals as non-retryable errors', async () => {
  const client = fakeClient([{ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }]);
  const r = await runClaudeStep({ brief, state: null, client, qloo: simulatedQloo(), config });
  assert.equal(r.status, 'error');
  assert.equal(r.retryable, false);
});

test('claude engine nudges when the model ends its turn without submitting', async () => {
  const client = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done thinking.' }] }]);
  const r = await runClaudeStep({ brief, state: null, client, qloo: simulatedQloo(), config });
  assert.equal(r.status, 'continue');
  assert.match(r.state.messages.at(-1).content, /submit_greenlight_memo/);
});

test('claude engine composes from evidence when the step budget is exhausted', async () => {
  const r = await runClaudeStep({ brief, state: { messages: [{ role: 'user', content: 'x' }], ledger: createLedger(), step: config.maxSteps }, client: fakeClient([]), qloo: simulatedQloo(), config });
  assert.equal(r.status, 'done');
  assert.equal(r.memoAuthor, 'scripted');
});
