'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createLedger, recordCalls } = require('../netlify/lib/agent/ledger');
const { finalizeSession } = require('../netlify/lib/agent/synthesis');

// Load the browser ES modules without changing the server's CommonJS package type.
const renderModule = (async () => {
  const jsDir = path.join(__dirname, '../public/js');
  const dom = await fs.readFile(path.join(jsDir, 'dom.js'), 'utf8');
  const render = await fs.readFile(path.join(jsDir, 'render.js'), 'utf8');
  const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(url(render.replace("'./dom.js'", JSON.stringify(url(dom)))));
})();

const brief = { title: 'Coverage Test', anchors: ['Comp'], domains: ['urn:entity:brand'] };

function report(provenances) {
  const ledger = createLedger();
  ledger.comps.push({ entityId: 'comp', name: 'Comp', provenance: provenances[0] });
  ledger.domains['urn:entity:brand'] = {
    entities: [{ entityId: provenances.every((p) => p === 'live') ? 'qloo-brand' : 'mock:brand:example', name: 'Partner', affinity: 0.8, popularity: 0.4 }],
  };
  recordCalls(ledger, provenances.map((provenance) => ({ endpoint: 'GET /v2/insights', params: {}, count: 1, provenance })));
  return finalizeSession(brief, ledger);
}

for (const [mode, calls, label] of [
  ['live', ['live', 'live'], 'live'],
  ['mixed', ['live', 'fallback'], 'mixed live / simulated'],
  ['fallback', ['fallback', 'fallback'], 'simulated fallback'],
  ['simulated', ['simulated', 'simulated'], 'simulated'],
]) {
  test(`coverage HTML and text export clearly label ${mode} evidence`, async () => {
    const { renderCoverage, memoToMarkdown } = await renderModule;
    const result = report(calls);
    const html = renderCoverage(result, brief, '0001');
    const markdown = memoToMarkdown(brief, result);
    assert.ok(html.includes(`>${label}</span>`));
    assert.ok(markdown.includes(`**Data:** ${label} (`));
    assert.ok(markdown.includes(`${result.evidence.dataProvenance.live} live · ${result.evidence.dataProvenance.fallback} fallback`));
    if (mode === 'live') {
      assert.ok(html.includes('Qloo ID ✓ qloo-brand'));
      assert.ok(!html.includes('This coverage includes simulated signals'));
    } else {
      assert.ok(html.includes('This coverage includes simulated signals'));
      assert.ok(html.includes('Simulated ID mock:brand:example'));
      assert.ok(markdown.includes('Simulated ID `mock:brand:example`'));
      assert.ok(!html.includes('Qloo ID ✓ mock:'));
      assert.ok(!markdown.includes('Qloo ID ✓ `mock:'));
      assert.ok(!html.includes('Qloo Taste AI · <span class="prov prov-live">live</span>'));
    }
  });
}

test('legacy any-live evidence and quick scans use call provenance for visible data labels', async () => {
  const { renderCoverage, renderQuickScan, memoToMarkdown } = await renderModule;
  const result = report(['live', 'fallback']);
  delete result.evidence.dataProvenance;
  assert.equal(result.evidence.liveData, true);
  assert.ok(renderCoverage(result, brief, '0001').includes('>mixed live / simulated</span>'));
  assert.ok(memoToMarkdown(brief, result).includes('**Data:** mixed live / simulated'));
  const quick = renderQuickScan({ mode: 'live', calls: result.evidence.calls, summary: {}, results: [] });
  assert.ok(quick.includes('>mixed live / simulated</span>'));
  assert.ok(!quick.includes('class="prov prov-live">live</span>'));
});
