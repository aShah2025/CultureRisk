/**
 * CultureRisk AI — evidence ledger.
 *
 * A compact, JSON-serialisable record of every Qloo fact gathered during an
 * agent session. Both agent engines (Claude and the scripted fallback) write
 * to it through the tool executors, and the final scorecard is computed only
 * from the ledger. So every number in the memo traces back to a Qloo call.
 *
 * The ledger travels with the session state between stateless steps.
 */

'use strict';

const MAX_DOMAIN_ENTITIES = 10;
const MAX_CALLS = 60;

function createLedger() {
  return {
    anchors: [], // [{query, entityId, name, year, provenance}]
    tags: [], // [{query, tagId, name}]
    domains: {}, // urn → entities (blended-signal affinities)
    coherence: null, // {target, coherence, pairs, perAnchor:[{anchor, top:[names]}]}
    calls: [], // Qloo audit log
    liveData: false,
  };
}

/** Defensive re-hydration of a client-echoed ledger. */
function hydrateLedger(raw) {
  const base = createLedger();
  if (!raw || typeof raw !== 'object') return base;
  return {
    anchors: Array.isArray(raw.anchors) ? raw.anchors.slice(0, 12) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 30) : [],
    domains: raw.domains && typeof raw.domains === 'object' ? raw.domains : {},
    coherence: raw.coherence && typeof raw.coherence === 'object' ? raw.coherence : null,
    calls: Array.isArray(raw.calls) ? raw.calls.slice(-MAX_CALLS) : [],
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

function recordAnchor(ledger, query, entity, provenance) {
  if (!entity) return;
  const exists = ledger.anchors.some((a) => a.entityId === entity.entityId);
  if (!exists) {
    ledger.anchors.push({ query, entityId: entity.entityId, name: entity.name, year: entity.year, provenance });
  }
}

function recordDomain(ledger, urn, entities) {
  ledger.domains[urn] = entities.slice(0, MAX_DOMAIN_ENTITIES);
}

module.exports = { createLedger, hydrateLedger, recordCalls, recordAnchor, recordDomain };
