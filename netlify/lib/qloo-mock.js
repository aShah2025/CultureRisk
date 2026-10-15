/**
 * CultureRisk AI — simulated Qloo backend.
 *
 * Mirrors the live client's interface (search, tags, insights, demographics,
 * tasteTags, compare) with deterministic, studio-plausible data. The whole
 * product, including the autonomous agent, runs end to end with no Qloo key and
 * degrades gracefully when a live call fails.
 *
 * Determinism: every score is a baseline plus a jitter derived from an FNV-1a
 * hash of the request signals. The same request always returns the same
 * answer (reproducible demos), and different anchors produce *different*
 * rankings and demographics, so the agent's comparisons stay meaningful in
 * simulation.
 *
 * All IDs carry a `mock:` prefix so simulated data can never be mistaken for
 * real Qloo entities. No real Qloo response data is stored in this repository.
 */

'use strict';

/** Deterministic 32-bit FNV-1a hash. */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic jitter in [-spread, +spread]. */
function jitter(seed, spread) {
  return (((hashString(seed) % 10000) / 10000) * 2 - 1) * spread;
}

function slug(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

const round3 = (n) => Math.round(n * 1000) / 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* -------------------------------------------------------------------------- */
/* Baseline library: [name, baseAffinity, basePopularity, tags]                */
/* -------------------------------------------------------------------------- */

const LIBRARY = Object.freeze({
  'urn:entity:brand': [
    ['Porsche', 0.88, 0.88, ['Luxury Automotive', 'Design-Led']],
    ['Bang & Olufsen', 0.84, 0.71, ['Premium Audio', 'Scandinavian Design']],
    ['Patagonia', 0.8, 0.84, ['Outdoor', 'Values-Driven']],
    ['Rolex', 0.78, 0.93, ['Luxury Horology', 'Heritage']],
    ['Apple', 0.74, 0.98, ['Consumer Tech', 'Mass Premium']],
    ['Aesop', 0.72, 0.58, ['Luxury Grooming', 'Tastemaker']],
    ['Arc\'teryx', 0.76, 0.69, ['Technical Outerwear', 'Gorpcore']],
    ['Burberry', 0.7, 0.86, ['British Heritage', 'Luxury Fashion']],
    ['Sony', 0.73, 0.94, ['Consumer Electronics', 'Gaming']],
    ['Fortnum & Mason', 0.66, 0.55, ['Heritage Retail', 'Gifting']],
    ['Leica', 0.75, 0.52, ['Photography', 'Craft']],
    ['Liquid Death', 0.62, 0.66, ['Irreverent Beverage', 'Gen Z']],
  ],
  'urn:entity:artist': [
    ['Hans Zimmer', 0.9, 0.95, ['Film Score', 'Epic Orchestral']],
    ['Max Richter', 0.86, 0.74, ['Neo-Classical', 'Contemplative']],
    ['Vangelis', 0.83, 0.79, ['Synth Score', 'Legacy Icon']],
    ['Daft Punk', 0.79, 0.92, ['Electronic', 'Pop Crossover']],
    ['Hildur Guðnadóttir', 0.77, 0.66, ['Avant-Garde Score', 'Awards Pedigree']],
    ['Ludovico Einaudi', 0.73, 0.83, ['Minimalist Piano', 'Streaming Native']],
    ['Jóhann Jóhannsson', 0.78, 0.61, ['Ambient Orchestral', 'Arthouse']],
    ['Alexandre Desplat', 0.75, 0.72, ['Classical Score', 'Period Drama']],
    ['Nine Inch Nails', 0.71, 0.81, ['Industrial', 'Score Crossover']],
    ['Florence + The Machine', 0.68, 0.85, ['Baroque Pop', 'Cinematic Vocal']],
    ['Phoebe Bridgers', 0.66, 0.8, ['Indie Folk', 'Melancholy']],
    ['Justin Hurwitz', 0.7, 0.6, ['Jazz Score', 'Musical Theatre']],
  ],
  'urn:entity:destination': [
    ['Tokyo, Japan', 0.89, 0.94, ['Neon Metropolis', 'Tech Culture']],
    ['Reykjavík, Iceland', 0.84, 0.69, ['Sublime Landscape', 'Production Incentives']],
    ['Edinburgh, Scotland', 0.81, 0.77, ['Historic Architecture', 'Period Authenticity']],
    ['Los Angeles, USA', 0.77, 0.97, ['Industry Hub', 'Domestic Core']],
    ['Berlin, Germany', 0.76, 0.81, ['Brutalist Modern', 'Creative Economy']],
    ['Kyoto, Japan', 0.72, 0.75, ['Heritage Craft', 'Contemplative']],
    ['Bath, England', 0.74, 0.62, ['Georgian Architecture', 'Period Locations']],
    ['Hong Kong', 0.79, 0.88, ['Vertical City', 'Neo-Noir']],
    ['Svalbard, Norway', 0.7, 0.41, ['Arctic Wilderness', 'Extreme Terrain']],
    ['Budapest, Hungary', 0.73, 0.79, ['Stand-In City', 'Studio Infrastructure']],
    ['Patagonia, Chile', 0.71, 0.58, ['Wilderness', 'Adventure Travel']],
    ['New Orleans, USA', 0.67, 0.83, ['Gothic Atmosphere', 'Music City']],
  ],
  'urn:entity:tv_show': [
    ['Severance', 0.87, 0.84, ['Psychological Thriller', 'Prestige Streaming']],
    ['The Crown', 0.82, 0.9, ['Royal Drama', 'Prestige']],
    ['Westworld', 0.8, 0.82, ['Sci-Fi', 'Philosophical']],
    ['True Detective', 0.78, 0.86, ['Neo-Noir', 'Anthology']],
    ['Shōgun', 0.79, 0.8, ['Period Epic', 'International']],
    ['Black Mirror', 0.76, 0.89, ['Techno-Dystopia', 'Anthology']],
    ['Downton Abbey', 0.71, 0.88, ['Period Drama', 'Comfort Viewing']],
    ['The Bear', 0.68, 0.87, ['Character Drama', 'Cultural Zeitgeist']],
    ['Arcane', 0.74, 0.83, ['Animated', 'Cyberpunk']],
    ['Frozen Planet II', 0.66, 0.7, ['Nature Documentary', 'Survival']],
    ['The Haunting of Hill House', 0.7, 0.81, ['Grief Horror', 'Prestige Horror']],
  ],
  'urn:entity:podcast': [
    ['Blank Check with Griffin & David', 0.85, 0.66, ['Film Criticism', 'Auteur Deep-Dives']],
    ['The Rest Is History', 0.79, 0.83, ['History', 'British']],
    ['Radiolab', 0.76, 0.81, ['Science', 'Narrative']],
    ['The Big Picture', 0.83, 0.74, ['Film Industry', 'Awards Season']],
    ['Lex Fridman Podcast', 0.72, 0.9, ['Technology', 'Long-Form']],
    ['99% Invisible', 0.74, 0.77, ['Design', 'Architecture']],
    ['You Must Remember This', 0.77, 0.58, ['Hollywood History', 'Narrative']],
    ['Song Exploder', 0.73, 0.64, ['Music Process', 'Soundtrack']],
    ['Huberman Lab', 0.63, 0.92, ['Health', 'Mass Reach']],
    ['Revisionist History', 0.7, 0.85, ['Narrative Nonfiction', 'Mainstream']],
  ],
  'urn:entity:movie': [
    ['Arrival', 0.86, 0.85, ['Cerebral Sci-Fi', 'Denis Villeneuve']],
    ['Ex Machina', 0.84, 0.82, ['AI Thriller', 'A24']],
    ['Dune', 0.82, 0.95, ['Epic Sci-Fi', 'Spectacle']],
    ['Her', 0.78, 0.8, ['Melancholy Romance', 'Near Future']],
    ['Akira', 0.8, 0.74, ['Anime', 'Cyberpunk']],
    ['The Favourite', 0.77, 0.76, ['Period Satire', 'Yorgos Lanthimos']],
    ['Phantom Thread', 0.74, 0.7, ['Period Romance', 'Auteur']],
    ['Midsommar', 0.75, 0.81, ['Folk Horror', 'A24']],
    ['Whiplash', 0.73, 0.88, ['Music Drama', 'Intensity']],
    ['The Lighthouse', 0.71, 0.66, ['Psychological Horror', 'Arthouse']],
    ['Mad Max: Fury Road', 0.76, 0.93, ['Action Spectacle', 'Practical Effects']],
    ['Little Women', 0.69, 0.84, ['Period Drama', 'Ensemble']],
    ['The Witch', 0.72, 0.72, ['Period Horror', 'A24']],
    ['Annihilation', 0.79, 0.7, ['Weird Sci-Fi', 'Cult']],
  ],
});

/** Lexicon for simulated tag search and taste analysis. */
const TAG_LEXICON = [
  [/cyber|neon|dystop|android|synthetic|future|sci/i, ['Cyberpunk', 'Science Fiction', 'Dystopian']],
  [/noir|detective|crime|forensic|thriller/i, ['Neo-Noir', 'Crime Thriller', 'Mystery']],
  [/royal|king|queen|princess|regent|empire|period|victorian|1[6-9]\d\d/i, ['Period Drama', 'British Royalty', 'Historical']],
  [/survival|arctic|expedition|wilderness|stranded|ice/i, ['Survival', 'Adventure', 'Wilderness']],
  [/love|romance|affair/i, ['Romance', 'Romantic Drama']],
  [/music|musical|jazz|song/i, ['Musical', 'Jazz', 'Music Drama']],
  [/comedy|funny|satire/i, ['Comedy', 'Satire']],
  [/war|battle|soldier/i, ['War', 'Military Drama']],
  [/horror|haunt|ghost|demon|grief/i, ['Horror', 'Supernatural', 'Psychological Horror']],
  [/award|prestige|oscar/i, ['Awards Contender', 'Prestige Drama']],
];

const TASTE_POOL = [
  'Atmospheric', 'Slow Burn', 'Visually Stunning', 'Thought-Provoking', 'Cult Classic', 'Dark',
  'Witty', 'Melancholy', 'Stylish', 'Cerebral', 'Emotional', 'Epic', 'Quirky', 'Gritty',
  'Romantic', 'Suspenseful', 'Auteur-Driven', 'Feel-Good', 'Bleak', 'Inspirational',
];

const AGE_BUCKETS = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];

/* -------------------------------------------------------------------------- */
/* Simulated client                                                            */
/* -------------------------------------------------------------------------- */

function rankLibrary(filterType, seed, { take, popularityMax = null }) {
  const library = LIBRARY[filterType] || LIBRARY['urn:entity:brand'];
  return library
    .map(([name, affinity, popularity, tags]) => ({
      entityId: `mock:${filterType.split(':').pop()}:${slug(name)}`,
      name,
      type: filterType,
      year: null,
      disambiguation: null,
      affinity: round3(clamp(affinity + jitter(`${seed}|a|${name}`, 0.12), 0.35, 0.99)),
      popularity: round3(clamp(popularity + jitter(`${seed}|p|${name}`, 0.03), 0.3, 0.99)),
      audienceGrowth: round3(jitter(`${seed}|g|${name}`, 0.08)),
      explainability: null,
      image: null,
      tags,
    }))
    .filter((e) => popularityMax === null || e.popularity <= popularityMax)
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, take);
}

function createMockQlooClient() {
  return {
    async search(query, type, take = 3) {
      const base = slug(query);
      const kind = type.split(':').pop();
      const primary = {
        entityId: `mock:${kind}:${base}`,
        name: query,
        type,
        year: null, // never fabricate release years
        disambiguation: null,
        affinity: null,
        popularity: round3(0.55 + ((hashString(`${base}|pop`) % 400) / 1000)),
        audienceGrowth: null,
        explainability: null,
        image: null,
        tags: [],
      };
      return [primary].slice(0, take);
    },

    async tags(query, take = 5) {
      const names = new Set();
      for (const [re, tagNames] of TAG_LEXICON) {
        if (re.test(query)) tagNames.forEach((n) => names.add(n));
      }
      if (names.size === 0) names.add(query.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40));
      return [...names].slice(0, take).map((name) => ({
        tagId: `mock:tag:${slug(name)}`,
        name,
        type: 'urn:tag:genre:media',
        affinity: null,
      }));
    },

    async insights({ filterType, entityIds = [], tagIds = [], take = 8, explain = false, popularityMax = null }) {
      const seed = `${filterType}|${[...entityIds].sort().join(',')}|${[...tagIds].sort().join(',')}`;
      const ranked = rankLibrary(filterType, seed, { take, popularityMax });
      if (explain && entityIds.length) {
        ranked.forEach((e) => {
          const raw = entityIds.map((id) => 0.2 + ((hashString(`${seed}|x|${e.name}|${id}`) % 800) / 1000));
          const total = raw.reduce((s, v) => s + v, 0);
          e.explainability = Object.fromEntries(entityIds.map((id, i) => [id, round3(raw[i] / total)]));
        });
      }
      return ranked;
    },

    async demographics({ entityIds = [], tagIds = [] }) {
      return [...entityIds, ...tagIds].map((id) => {
        const peak = hashString(`${id}|peak`) % AGE_BUCKETS.length;
        const age = Object.fromEntries(AGE_BUCKETS.map((b, i) => [
          b,
          round2(clamp(0.55 - Math.abs(i - peak) * 0.28 + jitter(`${id}|${b}`, 0.12), -0.9, 0.9)),
        ]));
        const male = round2(jitter(`${id}|gender`, 0.35));
        return { id, age, gender: { male, female: round2(-male) } };
      });
    },

    async tasteTags({ entityIds = [], tagIds = [], take = 10 }) {
      const seed = [...entityIds, ...tagIds].sort().join(',');
      return TASTE_POOL
        .map((name) => ({ tagId: `mock:tag:${slug(name)}`, name, type: 'urn:tag:keyword:media', affinity: round3(0.5 + jitter(`${seed}|t|${name}`, 0.45)) }))
        .sort((a, b) => b.affinity - a.affinity)
        .slice(0, take);
    },

    async compare({ a = [], b = [], take = 10 }) {
      const ta = await this.tasteTags({ entityIds: a, take: 12 });
      const tb = await this.tasteTags({ entityIds: b, take: 12 });
      const shared = ta.filter((t) => tb.some((x) => x.tagId === t.tagId));
      return shared.slice(0, take).map((t) => ({ name: t.name, id: t.tagId }));
    },
  };
}

module.exports = { createMockQlooClient, hashString, jitter, LIBRARY, AGE_BUCKETS };
