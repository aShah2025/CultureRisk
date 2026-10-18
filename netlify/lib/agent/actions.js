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
  domainProfile, whiteSpace, pairCoherence, demographicCoherence, demographicHeadline,
} = require('../risk-model');

/** Thresholds that trigger follow-up research. Tuned to be conservative. */
const THRESHOLDS = Object.freeze({
  divergentComps: 0.35, // taste coherence below this → bridge search
  demoSplit: 0.45, // demographic coherence below this → bridge search
  conceptDrift: 0.15, // concept-to-comp fit below this → flag drift
  weakDomain: 60, // domain alignment below this → retry with concept signal
  // Qloo popularity is a percentile; household names sit at ~0.99. The
  // "distinctive" band excludes them (and entities with no popularity data).
  distinctiveMin: 0.3,
  distinctiveMax: 0.95,
  nichePopularityMax: 0.8,
});

const MOVIE = 'urn:entity:movie';
const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : 'n/a');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slim = (e) => ({ entityId: e.entityId, name: e.name, affinity: e.affinity, popularity: e.popularity, audienceGrowth: e.audienceGrowth ?? null, explainability: e.explainability ?? null, image: e.image ?? null, tags: e.tags || [] });
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
      popularity: pick.popularity, image: pick.image ?? null, provenance, exactMatch: Boolean(exact[0]),
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
    // Prefer Qloo's media genre tags (they power filter.tags); then subgenres, then keywords.
    const rank = (t) => (/^urn:tag:genre:media:/.test(t.tagId) ? 0 : /subgenre/.test(t.tagId) ? 1 : 2);
    tags = [...tags].sort((a, b) => rank(a) - rank(b));
    tags.slice(0, 1).forEach((t) => {
      if (!ledger.conceptTags.some((x) => x.tagId === t.tagId)) ledger.conceptTags.push({ theme: themes[i].query, fallback: themes[i].fallback, tagId: t.tagId, name: t.name });
    });
    observations.push(`Theme "${themes[i].query}" → ${tags.slice(0, 2).map((t) => t.name).join(', ') || 'no tags'}`);
  }
  if (ledger.conceptTags.length) decisions.push(`Will use ${ledger.conceptTags.length} concept tag(s) to test whether the script's own audience matches the comps.`);
  return { observations, decisions };
}

async function tasteDna({ ledger, qloo }) {
  const { data } = await qloo.tasteTags({ entityIds: compIds(ledger), take: 10, tagTypes: ['urn:tag:genre:media'], parentTypes: ['urn:entity:movie'] });
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
  const notComp = (e) => !ids.includes(e.entityId) && !ledger.comps.some((c) => norm(c.name) === norm(e.name));
  // Sequential on purpose: parallel bursts trip Qloo timeouts on the hackathon tier.
  const blended = await qloo.insights({ filterType: MOVIE, entityIds: ids, excludeIds: ids, take: 12 });
  ledger.blendedFilms = blended.data.filter(notComp).map(slim);
  const observations = [`The blended comp audience also loves: ${ledger.blendedFilms.slice(0, 4).map((e) => e.name).join(', ')}`];
  const decisions = [];
  if (ids.length < 2) return { observations, decisions };

  const perComp = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    perComp.push(await qloo.insights({ filterType: MOVIE, entityIds: [id], excludeIds: ids, take: 10 }));
  }
  ledger.compLists = ledger.comps.map((c, i) => ({ anchor: c.name, entityId: c.entityId, provenance: perComp[i].provenance, top: perComp[i].data.filter(notComp).map(slim) }));

  // Cross-affinity: score each comp directly against the other comp's audience
  // (filter.results.entities). Symmetric in Qloo, so one call per pair.
  const pairs = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await qloo.insights({ filterType: MOVIE, entityIds: [ids[i]], filterResults: [ids[j]], take: 1 });
      const affinity = r.data[0]?.affinity ?? null;
      const shared = pairCoherence(ledger.compLists[i].top, ledger.compLists[j].top, 10).shared;
      pairs.push({ a: ledger.comps[i].name, b: ledger.comps[j].name, affinity, score: affinity === null ? null : crossScore(affinity), shared, provenance: r.provenance });
    }
  }

  // Never score a comparison that mixes live and simulated answers.
  const provenances = new Set([...perComp.map((r) => r.provenance), ...pairs.map((p) => p.provenance)]);
  const scored = pairs.filter((p) => p.score !== null);
  if (provenances.size > 1 || !scored.length) {
    ledger.coherence = null;
    decisions.push('Comp overlap not scored: Qloo did not return every comparison from the same live source.');
    return { observations, decisions };
  }
  const value = Math.round((scored.reduce((x, p) => x + p.score, 0) / scored.length) * 1000) / 1000;
  ledger.coherence = { value, pairs, method: 'cross-affinity' };
  pairs.forEach((p) => observations.push(`${p.a} fans' affinity for ${p.b}: ${p.affinity?.toFixed(3) ?? 'n/a'} (${p.shared} shared titles in their top 10s)`));
  observations.push(`Comp overlap score: ${pct(value)}`);
  if (value < THRESHOLDS.divergentComps) {
    ledger.flags.divergent = true;
    decisions.push('The comps\' audiences barely like each other\'s films, so the "X meets Y" audience may not exist. Scheduling a bridge-title search.');
  } else if (value < 0.55) {
    decisions.push('Partial overlap: a hybrid audience exists but is narrower than either comp. Will size recommendations to the overlap.');
  } else {
    decisions.push('The comps share a real audience. The hybrid pitch holds.');
  }
  return { observations, decisions };
}

/** Map a lane's mean Qloo affinity onto 0–1 (0.80 → weak appetite, 0.95 → core appetite). */
/**
 * Map a cross-affinity onto 0–1. Calibrated on live Qloo pairs:
 * Paddington 2 × Saw ≈ 0.65 (unrelated audiences) → 0; The Revenant × Everest ≈ 0.93 → 1.
 */
const crossScore = (affinity) => Math.round(Math.min(1, Math.max(0, (affinity - 0.65) / 0.28)) * 1000) / 1000;

const laneStrength = (meanAffinity) => Math.round(Math.min(1, Math.max(0, (meanAffinity - 0.8) / 0.15)) * 1000) / 1000;

async function conceptFit({ ledger, qloo }) {
  const ids = compIds(ledger);
  const lanes = [];
  // One lane per concept tag: the comps' own audience, filtered to that genre (filter.tags).
  for (let tag of ledger.conceptTags.slice(0, 3)) {
    // eslint-disable-next-line no-await-in-loop
    let { data, provenance } = await qloo.insights({ filterType: MOVIE, entityIds: ids, filterTags: [tag.tagId], excludeIds: ids, take: 6 });
    if (!data.length && tag.fallback) {
      // Qloo has no films under this exact tag for this audience; retry with the broader genre.
      // eslint-disable-next-line no-await-in-loop
      const broader = (await qloo.tags(tag.fallback, 3)).data.find((t) => /^urn:tag:genre:media:/.test(t.tagId));
      if (broader && !ledger.conceptTags.some((x) => x.tagId === broader.tagId)) {
        // eslint-disable-next-line no-await-in-loop
        ({ data, provenance } = await qloo.insights({ filterType: MOVIE, entityIds: ids, filterTags: [broader.tagId], excludeIds: ids, take: 6 }));
        if (data.length) tag = { ...tag, name: `${tag.name} → ${broader.name}`, tagId: broader.tagId };
      }
    }
    const films = data.map(slim);
    const affs = films.map((f) => f.affinity).filter((a) => typeof a === 'number');
    const mean = affs.length ? affs.reduce((x, y) => x + y, 0) / affs.length : null;
    lanes.push({ tag: tag.name, tagId: tag.tagId, provenance, films, meanAffinity: mean === null ? null : Math.round(mean * 1000) / 1000, strength: mean === null ? null : laneStrength(mean) });
  }
  const scored = lanes.filter((l) => l.strength !== null);
  const mixed = new Set(lanes.map((l) => l.provenance)).size > 1;
  const value = scored.length && !mixed ? Math.round((scored.reduce((x, l) => x + l.strength, 0) / scored.length) * 1000) / 1000 : null;

  // Lead comp: whose own watchlist shares the most titles with the concept lanes.
  const laneNames = new Set(lanes.flatMap((l) => l.films.map((f) => norm(f.name))));
  const perComp = {};
  (ledger.compLists || []).forEach((l) => { perComp[l.anchor] = l.top.filter((f) => laneNames.has(norm(f.name))).length; });
  const lead = Object.entries(perComp).sort((a, b) => b[1] - a[1])[0];
  if (lead && lead[1] > 0) ledger.leadComp = lead[0];
  ledger.conceptFit = { value, lanes, perComp, conceptTop: lanes.flatMap((l) => l.films.slice(0, 2).map((f) => f.name)).slice(0, 6) };

  const observations = lanes.map((l) => `${l.tag} lane: ${l.films.slice(0, 3).map((f) => f.name).join(', ')} (appetite ${pct(l.strength)})`);
  const decisions = [];
  if (mixed) decisions.push('Concept fit not scored: Qloo returned the genre lanes from different sources.');
  if (ledger.leadComp && Object.keys(perComp).length > 1) decisions.push(`The concept's genres sit closest to ${ledger.leadComp}'s audience. Lead the positioning with it.`);
  const weak = scored.filter((l) => l.strength < 0.35);
  if (value !== null && value < THRESHOLDS.conceptDrift * 3) {
    ledger.flags.conceptDrift = true;
    decisions.push('This audience has little appetite for the script\'s genres. Flagging concept drift as a risk.');
  } else if (weak.length) {
    decisions.push(`Weak lane: ${weak.map((l) => l.tag).join(', ')}. That part of the concept will need its own marketing.`);
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
    const ids = compIds(ledger);
    // 1) What Qloo ranks first with no filter: usually household names every audience over-indexes on.
    const mainstream = await qloo.insights({ filterType: urn, entityIds: ids, take: 6 });
    // 2) The distinctive band: drop household names, keep what is specific to this audience.
    const distinctive = await qloo.insights({
      filterType: urn, entityIds: ids, tagIds: conceptTagIds(ledger, 1), take: 10, explain: ids.length > 1,
      popularityMin: THRESHOLDS.distinctiveMin, popularityMax: THRESHOLDS.distinctiveMax,
    });
    const entities = distinctive.data.filter((e) => (e.popularity ?? 0) > 0).map(slim);
    const mass = mainstream.data.map(slim);
    const profile = domainProfile(entities);
    const drivers = driverShares(entities, ledger.comps);
    ledger.domains[urn] = { entities, mainstream: mass, retried: false, probe: null, drivers };

    const observations = [
      `${DOMAINS[urn]}, mass-market: ${mass.slice(0, 3).map((e) => e.name).join(', ')}`,
      `${DOMAINS[urn]}, distinctive to this audience: ${entities.slice(0, 3).map((e) => e.name).join(', ') || 'none found'} (alignment ${profile.alignment ?? 'n/a'}/100)`,
    ];
    if (drivers) {
      const top = Object.entries(drivers).sort((a, b) => b[1] - a[1])[0];
      observations.push(`Explainability: ${top[0]} drives ${pct(top[1])} of the distinctive picks`);
    }
    const decisions = [];
    if (entities.length < 3) {
      ledger.flags[`probe:${urn}`] = true;
      decisions.push(`Too few distinctive ${DOMAINS[urn].toLowerCase()} picks. Will widen the search below the ${pct(THRESHOLDS.nichePopularityMax)} popularity line.`);
    } else if (profile.alignment !== null && profile.alignment < THRESHOLDS.weakDomain) {
      ledger.flags[`retry:${urn}`] = true;
      decisions.push(`Weak alignment. Will re-query ${DOMAINS[urn]} using the concept signal.`);
    } else {
      decisions.push(`Shortlisting ${entities[0].name} over the mass-market default ${mass[0]?.name ?? ''}.`.trim());
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
    const { data } = await qloo.insights({ filterType: urn, entityIds: compIds(ledger), take: 6, popularityMin: 0.05, popularityMax: THRESHOLDS.nichePopularityMax });
    const probe = data.filter((e) => (e.popularity ?? 0) > 0).map(slim);
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
