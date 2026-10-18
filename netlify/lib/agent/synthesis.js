/**
 * CultureRisk AI — synthesis: from the evidence ledger to a greenlight memo.
 *
 * Deterministic natural-language generation over Qloo facts. No model writes
 * anything here, so every sentence is traceable to a ledger entry, and every
 * recommendation carries the Qloo entity ID it came from.
 */

'use strict';

const { DOMAINS } = require('../config');
const { scorecard, whiteSpace, domainProfile } = require('../risk-model');
const { AGE_LABEL } = require('./actions');
const { summarizeCalls } = require('./ledger');

const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : 'n/a');
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function ledgerScorecard(ledger) {
  const domains = Object.fromEntries(Object.entries(ledger.domains).map(([urn, d]) => [urn, d.entities]));
  return scorecard({
    domains,
    coherence: ledger.coherence ? ledger.coherence.value : null,
    conceptFit: ledger.conceptFit ? ledger.conceptFit.value : null,
    demographics: ledger.demographics ? ledger.demographics.coherence : null,
    // The scorecard may award high confidence only to wholly live evidence.
    liveData: summarizeCalls(ledger.calls).mode === 'live',
  });
}

const ACTIONS = {
  'urn:entity:brand': (n, ws) => `Pursue ${n} as a ${ws ? 'co-promotion partner while it is still under-priced' : 'hero placement or co-promotion partner'}.`,
  'urn:entity:artist': (n, ws) => `Approach ${n} for score, sync licence, or trailer cue${ws ? '. The audience is ahead of the market on this artist' : ''}.`,
  'urn:entity:destination': (n, ws) => `Scout ${n} for locations and tourism-board co-marketing${ws ? '. Strong pull at a lower profile' : ''}.`,
  'urn:entity:tv_show': (n) => `Buy adjacency against ${n} audiences on streaming and social.`,
  'urn:entity:podcast': (n) => `Book host-read spots or talent appearances on ${n}.`,
};

function driverNote(entity, comps) {
  if (!entity.explainability || comps.length < 2) return null;
  const top = comps
    .map((c) => [c.name, entity.explainability[c.entityId] ?? 0])
    .sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > 0 ? `${pct(top[1])} driven by ${top[0]} fans` : null;
}

function buildRecommendations(ledger) {
  const recs = [];
  const traps = [];
  for (const [urn, d] of Object.entries(ledger.domains)) {
    // Recommendations come from the distinctive band (household names filtered out by Qloo popularity).
    const pool = [...d.entities, ...(d.probe || [])].filter((e, i, arr) => arr.findIndex((x) => x.entityId === e.entityId) === i);
    pool.slice(0, 3).forEach((e) => {
      const ws = typeof e.affinity === 'number' && typeof e.popularity === 'number' && e.affinity - e.popularity >= 0.08;
      const driver = driverNote(e, ledger.comps);
      recs.push({
        domain: urn,
        name: e.name,
        entityId: e.entityId,
        image: e.image ?? null,
        whiteSpace: ws,
        affinity: e.affinity,
        popularity: e.popularity,
        explainability: e.explainability ?? null,
        tags: e.tags || [],
        action: (ACTIONS[urn] || ((n) => `Engage ${n}.`))(e.name, ws),
        evidence: `Audience affinity ${pct(e.affinity)}, popularity percentile ${pct(e.popularity)}${ws ? ` (+${Math.round((e.affinity - e.popularity) * 100)} pts above its fame)` : ''}${driver ? ` · ${driver}` : ''}.`,
      });
    });
    // The obvious names: what Qloo ranks first with no filter. Famous everywhere, so not distinctive here.
    const distinctiveIds = new Set(pool.map((e) => e.entityId));
    (d.mainstream || [])
      .filter((e) => !distinctiveIds.has(e.entityId) && typeof e.popularity === 'number' && e.popularity >= 0.97)
      .slice(0, 2)
      .forEach((e) => traps.push({ domain: urn, name: e.name, entityId: e.entityId, image: e.image ?? null, popularity: e.popularity, affinity: e.affinity }));
  }
  return { recs, traps };
}

function buildRisks(ledger, card) {
  const risks = [];
  const source = summarizeCalls(ledger.calls);
  if (source.mode === 'mixed' || source.mode === 'fallback') {
    risks.push({
      severity: 'high',
      risk: source.mode === 'mixed'
        ? `Mixed evidence: ${source.live} live Qloo calls, ${source.fallback} simulated fallback calls and ${source.simulated} simulated calls. The verdict includes simulated taste signals.`
        : `Live Qloo requests failed: ${source.fallback} of ${source.total} calls used simulated fallback. This verdict is not supported by live taste signals.`,
      mitigation: 'Resolve the failed Qloo requests and re-run for fully live evidence before any committee decision.',
    });
  } else if (source.mode === 'simulated') {
    risks.push({ severity: 'high', risk: 'This analysis ran on simulated Qloo data, not live taste signals.', mitigation: 'Configure QLOO_HACKATHON_API_KEY and re-run before any committee decision.' });
  }
  const coh = ledger.coherence?.value;
  if (typeof coh === 'number' && coh < 0.35) {
    risks.push({ severity: 'high', risk: `The comps attract different audiences (taste overlap ${pct(coh)}). The "X meets Y" pitch may describe an audience that does not exist.`, mitigation: ledger.bridges?.[0] ? `Reposition around ${ledger.bridges[0].name}, whose audience spans both comps.` : 'Pick one primary comp and test the logline against each comp audience separately.' });
  } else if (typeof coh === 'number' && coh < 0.55) {
    risks.push({ severity: 'medium', risk: `Partial comp overlap (${pct(coh)}). The combined audience is narrower than either comp suggests.`, mitigation: 'Size P&A to the overlap segment, not to the sum of both comps.' });
  }
  const demo = ledger.demographics?.coherence;
  if (typeof demo === 'number' && demo < 0.45) {
    const [a, b] = ledger.demographics.byComp;
    risks.push({ severity: 'medium', risk: `Demographic split: ${a.name} skews ${AGE_LABEL[a.headline.peakAge] || 'n/a'}, ${b.name} skews ${AGE_LABEL[b.headline.peakAge] || 'n/a'} (similarity ${pct(demo)}).`, mitigation: 'Run separate creative for each demo, or cast to bridge them.' });
  }
  if (ledger.flags.conceptDrift) {
    risks.push({ severity: 'high', risk: `Concept drift: the comps' audience shows little appetite for the script's genres (concept fit ${pct(ledger.conceptFit?.value)}).`, mitigation: `Either rewrite toward the comps' taste or re-comp against titles like ${list((ledger.conceptFit?.conceptTop || []).slice(0, 2))}.` });
  }
  for (const [urn, p] of Object.entries(card.profiles)) {
    if (ledger.flags[`weak:${urn}`] || (p.alignment !== null && p.alignment < 60)) {
      risks.push({ severity: 'medium', risk: `Weak ${DOMAINS[urn]} alignment (${p.alignment}/100).`, mitigation: `Do not underwrite ${DOMAINS[urn].toLowerCase()} revenue in the financing plan.` });
    }
  }
  if (ledger.droppedComps.length) {
    risks.push({ severity: 'low', risk: `Qloo could not resolve: ${list(ledger.droppedComps)}.`, mitigation: 'Check the spelling or substitute a comparable title Qloo recognises.' });
  }
  if (!risks.length) {
    risks.push({ severity: 'low', risk: 'No structural taste risks detected. Remaining risk is execution: cast, cut, and release window.', mitigation: 'Proceed to packaging. Re-run after casting announcements.' });
  }
  const order = { high: 0, medium: 1, low: 2 };
  return risks.sort((a, b) => order[a.severity] - order[b.severity]);
}

function headlineFor(card, ledger) {
  const coh = ledger.coherence?.value;
  if (card.gates?.length) return card.gates[0].reason;
  switch (card.verdict) {
    case 'GREENLIGHT': return 'A coherent, well-defined audience with strong cross-domain pull. Proceed.';
    case 'CONDITIONAL GREENLIGHT': return typeof coh === 'number' && coh < 0.55
      ? 'Real audience, but narrower than the comps imply. Proceed with a tighter positioning.'
      : 'Solid audience signal with gaps to close before committing full P&A.';
    case 'REWORK': return 'The audience thesis does not hold together yet. Rework the comps or the concept.';
    case 'PASS': return 'Qloo finds no coherent audience for this package as pitched.';
    default: return 'Not enough Qloo signal to judge.';
  }
}

function composeMemo(brief, ledger) {
  const card = ledgerScorecard(ledger);
  const source = summarizeCalls(ledger.calls);
  const { recs, traps } = buildRecommendations(ledger);
  const comps = ledger.comps.map((c) => c.name);
  const demo = ledger.demographics?.byComp || [];

  const portrait = [
    demo.length ? `Qloo's demographic signal: ${demo.map((d) => `${d.name} fans skew ${AGE_LABEL[d.headline.peakAge] || 'n/a'} and ${d.headline.genderLean === 'balanced' ? 'gender-balanced' : `${d.headline.genderLean}-leaning`}`).join('; ')}.` : '',
    ledger.tasteDna.length ? `Their taste is defined by ${list(ledger.tasteDna.slice(0, 4).map((t) => t.name.toLowerCase()))}.` : '',
    ledger.blendedFilms?.length ? `Beyond the comps, they over-index on ${list(ledger.blendedFilms.slice(0, 3).map((f) => f.name))}.` : '',
  ].filter(Boolean).join(' ');

  const compFinding = ledger.coherence
    ? `${list(comps)}: taste-graph overlap ${pct(ledger.coherence.value)}${ledger.demographics?.coherence != null ? `, demographic similarity ${pct(ledger.demographics.coherence)}` : ''}.` +
      (ledger.compare?.shared?.length ? ` Qloo's comparison finds shared markers in ${list(ledger.compare.shared.slice(0, 3).map((s) => s.toLowerCase()))}.` : '') +
      (ledger.bridges?.length ? ` Bridge titles that span both audiences: ${list(ledger.bridges.map((b) => b.name))}.` : '')
    : 'A single comparable title was supplied, so the comp stress test was not run.';

  const lanes = ledger.conceptFit?.lanes || [];
  const conceptFinding = lanes.length
    ? `Filtering the comps' own audience to each of the script's genres: ${lanes.map((l) => `${l.tag.toLowerCase()} (${l.films.slice(0, 2).map((f) => f.name).join(', ')}; appetite ${pct(l.strength)})`).join('; ')}. ` +
      `Overall concept fit ${pct(ledger.conceptFit.value)}${ledger.leadComp ? `, closest to ${ledger.leadComp}'s audience` : ''}.`
    : 'No distinctive genres were detected in the treatment, so concept fit was not measured.';

  const topRec = recs.find((r) => r.whiteSpace) || recs[0];
  const summary = [
    source.mode !== 'live' ? `Data: ${source.mode}; ${source.live}/${source.total} calls returned live Qloo evidence.` : '',
    `${brief.title} scores ${card.cultureRiskScore ?? 'n/a'}/100 on culture risk (${card.verdict.toLowerCase()}, ${card.confidence} confidence) against the ${list(comps)} audience.`,
    ledger.coherence ? `The comps ${ledger.coherence.value >= 0.55 ? 'share a genuine audience' : ledger.coherence.value >= 0.35 ? 'overlap only partially' : 'pull in different directions'}.` : '',
    ledger.conceptFit ? `The concept ${ledger.flags.conceptDrift ? 'drifts away from' : 'fits'} that audience.` : '',
    topRec ? `Strongest commercial lever: ${topRec.name} (${DOMAINS[topRec.domain]}).` : '',
  ].filter(Boolean).join(' ');

  const nextSteps = [
    ledger.leadComp && ledger.comps.length > 1 ? `Lead the pitch deck with ${ledger.leadComp}${ledger.bridges?.[0] ? ` and add ${ledger.bridges[0].name} as a bridge comp` : ''}.` : null,
    recs.find((r) => r.domain === 'urn:entity:brand') ? `Open partnership conversations with ${recs.find((r) => r.domain === 'urn:entity:brand').name}.` : null,
    recs.find((r) => r.domain === 'urn:entity:artist') ? `Shortlist ${recs.find((r) => r.domain === 'urn:entity:artist').name} for music.` : null,
    traps[0] ? `Don't default to ${traps[0].name}: it tops every audience's list, so it says nothing about this one.` : null,
    'Re-run CultureRisk after casting and before budget lock.',
  ].filter(Boolean);

  return {
    card,
    memo: {
      verdict: card.verdict,
      confidence: card.confidence,
      headline: source.mode === 'live' ? headlineFor(card, ledger)
        : `${source.mode === 'mixed' ? 'Mixed live and simulated evidence' : source.mode === 'fallback' ? 'Simulated fallback evidence' : 'Simulated evidence'}: provisional coverage; re-run with fully live data before acting.`,
      executiveSummary: summary,
      audiencePortrait: portrait || 'Insufficient Qloo signal to characterise the audience.',
      compFinding,
      conceptFinding,
      recommendations: recs,
      popularityTraps: traps,
      risks: buildRisks(ledger, card),
      nextSteps,
    },
  };
}

/** Final payload for the cockpit. */
function finalizeSession(brief, ledger) {
  const { card, memo } = composeMemo(brief, ledger);
  const dataProvenance = summarizeCalls(ledger.calls);
  const known = new Set([
    ...ledger.comps.map((c) => c.entityId),
    ...Object.values(ledger.domains).flatMap((d) => [...d.entities, ...(d.probe || [])].map((e) => e.entityId)),
  ]);
  memo.recommendations = memo.recommendations.map((r) => ({
    ...r,
    grounded: known.has(r.entityId),
    simulated: String(r.entityId).startsWith('mock:'),
    qlooVerified: known.has(r.entityId) && !String(r.entityId).startsWith('mock:') && dataProvenance.live > 0,
  }));
  return {
    memo,
    scorecard: card,
    grounding: {
      total: memo.recommendations.length,
      grounded: memo.recommendations.filter((r) => r.grounded).length,
      qlooVerified: memo.recommendations.filter((r) => r.qlooVerified).length,
      simulated: memo.recommendations.filter((r) => r.simulated).length,
    },
    evidence: {
      comps: ledger.comps,
      droppedComps: ledger.droppedComps,
      conceptTags: ledger.conceptTags,
      tasteDna: ledger.tasteDna,
      demographics: ledger.demographics,
      compare: ledger.compare,
      compLists: ledger.compLists ? ledger.compLists.map((l) => ({ anchor: l.anchor, entityId: l.entityId, films: l.top.slice(0, 6).map((e) => ({ entityId: e.entityId, name: e.name, image: e.image ?? null, affinity: e.affinity })), top: l.top.slice(0, 6).map((e) => e.name) })) : null,
      blendedFilms: (ledger.blendedFilms || []).slice(0, 6),
      coherence: ledger.coherence,
      conceptFit: ledger.conceptFit,
      bridges: ledger.bridges,
      leadComp: ledger.leadComp,
      domains: Object.fromEntries(Object.entries(ledger.domains).map(([urn, d]) => [urn, { entities: d.entities.slice(0, 8), mainstream: (d.mainstream || []).slice(0, 6), probe: d.probe, drivers: d.drivers, retried: d.retried, profile: domainProfile(d.entities) }])),
      calls: ledger.calls,
      dataProvenance,
      liveData: dataProvenance.live > 0,
    },
  };
}

module.exports = { finalizeSession, composeMemo, ledgerScorecard };
