/**
 * CultureRisk AI — deterministic risk model.
 *
 * Turns raw Qloo data into the board-level metrics. Plain, auditable
 * arithmetic over Qloo output, with no model in the loop. The scorecard is
 * recomputed from the evidence ledger at the end of every session.
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
 *  Demographic fit   Cosine similarity of the comps' Qloo age/gender affinity
 *                    profiles. Do the comps court the same demographic?
 *  Concept fit       Overlap between the audience Qloo finds for the script's
 *                    own themes (tags) and the comps' audience. Does the
 *                    concept actually match the comps it is sold on?
 *  Culture risk      0–100 weighted composite (lower is safer) → verdict.
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

/**
 * Demographic similarity of two audiences (0–1).
 * Cosine similarity over Qloo's age-bucket and gender affinity scores (each in
 * [-1, 1]), mapped from [-1, 1] to [0, 1]. Two comps that skew to opposite
 * age groups score near 0, meaning the pitch is courting two different demos.
 */
function demographicSimilarity(a, b) {
  const keys = [...new Set([...Object.keys(a.age || {}), ...Object.keys(b.age || {})])];
  const va = [...keys.map((k) => a.age?.[k] ?? 0), a.gender?.male ?? 0];
  const vb = [...keys.map((k) => b.age?.[k] ?? 0), b.gender?.male ?? 0];
  const dot = va.reduce((s, x, i) => s + x * vb[i], 0);
  const na = Math.sqrt(va.reduce((s, x) => s + x * x, 0));
  const nb = Math.sqrt(vb.reduce((s, x) => s + x * x, 0));
  if (!na || !nb) return null;
  return round((dot / (na * nb) + 1) / 2);
}

/** Mean pairwise demographic similarity across ≥2 profiles. */
function demographicCoherence(profiles) {
  if (!Array.isArray(profiles) || profiles.length < 2) return null;
  const sims = [];
  for (let i = 0; i < profiles.length; i += 1) {
    for (let j = i + 1; j < profiles.length; j += 1) {
      const s = demographicSimilarity(profiles[i], profiles[j]);
      if (s !== null) sims.push(s);
    }
  }
  return sims.length ? round(mean(sims)) : null;
}

/** The age bucket an audience over-indexes on most, and its gender lean. */
function demographicHeadline(profile) {
  const ages = Object.entries(profile.age || {}).sort((x, y) => y[1] - x[1]);
  const male = profile.gender?.male ?? 0;
  return {
    peakAge: ages[0] ? ages[0][0] : null,
    peakScore: ages[0] ? ages[0][1] : null,
    genderLean: Math.abs(male) < 0.05 ? 'balanced' : male > 0 ? 'male' : 'female',
    genderScore: round(Math.abs(male), 2),
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

/** Component weights for the composite; missing components are renormalised away. */
const WEIGHTS = Object.freeze({ alignment: 0.4, coherence: 0.25, conceptFit: 0.2, demographics: 0.15 });

/**
 * Composite scorecard.
 * @param {object} input
 * @param {Object<string, Array>} input.domains      Domain URN → blended-signal entities.
 * @param {number|null} [input.coherence]            0–1 comp taste coherence.
 * @param {number|null} [input.conceptFit]           0–1 concept-to-comp audience fit.
 * @param {number|null} [input.demographics]         0–1 comp demographic coherence.
 * @param {boolean} [input.liveData]                 Whether the scoring evidence is fully live Qloo data.
 */
function scorecard({ domains, coherence = null, conceptFit = null, demographics = null, liveData = false }) {
  const profiles = Object.fromEntries(Object.entries(domains || {}).map(([urn, ents]) => [urn, domainProfile(ents)]));
  const usable = Object.values(profiles).filter((p) => p.alignment !== null);

  if (usable.length === 0) {
    return { profiles, alignment: null, coherence: null, conceptFit: null, demographics: null, cultureRiskScore: null, verdict: 'INSUFFICIENT SIGNAL', confidence: 'low', components: [] };
  }

  const pct = (v) => (typeof v === 'number' ? Math.round(v * 100) : null);
  const alignment = Math.round(mean(usable.map((p) => p.alignment)));
  const dispersion = mean(usable.map((p) => p.dispersion));
  const parts = {
    alignment,
    coherence: pct(coherence),
    conceptFit: pct(conceptFit),
    demographics: pct(demographics),
  };

  const present = Object.entries(parts).filter(([, v]) => v !== null);
  const weightSum = present.reduce((s, [k]) => s + WEIGHTS[k], 0);
  const base = present.reduce((s, [k, v]) => s + (WEIGHTS[k] / weightSum) * v, 0);
  const cultureRiskScore = Math.round(clamp(100 - base + dispersion * 80, 0, 100));

  // Confidence grows with breadth of evidence and live provenance.
  const evidencePoints = usable.length + present.length - 1 + (liveData ? 2 : 0);
  let confidence = evidencePoints >= 6 ? 'high' : evidencePoints >= 3 ? 'medium' : 'low';
  // Simulated evidence can never support high confidence.
  if (!liveData && confidence === 'high') confidence = 'medium';

  return {
    profiles,
    ...parts,
    dispersion: round(dispersion),
    cultureRiskScore,
    verdict: verdictFor(cultureRiskScore),
    confidence,
    components: present.map(([k, v]) => ({ key: k, value: v, weight: round(WEIGHTS[k] / weightSum, 2) })),
  };
}

module.exports = {
  domainProfile,
  whiteSpace,
  pairCoherence,
  compCoherence,
  demographicSimilarity,
  demographicCoherence,
  demographicHeadline,
  scorecard,
  verdictFor,
};
