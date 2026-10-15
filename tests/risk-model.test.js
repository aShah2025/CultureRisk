'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { domainProfile, whiteSpace, pairCoherence, compCoherence, scorecard, verdictFor } = require('../netlify/lib/risk-model');

const ent = (id, affinity, popularity = 0.5) => ({ entityId: id, name: id, affinity, popularity });

test('domainProfile computes alignment and dispersion from top results', () => {
  const p = domainProfile([ent('a', 0.9), ent('b', 0.7)]);
  assert.equal(p.alignment, 80);
  assert.equal(p.dispersion, 0.1);
  assert.equal(p.sampleSize, 2);
});

test('domainProfile ignores missing affinities', () => {
  const p = domainProfile([ent('a', null), ent('b', 0.6)]);
  assert.equal(p.alignment, 60);
  assert.equal(p.sampleSize, 1);
});

test('whiteSpace returns entities whose affinity exceeds popularity, largest gap first', () => {
  const ws = whiteSpace([ent('mass', 0.8, 0.95), ent('niche', 0.85, 0.4), ent('mid', 0.7, 0.6)]);
  assert.deepEqual(ws.map((w) => w.entityId), ['niche', 'mid']);
  assert.equal(ws[0].gap, 0.45);
});

test('pairCoherence is 1 for identical lists and 0 for disjoint lists', () => {
  const a = [ent('x', 0.9), ent('y', 0.8), ent('z', 0.7)];
  assert.equal(pairCoherence(a, a).coherence, 1);
  assert.equal(pairCoherence(a, [ent('p', 0.9), ent('q', 0.8)]).coherence, 0);
});

test('pairCoherence penalises rank disagreement on shared items', () => {
  const a = [ent('x', 0.9), ent('y', 0.8), ent('z', 0.7)];
  const reversed = [...a].reverse();
  const r = pairCoherence(a, reversed, 3);
  assert.equal(r.jaccard, 1);
  assert.ok(r.rankAgreement < 1);
  assert.ok(r.coherence < 1);
});

test('compCoherence requires two or more anchors and averages pairs', () => {
  assert.equal(compCoherence([{ anchor: 'A', entities: [] }]), null);
  const lists = [
    { anchor: 'A', entities: [ent('x', 0.9), ent('y', 0.8)] },
    { anchor: 'B', entities: [ent('x', 0.9), ent('y', 0.8)] },
    { anchor: 'C', entities: [ent('p', 0.9)] },
  ];
  const r = compCoherence(lists);
  assert.equal(r.pairs.length, 3);
  assert.ok(r.coherence > 0 && r.coherence < 1);
});

test('verdict thresholds', () => {
  assert.equal(verdictFor(10), 'GREENLIGHT');
  assert.equal(verdictFor(40), 'CONDITIONAL GREENLIGHT');
  assert.equal(verdictFor(55), 'REWORK');
  assert.equal(verdictFor(90), 'PASS');
});

test('scorecard: low coherence raises risk versus high coherence', () => {
  const domains = { 'urn:entity:brand': [ent('a', 0.85), ent('b', 0.82), ent('c', 0.8)] };
  const coherent = scorecard({ domains, coherence: 0.9, liveData: true });
  const divergent = scorecard({ domains, coherence: 0.1, liveData: true });
  assert.ok(divergent.cultureRiskScore > coherent.cultureRiskScore);
  assert.equal(coherent.coherence, 90);
});

test('scorecard with no evidence reports insufficient signal', () => {
  const card = scorecard({ domains: {} });
  assert.equal(card.verdict, 'INSUFFICIENT SIGNAL');
  assert.equal(card.cultureRiskScore, null);
});

const { demographicSimilarity, demographicCoherence, demographicHeadline } = require('../netlify/lib/risk-model');

test('demographic similarity: identical → 1, opposite → 0', () => {
  const young = { age: { '24_and_younger': 0.6, '55_and_older': -0.5 }, gender: { male: 0.2 } };
  const old = { age: { '24_and_younger': -0.6, '55_and_older': 0.5 }, gender: { male: -0.2 } };
  assert.equal(demographicSimilarity(young, young), 1);
  assert.equal(demographicSimilarity(young, old), 0);
  assert.equal(demographicCoherence([young]), null);
});

test('demographic headline picks the peak age bucket and gender lean', () => {
  const h = demographicHeadline({ age: { '25_to_29': 0.4, '45_to_54': -0.2 }, gender: { male: -0.2, female: 0.2 } });
  assert.equal(h.peakAge, '25_to_29');
  assert.equal(h.genderLean, 'female');
});

test('scorecard weights only the components that are present', () => {
  const domains = { 'urn:entity:brand': [{ entityId: 'a', affinity: 0.8, popularity: 0.5 }] };
  const card = scorecard({ domains, coherence: 0.2, conceptFit: 0.9, demographics: null });
  assert.deepEqual(card.components.map((c) => c.key), ['alignment', 'coherence', 'conceptFit']);
  assert.equal(Math.round(card.components.reduce((s, c) => s + c.weight, 0) * 100), 100);
});
