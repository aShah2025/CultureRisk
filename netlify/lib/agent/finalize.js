/**
 * CultureRisk AI — session finalisation.
 *
 * Shared by both engines. Takes the memo (written by Claude or composed by the
 * scripted planner) and attaches the parts that must not depend on the LLM:
 *
 *   • scorecard   recomputed deterministically from the Qloo evidence ledger
 *   • grounding   checks that each recommended entity ID was actually returned
 *                 by Qloo during this session (hallucination guard)
 *   • evidence    anchors, comp-coherence detail, and the Qloo call audit log
 */

'use strict';

const { DOMAINS } = require('../config');
const { scorecard, whiteSpace } = require('../risk-model');

/** All entity IDs Qloo returned during the session. */
function knownEntityIds(ledger) {
  const ids = new Set(ledger.anchors.map((a) => a.entityId));
  Object.values(ledger.domains).forEach((ents) => ents.forEach((e) => ids.add(e.entityId)));
  return ids;
}

function ledgerScorecard(ledger) {
  return scorecard({
    domains: ledger.domains,
    coherence: ledger.coherence ? ledger.coherence.coherence : null,
    liveData: ledger.liveData,
  });
}

/**
 * Compose a memo purely from the ledger (no LLM). Used by the scripted engine
 * and as a safety net if the Claude engine exhausts its step budget.
 */
function composeMemoFromLedger(ledger, brief) {
  const card = ledgerScorecard(ledger);
  const recommendations = [];

  for (const [urn, entities] of Object.entries(ledger.domains)) {
    const gaps = whiteSpace(entities);
    const picks = [...gaps.map((g) => entities.find((e) => e.entityId === g.entityId)), ...entities]
      .filter((e, i, arr) => e && arr.findIndex((x) => x.entityId === e.entityId) === i)
      .slice(0, 2);
    for (const e of picks) {
      const gap = gaps.find((g) => g.entityId === e.entityId);
      recommendations.push({
        domain: urn,
        name: e.name,
        qloo_entity_id: e.entityId,
        action: actionFor(urn, e.name, Boolean(gap)),
        evidence: `Qloo affinity ${pct(e.affinity)} vs popularity ${pct(e.popularity)}${gap ? ` (white-space gap +${Math.round(gap.gap * 100)} pts)` : ''}.`,
      });
    }
  }

  const risks = [];
  if (card.coherence !== null && card.coherence < 35) {
    risks.push({ risk: `Comparable titles attract divergent audiences (coherence ${card.coherence}%). The hybrid pitch may target an audience that does not exist.`, severity: 'high', mitigation: 'Pick one primary comp for positioning and test the logline against each comp audience separately.' });
  } else if (card.coherence !== null && card.coherence < 55) {
    risks.push({ risk: `Partial comp overlap (coherence ${card.coherence}%). The combined audience is narrower than either comp suggests.`, severity: 'medium', mitigation: 'Size marketing spend to the overlap segment, not the sum of both comps.' });
  }
  for (const [urn, p] of Object.entries(card.profiles)) {
    if (p.alignment !== null && p.alignment < 65) {
      risks.push({ risk: `Weak ${DOMAINS[urn]} alignment (${p.alignment}/100).`, severity: 'medium', mitigation: `Deprioritise ${DOMAINS[urn].toLowerCase()} revenue in the financing plan.` });
    }
  }
  if (!ledger.liveData) {
    risks.push({ risk: 'This analysis ran on simulated Qloo data, not live taste signals.', severity: 'high', mitigation: 'Re-run with a live Qloo API key before any committee decision.' });
  }
  if (risks.length === 0) {
    risks.push({ risk: 'No structural taste risks detected; remaining risk is execution (cast, release window).', severity: 'low', mitigation: 'Proceed to packaging; re-run after casting announcements.' });
  }

  const anchors = ledger.anchors.map((a) => a.name).join(' + ') || brief.anchors.join(' + ');
  return {
    verdict: card.verdict === 'INSUFFICIENT SIGNAL' ? 'REWORK' : card.verdict,
    confidence: card.confidence,
    executive_summary:
      `${brief.title} scores ${card.cultureRiskScore ?? '—'}/100 on culture risk against the ${anchors} audience. ` +
      `Mean cross-domain alignment is ${card.alignment ?? '—'}/100${card.coherence !== null ? ` and comp coherence is ${card.coherence}%` : ''}. ` +
      `Verdict: ${card.verdict}.`,
    audience_thesis: audienceThesis(ledger),
    comp_coherence_finding: ledger.coherence
      ? `Across ${ledger.coherence.perAnchor.map((p) => p.anchor).join(' vs ')}, the audiences share ${Math.round(ledger.coherence.coherence * 100)}% taste coherence in ${DOMAINS[ledger.coherence.target]}.`
      : 'Only one comparable title was supplied, so the comp stress test was not run.',
    recommendations,
    risks,
    next_steps: [
      recommendations[0] ? `Open partnership talks with ${recommendations[0].name}.` : 'Gather more comparable titles.',
      'Validate the audience thesis with a targeted concept test.',
      'Re-run CultureRisk after casting and before final budget lock.',
    ],
  };
}

function audienceThesis(ledger) {
  const parts = Object.entries(ledger.domains).map(([urn, ents]) => {
    const names = ents.slice(0, 3).map((e) => e.name).join(', ');
    return `${DOMAINS[urn]}: ${names}`;
  });
  return parts.length
    ? `Qloo shows this audience over-indexes on: ${parts.join('; ')}.`
    : 'Insufficient Qloo signal to characterise the audience.';
}

function actionFor(urn, name, isWhiteSpace) {
  const tone = isWhiteSpace ? 'under-priced, high-affinity' : 'top-affinity';
  switch (urn) {
    case 'urn:entity:brand': return `Pursue ${name} as a ${tone} co-promotion or placement partner.`;
    case 'urn:entity:artist': return `Approach ${name} for score, sync licence, or trailer cue (${tone}).`;
    case 'urn:entity:destination': return `Scout ${name} for locations and tourism-board co-marketing (${tone}).`;
    case 'urn:entity:tv_show': return `Target ${name} viewers for streaming and adjacency media buys (${tone}).`;
    case 'urn:entity:podcast': return `Book host-read spots or talent appearances on ${name} (${tone}).`;
    default: return `Engage ${name}.`;
  }
}

const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');

/**
 * Build the final payload returned to the cockpit.
 * @param {object} ledger
 * @param {object} memo
 * @param {'claude'|'scripted'} author
 */
function finalizeSession(ledger, memo, author) {
  const known = knownEntityIds(ledger);
  const recommendations = (memo.recommendations || []).map((r) => ({ ...r, grounded: known.has(r.qloo_entity_id) }));
  const groundedCount = recommendations.filter((r) => r.grounded).length;
  return {
    memo: { ...memo, recommendations },
    memoAuthor: author,
    scorecard: ledgerScorecard(ledger),
    grounding: { total: recommendations.length, grounded: groundedCount },
    evidence: {
      anchors: ledger.anchors,
      tags: ledger.tags,
      coherence: ledger.coherence,
      domains: Object.fromEntries(Object.entries(ledger.domains).map(([urn, ents]) => [urn, ents.slice(0, 6)])),
      calls: ledger.calls,
      liveData: ledger.liveData,
    },
  };
}

module.exports = { finalizeSession, composeMemoFromLedger, ledgerScorecard, knownEntityIds };
