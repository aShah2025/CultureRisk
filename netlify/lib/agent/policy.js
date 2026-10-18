/**
 * CultureRisk AI — the agent's planner.
 *
 * Given the brief and the ledger (everything learned so far), the planner
 * returns the ordered list of research actions that currently apply. The
 * runner executes the first one not yet done, then asks again, so the plan
 * re-forms after every observation:
 *
 *   • base research always runs (resolve → taste DNA → demographics → overlap)
 *   • multi-comp checks run only when 2+ comps resolved
 *   • concept-fit runs only when the script yields Qloo tags
 *   • a bridge search is scheduled only if the comps diverge (taste or demographics)
 *   • a domain is re-queried only if its alignment is weak, and probed for niche
 *     partners only if every pick is mass-market
 *
 * Deterministic and auditable: the same Qloo evidence always yields the same
 * plan, and every branch is explained to the user as it happens.
 */

'use strict';

const { DOMAINS } = require('../config');
const { extractThemes } = require('./brief');
const A = require('./actions');

/**
 * @returns {Array<{id:string, title:string, why:string, run:Function, conditional?:boolean}>}
 */
function candidates(brief, ledger) {
  if (ledger.flags.abort) return [];
  const resolved = ledger.comps.length > 0;
  const multi = ledger.comps.length >= 2;
  const hasThemes = extractThemes(brief.script).length > 0;

  const list = [
    { id: 'resolve', title: 'Resolve comparable titles', why: 'Every Qloo signal needs a canonical entity ID. Disambiguate remakes and same-name titles.', run: A.resolveComps },
  ];
  if (hasThemes) list.push({ id: 'concept', title: 'Map the script\'s themes to Qloo tags', why: 'Lets the agent test the concept itself, not just its comps.', run: A.findConceptTags });
  if (!resolved && ledger.actions.includes('resolve')) return list;

  list.push(
    { id: 'dna', title: 'Profile the audience\'s taste DNA', why: 'Taste analysis (filter.type=urn:tag) shows what defines this audience.', run: A.tasteDna },
    { id: 'demographics', title: 'Read audience demographics', why: 'Age and gender affinity per comp (filter.type=urn:demographics).', run: A.demographics },
    { id: 'overlap', title: multi ? 'Stress-test the "X meets Y" pitch' : 'Map the comp audience\'s film taste', why: multi ? 'Query each comp separately and measure whether their audiences love the same films.' : 'Find the films this audience gravitates to.', run: A.tasteOverlap },
  );
  if (multi) list.push({ id: 'compare', title: 'Run Qloo\'s native comp comparison', why: '/v2/analysis/compare surfaces the taste markers the comps share.', run: A.qlooCompare });
  if (ledger.conceptTags.length && ledger.blendedFilms) {
    list.push({ id: 'concept-fit', title: 'Measure concept-to-comp fit', why: 'Does the audience for the script\'s own themes match the comps it is sold on?', run: A.conceptFit });
  }
  if (multi && (ledger.flags.divergent || ledger.flags.demoSplit)) {
    list.push({ id: 'bridge', title: 'Search for a bridge title', why: 'The comps split. Find a title whose audience spans both, to anchor the pitch.', run: A.bridgeSearch, conditional: true });
  }

  for (const urn of brief.domains) {
    list.push({ id: `sweep:${urn}`, title: `Map ${DOMAINS[urn]}`, why: `Which ${DOMAINS[urn].toLowerCase()} this audience over-indexes on, and which comp drives each (feature.explainability).`, run: A.domainSweep(urn) });
    if (ledger.flags[`retry:${urn}`]) {
      list.push({ id: `retry:${urn}`, title: `Re-query ${DOMAINS[urn]}`, why: 'Alignment was weak. Try the concept signal instead of the comps.', run: A.domainRetry(urn), conditional: true });
    }
    if (ledger.flags[`probe:${urn}`]) {
      list.push({ id: `probe:${urn}`, title: `Widen the ${DOMAINS[urn]} search`, why: 'Too few distinctive picks. Widen the popularity band (filter.popularity.min/max) to find under-the-radar partners.', run: A.nicheProbe(urn), conditional: true });
    }
  }
  return list;
}

/** The next action to run, or null when research is complete. */
function nextAction(brief, ledger) {
  return candidates(brief, ledger).find((a) => !ledger.actions.includes(a.id)) || null;
}

/** The opening plan as foreseen from the brief alone (shown before any Qloo call). */
function describePlan(brief) {
  const multi = brief.anchors.length >= 2;
  const themes = extractThemes(brief.script).length > 0;
  return [
    { title: 'Resolve comparable titles' },
    ...(themes ? [{ title: 'Map the script\'s themes to Qloo tags' }] : []),
    { title: 'Profile the audience\'s taste DNA' },
    { title: 'Read audience demographics' },
    { title: multi ? 'Stress-test the "X meets Y" pitch' : 'Map the comp audience\'s film taste' },
    ...(multi ? [{ title: 'Run Qloo\'s native comp comparison' }] : []),
    ...(themes ? [{ title: 'Measure concept-to-comp fit' }] : []),
    ...brief.domains.map((urn) => ({ title: `Map ${DOMAINS[urn]}` })),
    { title: 'Re-plan after every result: bridge search, re-queries, niche probes as the evidence demands', conditional: true },
    { title: 'Synthesize the greenlight memo' },
  ];
}

/** Total steps foreseen right now (done + remaining + synthesis), for the progress bar. */
function estimateTotal(brief, ledger) {
  const remaining = candidates(brief, ledger).filter((a) => !ledger.actions.includes(a.id)).length;
  return Math.max(ledger.actions.length + remaining + 1, describePlan(brief).length - 1);
}

module.exports = { candidates, nextAction, describePlan, estimateTotal };
