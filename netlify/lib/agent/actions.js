/**
 * CultureRisk AI — agent actions.
 *
 * Each action is one unit of research against Qloo. It reads the ledger,
 * makes one or more Qloo calls through the service (calls in one action run
 * concurrently), writes facts back to the ledger, and returns:
 *
 *   observations  what Qloo said, in plain language
 *   decisions     what the agent concluded or will do next because of it
 *
 * Decisions usually set policy flags (ledger.flags) that cause the planner to
 * schedule follow-up actions. That is the agent's adaptive behaviour.
 */

'use strict';

const { DOMAINS } = require('../config');
const { extractThemes } = require('./brief');
const {
  domainProfile, whiteSpace, compCoherence, pairCoherence, demographicCoherence, demographicHeadline,
} = require('../risk-model');

/** Thresholds that trigger follow-up research. Tuned to be conservative. */
const THRESHOLDS = Object.freeze({
  divergentComps: 0.35, // taste coherence below this → bridge search
  demoSplit: 0.45, // demographic coherence below this → bridge search
  conceptDrift: 0.15, // concept-to-comp fit below this → flag drift
  weakDomain: 60, // domain alignment below this → retry with concept signal
  saturated: 0.8, // mean popularity above this with no white space → niche probe
  nichePopularityMax: 0.6,
});

const MOVIE = 'urn:entity:movie';
const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : 'n/a');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slim = (e) => ({ entityId: e.entityId, name: e.name, affinity: e.affinity, popularity: e.popularity, audienceGrowth: e.audienceGrowth ?? null, explainability: e.explainability ?? null, tags: e.tags || [] });
const compIds = (ledger) => ledger.comps.map((c) => c.entityId);
const conceptTagIds = (ledger, n = 2) => ledger.conceptTags.slice(0, n).map((t) => t.tagId);
const AGE_LABEL = {
  '24_and_younger': 'under 25', '25_to_29': '25–29', '30_to_34': '30–34', '35_to_44': '35–44', '45_to_54': '45–54', '55_and_older': '55+',
  '35_and_younger': 'under 36', '36_to_55': '36–55',
};

/* -------------------------------------------------------------------------- */

async function resolveComps({ brief, ledger, qloo }) {
  const results = await Promise.all(brief.anchors.map((q) => qloo.search(q, MOVIE, 3)));
  const observations = [];
  const decisions = [];

  brief.anchors.forEach((query, i) => {
    const { data, provenance } = results[i];
    if (!data.length) {
      ledger.droppedComps.push(query);
      decisions.push(`Qloo has no film matching "${query}". Dropping it from the comp set.`);
      return;
    }
    // Prefer an exact title match; among those, the most popular (the canonical release, not a remake).
    const exact = data.filter((e) => norm(e.name) === norm(query)).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    const pick = exact[0] || data[0];
    ledger.comps.push({
      query, entityId: pick.entityId, name: pick.name, year: pick.year, disambiguation: pick.disambiguation,
      popularity: pick.popularity, provenance, exactMatch: Boolean(exact[0]),
    });
    observations.push(`"${query}" → ${pick.name}${pick.year ? ` (${pick.year})` : ''}, popularity ${pct(pick.popularity)}`);
    if (exact.length > 1) decisions.push(`Several titles are named "${query}". Using the most popular release.`);
    if (!exact[0]) decisions.push(`No exact title match for "${query}". Proceeding with the closest match, ${pick.name}.`);
  });

  if (ledger.comps.length === 0) ledger.flags.abort = 'No comparable title could be resolved in Qloo.';
  if (ledger.comps.length === 1) decisions.push('Only one comp resolved. Comp stress tests will be skipped.');
  return { observations, decisions };
}

async function findConceptTags({ brief, ledger, qloo }) {
  const themes = extractThemes(brief.script);
  const observations = [];
  const decisions = [];
  const first = await Promise.all(themes.map((t) => qloo.tags(t.query, 3)));

  for (let i = 0; i < themes.length; i += 1) {
    let tags = first[i].data;
    if (!tags.length) {
      // eslint-disable-next-line no-await-in-loop
      tags = (await qloo.tags(themes[i].fallback, 3)).data;
      decisions.push(`No Qloo tag for "${themes[i].query}". Broadened the search to "${themes[i].fallback}".`);
    }
    tags.slice(0, 2).forEach((t) => {
      if (!ledger.conceptTags.some((x) => x.tagId === t.tagId)) ledger.conceptTags.push({ theme: themes[i].query, tagId: t.tagId, name: t.name });
    });
    observations.push(`Theme "${themes[i].query}" → ${tags.slice(0, 2).map((t) => t.name).join(', ') || 'no tags'}`);
  }
  if (ledger.conceptTags.length) decisions.push(`Will use ${ledger.conceptTags.length} concept tag(s) to test whether the script's own audience matches the comps.`);
  return { observations, decisions };
}

async function tasteDna({ ledger, qloo }) {
  const { data } = await qloo.tasteTags({ entityIds: compIds(ledger), take: 10 });
  ledger.tasteDna = data.map((t) => ({ name: t.name, affinity: t.affinity }));
  return { observations: [`Audience taste DNA: ${data.slice(0, 6).map((t) => t.name).join(' · ')}`], decisions: [] };
}

async function demographics({ ledger, qloo }) {
  const { data } = await qloo.demographics({ entityIds: compIds(ledger) });
  const byComp = ledger.comps.map((c) => {
    const d = data.find((x) => x.id === c.entityId) || data[ledger.comps.indexOf(c)] || { age: {}, gender: {} };
    return { entityId: c.entityId, name: c.name, age: d.age, gender: d.gender, headline: demographicHeadline(d) };
  });
  const coherence = demographicCoherence(byComp);
  ledger.demographics = { byComp, coherence };

  const observations = byComp.map((p) => `${p.name}: skews ${AGE_LABEL[p.headline.peakAge] || p.headline.peakAge || 'n/a'}, ${p.headline.genderLean === 'balanced' ? 'gender-balanced' : `${p.headline.genderLean}-leaning`}`);
  const decisions = [];
  if (coherence !== null) {
    observations.push(`Demographic similarity between comps: ${pct(coherence)}`);
    if (coherence < THRESHOLDS.demoSplit) {
      ledger.flags.demoSplit = true;
      decisions.push('The comps court different demographics. Scheduling a bridge-title search.');
    }
  }
  return { observations, decisions };
}

async function qlooCompare({ ledger, qloo }) {
  const [first, ...rest] = ledger.comps;
  const { data, provenance } = await qloo.compare({ a: [first.entityId], b: rest.map((c) => c.entityId), take: 8 });
  ledger.compare = { a: first.name, b: rest.map((c) => c.name).join(' + '), shared: data.map((d) => d.name), provenance };
  const shared = data.slice(0, 5).map((d) => d.name).join(', ');
  return { observations: [`Qloo compare: ${first.name} vs ${ledger.compare.b} share ${shared || 'no common taste markers'}`], decisions: [] };
}

async function tasteOverlap({ ledger, qloo }) {
  const ids = compIds(ledger);
  const [blended, ...perComp] = await Promise.all([
    qloo.insights({ filterType: MOVIE, entityIds: ids, take: 12 }),
    ...(ids.length >= 2 ? ids.map((id) => qloo.insights({ filterType: MOVIE, entityIds: [id], take: 10 })) : []),
  ]);
  const notComp = (e) => !ids.includes(e.entityId) && !ledger.comps.some((c) => norm(c.name) === norm(e.name));
  ledger.blendedFilms = blended.data.filter(notComp).map(slim);

  const observations = [`The blended comp audience also loves: ${ledger.blendedFilms.slice(0, 4).map((e) => e.name).join(', ')}`];
  const decisions = [];
  if (perComp.length >= 2) {
    ledger.compLists = ledger.comps.map((c, i) => ({ anchor: c.name, entityId: c.entityId, top: perComp[i].data.filter(notComp).map(slim) }));
    const result = compCoherence(ledger.compLists.map((l) => ({ anchor: l.anchor, entities: l.top })), 8);
    ledger.coherence = { value: result.coherence, pairs: result.pairs };
    observations.push(`Taste-graph overlap between comps: ${pct(result.coherence)} (${result.pairs.map((p) => `${p.shared} shared titles`).join(', ')})`);
    if (result.coherence < THRESHOLDS.divergentComps) {
      ledger.flags.divergent = true;
      decisions.push('The comps\' audiences love different films, so the "X meets Y" audience may not exist. Scheduling a bridge-title search.');
    } else if (result.coherence < 0.55) {
      decisions.push('Partial overlap: a hybrid audience exists but is narrower than either comp. Will size recommendations to the overlap.');
    } else {
      decisions.push('The comps share a real taste audience. The hybrid pitch holds.');
    }
  }
  return { observations, decisions };
}

async function conceptFit({ ledger, qloo }) {
  const { data } = await qloo.insights({ filterType: MOVIE, tagIds: conceptTagIds(ledger, 3), take: 12 });
  const conceptTop = data.map(slim);
  const fit = pairCoherence(conceptTop, ledger.blendedFilms || [], 10).coherence;
  const perComp = {};
  (ledger.compLists || []).forEach((l) => { perComp[l.anchor] = pairCoherence(conceptTop, l.top, 10).coherence; });
  const lead = Object.entries(perComp).sort((a, b) => b[1] - a[1])[0];
  ledger.conceptFit = { value: fit, perComp, conceptTop: conceptTop.slice(0, 6).map((e) => e.name) };
  if (lead) ledger.leadComp = lead[0];

  const observations = [`The script's themes attract fans of: ${conceptTop.slice(0, 4).map((e) => e.name).join(', ')}`, `Concept-to-comp audience fit: ${pct(fit)}`];
  const decisions = [];
  if (lead && Object.keys(perComp).length > 1) decisions.push(`The concept sits closest to ${lead[0]}'s audience. Lead the positioning with it.`);
  if (fit < THRESHOLDS.conceptDrift) {
    ledger.flags.conceptDrift = true;
    decisions.push('The script\'s own audience barely overlaps the comps. Flagging concept drift as a risk.');
  }
  return { observations, decisions };
}

async function bridgeSearch({ ledger, qloo }) {
  const ids = compIds(ledger);
  const { data } = await qloo.insights({ filterType: MOVIE, entityIds: ids, tagIds: conceptTagIds(ledger, 2), take: 12 });
  const bridges = data.filter((e) => !ids.includes(e.entityId)).slice(0, 3).map(slim);
  ledger.bridges = bridges;
  return {
    observations: [`Titles that sit between the comps and the concept: ${bridges.map((b) => b.name).join(', ')}`],
    decisions: bridges[0] ? [`Recommend ${bridges[0].name} as a bridge comp for the pitch deck.`] : [],
  };
}

/** Weighted share each comp contributes to a domain's results (from Qloo explainability). */
function driverShares(entities, comps) {
  const totals = Object.fromEntries(comps.map((c) => [c.name, 0]));
  let n = 0;
  entities.forEach((e) => {
    if (!e.explainability) return;
    n += 1;
    comps.forEach((c) => { totals[c.name] += e.explainability[c.entityId] ?? 0; });
  });
  if (!n) return null;
  const sum = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round((v / sum) * 100) / 100]));
}

function domainSweep(urn) {
  return async ({ ledger, qloo }) => {
    const { data } = await qloo.insights({ filterType: urn, entityIds: compIds(ledger), tagIds: conceptTagIds(ledger, 1), take: 8, explain: ledger.comps.length > 1 });
    const entities = data.map(slim);
    const profile = domainProfile(entities);
    const gaps = whiteSpace(entities);
    const drivers = driverShares(entities, ledger.comps);
    ledger.domains[urn] = { entities, retried: false, probe: null, drivers };

    const observations = [
      `${DOMAINS[urn]}: alignment ${profile.alignment}/100. Top picks: ${entities.slice(0, 3).map((e) => e.name).join(', ')}`,
    ];
    if (drivers) {
      const top = Object.entries(drivers).sort((a, b) => b[1] - a[1])[0];
      observations.push(`Explainability: ${top[0]} drives ${pct(top[1])} of these affinities`);
    }
    const decisions = [];
    if (gaps.length) decisions.push(`White space found: ${gaps[0].name} over-indexes by ${Math.round(gaps[0].gap * 100)} pts vs its popularity.`);
    if (profile.alignment !== null && profile.alignment < THRESHOLDS.weakDomain) {
      ledger.flags[`retry:${urn}`] = true;
      decisions.push(`Weak alignment. Will re-query ${DOMAINS[urn]} using the concept signal.`);
    }
    if (!gaps.length && (profile.meanPopularity ?? 0) > THRESHOLDS.saturated) {
      ledger.flags[`probe:${urn}`] = true;
      decisions.push(`Every pick is mass-market (mean popularity ${pct(profile.meanPopularity)}). Will probe for niche partners.`);
    }
    return { observations, decisions };
  };
}

function domainRetry(urn) {
  return async ({ ledger, qloo }) => {
    const tagIds = conceptTagIds(ledger, 3);
    const lead = ledger.comps.find((c) => c.name === ledger.leadComp) || ledger.comps[0];
    const { data } = await qloo.insights({ filterType: urn, entityIds: tagIds.length ? [] : [lead.entityId], tagIds, take: 8 });
    const entities = data.map(slim);
    const before = domainProfile(ledger.domains[urn].entities).alignment;
    const after = domainProfile(entities).alignment;
    const decisions = [];
    if (after > before) {
      ledger.domains[urn] = { ...ledger.domains[urn], entities, retried: true };
      decisions.push(`Re-query improved alignment from ${before} to ${after}. Adopting it.`);
    } else {
      decisions.push(`Re-query did not improve alignment (${after} vs ${before}). Keeping the original and flagging the domain as weak.`);
      ledger.flags[`weak:${urn}`] = true;
    }
    return { observations: [`${DOMAINS[urn]} via ${tagIds.length ? 'concept tags' : lead.name}: alignment ${after}/100`], decisions };
  };
}

function nicheProbe(urn) {
  return async ({ ledger, qloo }) => {
    const { data } = await qloo.insights({ filterType: urn, entityIds: compIds(ledger), take: 6, popularityMax: THRESHOLDS.nichePopularityMax });
    const probe = data.map(slim);
    ledger.domains[urn] = { ...ledger.domains[urn], probe };
    return {
      observations: [`Niche ${DOMAINS[urn]} picks (popularity ≤ ${pct(THRESHOLDS.nichePopularityMax)}): ${probe.slice(0, 3).map((e) => e.name).join(', ')}`],
      decisions: probe[0] ? [`Adding ${probe[0].name} as an under-priced alternative.`] : [],
    };
  };
}

module.exports = {
  THRESHOLDS,
  AGE_LABEL,
  resolveComps,
  findConceptTags,
  tasteDna,
  demographics,
  qlooCompare,
  tasteOverlap,
  conceptFit,
  bridgeSearch,
  domainSweep,
  domainRetry,
  nicheProbe,
  driverShares,
};
