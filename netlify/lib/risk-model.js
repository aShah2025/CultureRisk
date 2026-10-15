/**
 * CultureRisk AI — deterministic risk model.
 *
 * Turns raw Qloo affinity data into the board-level metrics. This is plain
 * arithmetic over Qloo output. The LLM never invents these numbers: it reads
 * them back from tool results, and the final scorecard is recomputed here from
 * the evidence ledger.
 *
 * Metrics
 * ───────
 *  Domain alignment  Mean Qloo affinity of the top results in a domain (0–100).
 *                    How strongly the anchor audience gravitates to that layer.
 *  Dispersion (σ)    Std. deviation of those affinities. A scattered profile
 *                    means a less predictable audience.
 *  Comp coherence    Overlap between the taste graphs of each comparable title
 *                    (Jaccard on top-N entities, blended with rank agreement).
 *                    It tests the "X meets Y" pitch: if X's and Y's audiences
 *                    love completely different things, the hybrid audience
 *                    may not exist.
 *  White space       Entities whose affinity clearly exceeds their mainstream
 *                    popularity. These are partners that over-index with this
 *                    audience but are not yet saturated, so they are cheaper
 *                    to sign and more distinctive.
 *  Culture risk      0–100 composite (lower is safer) → verdict.
 */

'use strict';

const round = (n, p = 3) => Math.round(n * 10 ** p) / 10 ** p;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function stdDev(xs) {
  const m = mean(xs);
  if (m === null) return null;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

/** Stable identity for cross-list comparison. */
function entityKey(e) {
  return e.entityId || String(e.name || '').toLowerCase();
}

/**
 * Summarise one domain's affinity results.
 * @param {Array<{affinity:number|null, popularity:number|null}>} entities
 */
function domainProfile(entities, topN = 6) {
  const top = entities.slice(0, topN);
  const affinities = top.map((e) => e.affinity).filter((a) => typeof a === 'number');
  const pops = top.map((e) => e.popularity).filter((p) => typeof p === 'number');
  const m = mean(affinities);
  return {
    sampleSize: affinities.length,
    alignment: m === null ? null : Math.round(m * 100),
    topAffinity: affinities.length ? round(Math.max(...affinities)) : null,
    dispersion: affinities.length ? round(stdDev(affinities)) : null,
    meanPopularity: pops.length ? round(mean(pops)) : null,
  };
}

/**
 * White-space opportunities: affinity exceeds popularity by `margin`.
 * Sorted by the size of the gap.
 */
function whiteSpace(entities, margin = 0.08) {
  return entities
    .filter((e) => typeof e.affinity === 'number' && typeof e.popularity === 'number' && e.affinity - e.popularity >= margin)
    .map((e) => ({ name: e.name, entityId: e.entityId, gap: round(e.affinity - e.popularity) }))
    .sort((a, b) => b.gap - a.gap);
}

/**
 * Coherence between two ranked lists (0–1).
 *   0.6 × Jaccard(top-N sets) + 0.4 × rank agreement on the shared items.
 * Rank agreement = 1 − mean(|rankA − rankB|) / N over shared items (1 when no shared items, weighted out by Jaccard = 0).
 */
function pairCoherence(listA, listB, topN = 6) {
  const a = listA.slice(0, topN).map(entityKey);
  const b = listB.slice(0, topN).map(entityKey);
  const setB = new Set(b);
  const shared = a.filter((k) => setB.has(k));
  const union = new Set([...a, ...b]);
  const jaccard = union.size ? shared.length / union.size : 0;
  const rankAgreement = shared.length
    ? 1 - mean(shared.map((k) => Math.abs(a.indexOf(k) - b.indexOf(k)))) / topN
    : 0;
  return {
    jaccard: round(jaccard),
    rankAgreement: round(rankAgreement),
    coherence: round(0.6 * jaccard + 0.4 * rankAgreement),
    shared: shared.length,
  };
}

/**
 * Mean pairwise coherence across N anchor lists (needs ≥2).
 * @param {Array<{anchor:string, entities:Array}>} perAnchor
 */
function compCoherence(perAnchor, topN = 6) {
  if (!Array.isArray(perAnchor) || perAnchor.length < 2) return null;
  const pairs = [];
  for (let i = 0; i < perAnchor.length; i += 1) {
    for (let j = i + 1; j < perAnchor.length; j += 1) {
      pairs.push({
        a: perAnchor[i].anchor,
        b: perAnchor[j].anchor,
        ...pairCoherence(perAnchor[i].entities, perAnchor[j].entities, topN),
      });
    }
  }
  return {
    coherence: round(mean(pairs.map((p) => p.coherence))),
    pairs,
  };
}

const VERDICTS = Object.freeze([
  [30, 'GREENLIGHT'],
  [45, 'CONDITIONAL GREENLIGHT'],
  [60, 'REWORK'],
  [Infinity, 'PASS'],
]);

function verdictFor(risk) {
  return VERDICTS.find(([limit]) => risk <= limit)[1];
}

/**
 * Composite scorecard.
 * @param {object} input
 * @param {Object<string, Array>} input.domains    Map of domain URN → blended-signal entities.
 * @param {number|null} input.coherence             0–1 comp coherence, or null with <2 anchors.
 * @param {boolean} input.liveData                  Whether any evidence came from live Qloo.
 */
function scorecard({ domains, coherence = null, liveData = false }) {
  const profiles = Object.fromEntries(Object.entries(domains || {}).map(([urn, ents]) => [urn, domainProfile(ents)]));
  const usable = Object.values(profiles).filter((p) => p.alignment !== null);

  if (usable.length === 0) {
    return { profiles, alignment: null, coherence: null, cultureRiskScore: null, verdict: 'INSUFFICIENT SIGNAL', confidence: 'low' };
  }

  const alignment = Math.round(mean(usable.map((p) => p.alignment)));
  const dispersion = mean(usable.map((p) => p.dispersion));
  const coherencePct = typeof coherence === 'number' ? Math.round(coherence * 100) : null;

  const base = coherencePct === null ? alignment : 0.65 * alignment + 0.35 * coherencePct;
  const cultureRiskScore = Math.round(clamp(100 - base + dispersion * 80, 0, 100));

  // Confidence grows with breadth of evidence and live provenance.
  const evidencePoints = usable.length + (coherencePct !== null ? 1 : 0) + (liveData ? 1 : 0);
  const confidence = evidencePoints >= 4 ? 'high' : evidencePoints >= 2 ? 'medium' : 'low';

  return {
    profiles,
    alignment,
    coherence: coherencePct,
    dispersion: round(dispersion),
    cultureRiskScore,
    verdict: verdictFor(cultureRiskScore),
    confidence,
  };
}

module.exports = { domainProfile, whiteSpace, pairCoherence, compCoherence, scorecard, verdictFor };
