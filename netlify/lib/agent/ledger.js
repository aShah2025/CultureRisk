/**
 * CultureRisk AI — evidence ledger (the agent's working memory).
 *
 * A compact, JSON-serialisable record of every Qloo fact gathered during a
 * session, plus the actions taken and the agent's flags. The policy reads it
 * to decide what to do next, and the synthesis step reads it to write the
 * memo, so every number in the report traces back to a recorded Qloo call.
 *
 * The ledger travels with the session state between stateless HTTP steps.
 */

'use strict';

const MAX_CALLS = 80;

function createLedger() {
  return {
    comps: [], // [{query, entityId, name, year, disambiguation, popularity, provenance, exactMatch}]
    droppedComps: [], // queries Qloo could not resolve
    conceptTags: [], // [{theme, tagId, name}]
    tasteDna: [], // [{name, affinity}] — audience-defining tags (urn:tag)
    demographics: null, // {byComp:[{entityId,name,age,gender,headline}], coherence}
    compare: null, // {shared:[names], provenance}
    compLists: null, // [{anchor, entityId, top:[{entityId,name,affinity}]}] per-comp movie neighbours
    blendedFilms: null, // [{entityId,name,affinity,popularity}] films the blended comp audience loves
    coherence: null, // {value, pairs}
    conceptFit: null, // {value, perComp:{name:value}, conceptTop:[names]}
    bridges: null, // [{entityId,name,affinity}]
    leadComp: null, // name
    domains: {}, // urn → {entities, retried, probe:[entities]|null, drivers:{name:share}}
    actions: [], // ids of executed actions (in order)
    flags: {}, // policy flags
    calls: [], // Qloo audit log
    liveData: false,
  };
}

/** Defensive re-hydration of a client-echoed ledger. */
function hydrateLedger(raw) {
  const base = createLedger();
  if (!raw || typeof raw !== 'object') return base;
  const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  return {
    ...base,
    comps: arr(raw.comps, 3),
    droppedComps: arr(raw.droppedComps, 3),
    conceptTags: arr(raw.conceptTags, 9),
    tasteDna: arr(raw.tasteDna, 12),
    demographics: obj(raw.demographics),
    compare: obj(raw.compare),
    compLists: Array.isArray(raw.compLists) ? raw.compLists.slice(0, 3) : null,
    blendedFilms: Array.isArray(raw.blendedFilms) ? raw.blendedFilms.slice(0, 12) : null,
    coherence: obj(raw.coherence),
    conceptFit: obj(raw.conceptFit),
    bridges: Array.isArray(raw.bridges) ? raw.bridges.slice(0, 5) : null,
    leadComp: typeof raw.leadComp === 'string' ? raw.leadComp : null,
    domains: obj(raw.domains) || {},
    actions: arr(raw.actions, 40).map(String),
    flags: obj(raw.flags) || {},
    calls: arr(raw.calls, MAX_CALLS),
    liveData: raw.liveData === true,
  };
}

/** Merge a Qloo service's call log into the ledger. */
function recordCalls(ledger, calls) {
  for (const c of calls) {
    ledger.calls.push(c);
    if (c.provenance === 'live') ledger.liveData = true;
  }
  if (ledger.calls.length > MAX_CALLS) ledger.calls = ledger.calls.slice(-MAX_CALLS);
}

module.exports = { createLedger, hydrateLedger, recordCalls };
