'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQlooService } = require('../netlify/lib/qloo-service');
const { createLedger } = require('../netlify/lib/agent/ledger');
const { normalizeBrief, extractThemes } = require('../netlify/lib/agent/brief');
const { candidates, nextAction, describePlan } = require('../netlify/lib/agent/policy');
const { runAgentStep, runToCompletion } = require('../netlify/lib/agent/runner');
const A = require('../netlify/lib/agent/actions');

const simulated = () => createQlooService({ config: { apiKey: null } });
const brief = (over = {}) => normalizeBrief({
  title: 'Test',
  anchors: ['Blade Runner 2049', 'Ghost in the Shell'],
  domains: ['urn:entity:brand', 'urn:entity:artist'],
  script: 'A neon cyberpunk detective story about memory.',
  ...over,
}).brief;

test('normalizeBrief validates anchors, dedupes, and filters unknown domains', () => {
  assert.equal(normalizeBrief({ anchors: [] }).ok, false);
  const b = normalizeBrief({ anchors: 'A, B, A, C, D', domains: ['urn:entity:brand', 'urn:entity:bogus'] }).brief;
  assert.deepEqual(b.anchors, ['A', 'B', 'C']);
  assert.deepEqual(b.domains, ['urn:entity:brand']);
});

test('extractThemes maps script language to tag probes with fallbacks', () => {
  const themes = extractThemes('A neon detective in a royal court');
  assert.deepEqual(themes.map((t) => t.query), ['cyberpunk', 'neo-noir', 'british royalty']);
  assert.ok(themes.every((t) => t.fallback));
  assert.deepEqual(extractThemes(''), []);
});

test('planner: single comp skips multi-comp checks; no themes skips concept work', () => {
  const b = brief({ anchors: ['Dune'], script: '' });
  const ledger = createLedger();
  ledger.actions.push('resolve');
  ledger.comps.push({ entityId: 'mock:movie:dune', name: 'Dune' });
  const ids = candidates(b, ledger).map((c) => c.id);
  assert.ok(!ids.includes('compare'));
  assert.ok(!ids.includes('concept'));
  assert.ok(!ids.includes('bridge'));
  assert.ok(ids.includes('sweep:urn:entity:brand'));
});

test('planner: divergence flags schedule a bridge search; weak/saturated domains schedule follow-ups', () => {
  const b = brief();
  const ledger = createLedger();
  ledger.comps.push({ entityId: 'a', name: 'A' }, { entityId: 'b', name: 'B' });
  assert.ok(!candidates(b, ledger).some((c) => c.id === 'bridge'));
  ledger.flags.divergent = true;
  ledger.flags['retry:urn:entity:brand'] = true;
  ledger.flags['probe:urn:entity:artist'] = true;
  const ids = candidates(b, ledger).map((c) => c.id);
  assert.ok(ids.includes('bridge'));
  assert.ok(ids.indexOf('retry:urn:entity:brand') === ids.indexOf('sweep:urn:entity:brand') + 1);
  assert.ok(ids.includes('probe:urn:entity:artist'));
});

test('planner aborts when no comp resolves', () => {
  const ledger = createLedger();
  ledger.flags.abort = 'none';
  assert.equal(nextAction(brief(), ledger), null);
});

test('describePlan reflects the brief', () => {
  const items = describePlan(brief()).map((i) => i.title);
  assert.ok(items.includes('Run Qloo\'s native comp comparison'));
  assert.ok(items.includes('Map Brand Partnerships'));
  assert.equal(items.at(-1), 'Synthesize the greenlight memo');
});

test('domain sweep flags a niche probe when every pick is mass-market', async () => {
  const ledger = createLedger();
  ledger.comps.push({ entityId: 'x', name: 'X' });
  const qloo = {
    calls: [],
    insights: async () => ({ data: [{ entityId: 'e1', name: 'Big', affinity: 0.8, popularity: 0.95 }, { entityId: 'e2', name: 'Bigger', affinity: 0.75, popularity: 0.97 }] }),
  };
  const r = await A.domainSweep('urn:entity:brand')({ ledger, qloo });
  assert.equal(ledger.flags['probe:urn:entity:brand'], true);
  assert.ok(r.decisions.some((d) => d.includes('niche')));
});

test('domain retry adopts the re-query only when alignment improves', async () => {
  const ledger = createLedger();
  ledger.comps.push({ entityId: 'x', name: 'X' });
  ledger.conceptTags.push({ tagId: 't', name: 'T' });
  ledger.domains['urn:entity:brand'] = { entities: [{ entityId: 'w', name: 'Weak', affinity: 0.4, popularity: 0.5 }] };
  const better = { calls: [], insights: async () => ({ data: [{ entityId: 's', name: 'Strong', affinity: 0.9, popularity: 0.5 }] }) };
  await A.domainRetry('urn:entity:brand')({ ledger, qloo: better });
  assert.equal(ledger.domains['urn:entity:brand'].entities[0].name, 'Strong');
  assert.equal(ledger.domains['urn:entity:brand'].retried, true);
});

test('explainability is aggregated into per-comp driver shares', () => {
  const shares = A.driverShares(
    [{ explainability: { a: 0.75, b: 0.25 } }, { explainability: { a: 0.25, b: 0.75 } }, { explainability: { a: 1, b: 0 } }],
    [{ entityId: 'a', name: 'A' }, { entityId: 'b', name: 'B' }],
  );
  assert.equal(shares.A, 0.67);
  assert.equal(shares.B, 0.33);
});

test('runner: first step emits the plan, an action, its Qloo calls, and observations', async () => {
  const r = await runAgentStep({ brief: brief(), state: null, qloo: simulated() });
  assert.equal(r.status, 'continue');
  const types = r.events.map((e) => e.type);
  assert.deepEqual(types.slice(0, 3), ['plan', 'action', 'calls']);
  assert.ok(types.includes('observation'));
  assert.equal(r.state.ledger.actions[0], 'resolve');
  assert.ok(r.progress.total > r.progress.done);
});

test('full session produces a grounded memo with every evidence section', async () => {
  const r = await runToCompletion({ brief: brief(), makeQloo: simulated });
  assert.equal(r.status, 'done');
  const { memo, scorecard, evidence, grounding } = r;
  assert.ok(['GREENLIGHT', 'CONDITIONAL GREENLIGHT', 'REWORK', 'PASS'].includes(memo.verdict));
  assert.equal(memo.verdict, scorecard.verdict);
  assert.ok(memo.recommendations.length >= 4);
  assert.equal(grounding.grounded, grounding.total);
  assert.ok(evidence.demographics.byComp.length === 2);
  assert.ok(evidence.coherence.value >= 0 && evidence.coherence.value <= 1);
  assert.ok(evidence.conceptFit);
  assert.ok(evidence.compare.shared.length >= 0);
  assert.ok(evidence.calls.length >= 10);
  assert.ok(evidence.calls.every((c) => c.provenance === 'simulated'));
  assert.ok(memo.risks.some((x) => x.risk.includes('simulated')));
  // Endpoints exercised across the session.
  const endpoints = new Set(evidence.calls.map((c) => `${c.endpoint} ${c.params['filter.type'] || ''}`.trim()));
  ['GET /search', 'GET /v2/tags', 'GET /v2/insights urn:tag', 'GET /v2/insights urn:demographics', 'GET /v2/analysis/compare', 'GET /v2/insights urn:entity:movie', 'GET /v2/insights urn:entity:brand']
    .forEach((e) => assert.ok(endpoints.has(e), `missing ${e}`));
});

test('session is deterministic for the same brief', async () => {
  const a = await runToCompletion({ brief: brief(), makeQloo: simulated });
  const b = await runToCompletion({ brief: brief(), makeQloo: simulated });
  assert.deepEqual(a.scorecard, b.scorecard);
  assert.deepEqual(a.memo.recommendations, b.memo.recommendations);
});
