/**
 * Back-test: run the agent on real films whose box-office outcome is known,
 * using the comps and premise each was actually pitched on, and print the
 * verdict next to what happened. Needs QLOO_HACKATHON_API_KEY (live data only).
 *
 *   node --env-file=.env scripts/backtest.js
 */

'use strict';

const { createQlooService } = require('../netlify/lib/qloo-service');
const { normalizeBrief } = require('../netlify/lib/agent/brief');
const { runToCompletion } = require('../netlify/lib/agent/runner');

(async () => {
  if (!process.env.QLOO_HACKATHON_API_KEY) { console.error('Set QLOO_HACKATHON_API_KEY.'); process.exit(1); }
  const { PRESETS } = await import('../public/js/presets.js');
  const rows = [];
  for (const c of PRESETS) {
    const parsed = normalizeBrief({ title: c.title, anchors: c.anchors, script: c.script, budgetMillions: c.budgetMillions, domains: ['urn:entity:brand', 'urn:entity:artist'] });
    // eslint-disable-next-line no-await-in-loop
    const r = await runToCompletion({ brief: parsed.brief, makeQloo: () => createQlooService() });
    rows.push({ film: c.title, outcome: c.outcome, risk: r.scorecard.cultureRiskScore, verdict: r.memo.verdict, overlap: r.scorecard.coherence, concept: r.scorecard.conceptFit });
  }
  console.table(rows);
})();
