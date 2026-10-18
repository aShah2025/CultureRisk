/**
 * CultureRisk AI — project brief validation and theme extraction.
 */

'use strict';

const { DOMAINS } = require('../config');
const { cleanText } = require('../http');

const MAX_SCRIPT_CHARS = 6000;

/**
 * Theme detectors: script keywords → a Qloo tag search phrase, plus a
 * broader fallback phrase the agent tries if the first finds nothing.
 */
const THEMES = [
  { re: /cyber|neon|android|synthetic|dystop|megastructure/i, query: 'cyberpunk', fallback: 'science fiction' },
  { re: /noir|detective|forensic|crime|investigat/i, query: 'neo-noir', fallback: 'crime' },
  { re: /royal|king|queen|princess|regent|empire|parliament|monarch/i, query: 'historical', fallback: 'biography' },
  { re: /19[0-4]\d|victorian|georgian|period|historical/i, query: 'period piece', fallback: 'historical' },
  { re: /survival|arctic|expedition|wilderness|stranded|ice shelf/i, query: 'survival', fallback: 'adventure' },
  { re: /horror|haunt|ghost|demon|summon/i, query: 'supernatural horror', fallback: 'horror' },
  { re: /grief|mourning|loss/i, query: 'grief', fallback: 'drama' },
  { re: /musical|jazz|pianist|song|singer/i, query: 'musical', fallback: 'music' },
  { re: /romance|love story|affair/i, query: 'romance', fallback: 'romantic drama' },
  { re: /comedy|satire|witty/i, query: 'satire', fallback: 'comedy' },
  { re: /war|battle|soldier/i, query: 'war', fallback: 'military' },
  { re: /memory|identity|consciousness/i, query: 'identity', fallback: 'psychological' },
];

/** Up to `max` distinct theme probes found in the script. */
function extractThemes(script, max = 3) {
  const out = [];
  for (const t of THEMES) {
    if (t.re.test(script || '') && !out.some((o) => o.query === t.query)) out.push({ query: t.query, fallback: t.fallback });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Validate and normalise the project brief from the client.
 * @returns {{ok: true, brief: object} | {ok: false, message: string}}
 */
function normalizeBrief(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, message: 'brief is required.' };
  const title = cleanText(raw.title, 120) || 'Untitled Project';
  const script = cleanText(raw.script, MAX_SCRIPT_CHARS);
  const anchors = [...new Set(
    (Array.isArray(raw.anchors) ? raw.anchors : String(raw.anchors || '').split(','))
      .map((a) => cleanText(String(a), 120))
      .filter(Boolean),
  )].slice(0, 3);
  if (anchors.length === 0) return { ok: false, message: 'At least one comparable title is required.' };

  const domains = (Array.isArray(raw.domains) ? raw.domains : []).filter((d) => Object.prototype.hasOwnProperty.call(DOMAINS, d));
  const budget = Number(raw.budgetMillions);

  return {
    ok: true,
    brief: {
      title,
      script,
      anchors,
      domains: domains.length ? [...new Set(domains)] : ['urn:entity:brand', 'urn:entity:artist', 'urn:entity:destination'],
      budgetMillions: Number.isFinite(budget) && budget > 0 && budget < 1000 ? Math.round(budget) : null,
    },
  };
}

module.exports = { normalizeBrief, extractThemes };
