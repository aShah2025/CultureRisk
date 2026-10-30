# CultureRisk AI

**Know the audience before you greenlight.**

CultureRisk is an autonomous research agent for film-studio executives, built entirely on **Qloo's taste graph**. You give it a project and its comparable titles ("it's *X* meets *Y*"). It plans an investigation, runs it across four Qloo endpoints, changes course as the evidence comes in, and delivers a board-ready **greenlight memo**. Every number in the memo traces back to a logged Qloo call.

> Built for the **Qloo Agentic Hackathon** · Qloo Taste AI · Netlify · MIT licensed · also available as an **MCP tool** for any AI agent

**Live demo:** [culturerisk.netlify.app](https://culturerisk.netlify.app) · **Judges:** [try it in 60 seconds](#for-judges-try-it-in-60-seconds)

---

## The problem

A studio greenlight commits **$30M–$300M**, and the core risk model is the comparable-title pitch: "*La La Land* meets *Hereditary*". Nobody checks whether those two audiences overlap, whether the script's own themes attract the same people, or which brands and artists those people love before the market prices them in. The answer usually comes from test screenings, months later, after the money has been spent.

## Why this only works with Qloo

None of these questions can be answered from box-office data or from a language model's general knowledge. They need measured, cross-domain taste data:

| Question | Qloo capability used |
|---|---|
| Do *X*'s and *Y*'s fans actually love the same films? | `/v2/insights` per comp (`filter.type=urn:entity:movie`) → taste-graph overlap; `/v2/analysis/compare` for shared markers |
| Do the comps court the same demographic? | `/v2/insights` with `filter.type=urn:demographics` → age/gender affinity per comp |
| What defines this audience? | Taste analysis: `/v2/insights` with `filter.type=urn:tag` |
| Does the script's own concept match its comps? | `/v2/tags` (themes → tag IDs) → `/v2/insights` with `signal.interests.tags`, compared against the comps' audience |
| Which brands, artists, locations, shows and podcasts should we partner with? | `/v2/insights` per domain with `signal.interests.entities` + `signal.interests.tags` |
| Which comp is driving each recommendation? | `feature.explainability=true` |
| Where are the under-priced partners? | Affinity vs popularity, then a niche probe with `filter.popularity.max` |
| Which "Blade Runner" did you mean? | `/search` with popularity-ranked disambiguation |

**What you'd get wrong without Qloo.** The memo includes a *popularity trap* section: the most famous names in each domain that this audience is lukewarm on. These are the obvious, expensive picks a partnership team would default to without taste data.

## How the agent works

CultureRisk isn't a chatbot or a prompt wrapper. It's a goal-driven agent loop with deterministic, auditable policies:

```
goal ─▶ plan ─▶ act (Qloo) ─▶ observe ─▶ update evidence ledger ─▶ re-plan ─▶ … ─▶ synthesize memo
```

**Base investigation** (always runs):
resolve comps → map script themes to tags → taste DNA → demographics → comp taste overlap → Qloo native compare → concept fit → one sweep per partner domain

**Adaptive branches** (run only when the evidence calls for them):

| Trigger observed in Qloo data | What the agent does next |
|---|---|
| Comp taste overlap < 35% **or** demographic similarity < 45% | **Bridge search:** finds titles whose audience spans both comps and the concept, then recommends one for the pitch deck |
| A domain's alignment < 60/100 | **Re-query** that domain using the concept's tag signal; keeps the result only if alignment improves |
| Every pick in a domain is mass-market (mean popularity > 80%, no white space) | **Niche probe** with `filter.popularity.max=0.6` to surface under-priced partners |
| Theme has no Qloo tag | **Broadens** to a fallback theme (e.g. "cyberpunk" → "science fiction") |
| Several titles share a comp's name | **Disambiguates** by exact match and popularity, and flags inexact matches |
| No comp resolves | **Stops** and reports, rather than guessing |

While it works, the **On the desk** panel shows every step live in screenplay type: what the agent set out to do and why, each Qloo call with its exact parameters and provenance, what it *observed*, and what it *decided*. Steps it re-planned are marked.

### The output: audience coverage

Studio executives already read **script coverage**, the short, blunt document that ends in *Pass / Consider / Recommend*. CultureRisk files **audience coverage** in the same format:

- **The stamp:** Recommend, Consider, Rework or Pass, with a 0–100 culture-risk score and the formula behind it.
- **I. The comps:** posters, a taste-overlap diagram, Qloo demographics per comp, and what each comp's fans also watch.
- **II. The audience:** a portrait, the taste DNA, and the films they over-index on.
- **III. The concept:** whether the script's own themes attract the same people, plus bridge titles.
- **IV. Partners:** brands, music, locations, TV and podcasts, each citing its Qloo ID, affinity vs popularity, and which comp drives it.
- **V. Without Qloo:** the famous names this audience shrugs at.
- **VI. Moodboard:** Qloo entity images of this audience's world, for production design and music supervision.
- **VII. Risks and next steps.**
- **Appendices:** the agent's full notes and a ledger of every Qloo call.

**It's interactive, not a static report:**
- **Live comp picker:** typing searches Qloo and shows real posters.
- **Partner explorer:** toggle *Distinctive* ↔ *Mass-market* per category. Click any partner for its evidence (affinity vs popularity, which comp's fans drive it via `feature.explainability`, Qloo tags) and pin it to a **deal sheet** you can export as CSV.
- **Re-run with a bridge title:** one click swaps a bridge title in as a comp and re-runs the agent.

Every chart carries a source line naming the Qloo endpoint and parameters it came from. The document prints cleanly to PDF.

**Why no LLM?** Studios need to defend a greenlight in front of a board. A deterministic agent gives the same answer for the same evidence, can't hallucinate an entity, and every claim is traceable to a Qloo call. The memo is generated from the evidence ledger, and the server verifies every recommended entity ID against what Qloo returned in the session.

### The scorecard

| Metric | Definition |
|---|---|
| **Domain alignment** | Mean Qloo affinity of the top results per partner domain (0–100) |
| **Comp overlap** | Qloo cross-affinity: each comp scored against the other's audience (`filter.results.entities`), calibrated on live pairs (Paddington 2 × Saw ≈ 0.65 → 0; The Revenant × Everest ≈ 0.93 → 1) |
| **Demographic fit** | Cosine similarity of the comps' Qloo age/gender affinity vectors, mapped to 0–100 |
| **Concept fit** | Genre lanes: the comps' own audience filtered by each of the script's Qloo genre tags (`filter.tags`); appetite = how strongly that audience loves films in the lane |
| **Distinctive vs mass-market** | Each partner category is queried twice: unfiltered (household names that top every audience) and inside a popularity band (`filter.popularity.min/max`) for picks specific to this audience |
| **Culture risk** | 100 − weighted mean (40% alignment, 25% overlap, 20% concept fit, 15% demographic fit; missing parts renormalised) + dispersion penalty → **GREENLIGHT / CONDITIONAL / REWORK / PASS**, with deal-breaker gates: comps that don't share an audience cap the verdict at *Consider*; a concept the audience doesn't want caps it at *Rework* |

The memo shows the formula with the actual numbers, so the verdict is explainable.

## Use it inside your own agent (MCP)

CultureRisk is also a **Model Context Protocol server**, so any existing agent can use Qloo-grounded film intelligence as a tool:

```bash
claude mcp add --transport http culturerisk https://<your-site>.netlify.app/api/mcp
```

| Tool | Returns |
|---|---|
| `greenlight_analysis` | Runs the full autonomous investigation. Returns the verdict, risk score, audience portrait, comp and concept findings, recommendations with Qloo IDs, popularity traps, risks and next steps. |
| `audience_affinities` | What the combined audience of the given films over-indexes on in one Qloo domain, with white-space gaps. |

## For judges: try it in 60 seconds

1. Open the live demo. The masthead shows whether Qloo data is **live**.
2. Pick a case study from **the slate** (the risky hybrid is preloaded):
   - **Cyberpunk Neo-Noir:** *Blade Runner 2049* × *Ghost in the Shell*
   - **Royal Period Drama:** *The King's Speech* × *The Favourite*
   - **Elevated Survival:** *The Revenant* × *Everest*
   - **Risky Hybrid: Musical × Horror:** *La La Land* × *Hereditary*. Watch the agent detect the split and go looking for a bridge title.
3. Press **Request coverage** and watch the agent work **on the desk**.
4. Read the coverage: the stamp, the comps face-off, the audience, the partners, *Without Qloo*, and the moodboard. Open *Appendix B* to see every Qloo call.
5. Try your own project, or open **For AI agents** to connect CultureRisk to Claude, Cursor or another MCP client.

## Architecture

```
public/                         Static cockpit (HTML + ES modules, no build step)
netlify/functions/
  agent.js                      GET capabilities · POST one agent step
  mcp.js                        MCP server (JSON-RPC 2.0 over HTTP)
  qloo_bridge.js                Single-shot quick scan
netlify/lib/
  qloo-client.js                Live Qloo client: search, tags, insights, demographics, taste analysis, compare
  qloo-service.js               Per-call fallback + full audit log (the data engine)
  qloo-mock.js                  Deterministic simulator with the same interface
  risk-model.js                 Overlap, demographic fit, white space, scorecard (pure functions)
  agent/
    policy.js                   The planner: which action next, given the evidence so far
    actions.js                  Research actions: Qloo calls → observations → decisions → flags
    runner.js                   One action per request; session state echoed by the client
    ledger.js                   Evidence ledger (the agent's working memory)
    synthesis.js                Memo generation + grounding check
    brief.js / tools.js         Brief validation · MCP tool definitions
tests/                          node:test suite (61 tests)
scripts/dev-server.js           Zero-dependency local server
```

- **Stepwise execution.** Netlify functions are capped at 30 s, so each `POST /api/agent` runs one action and returns the ledger for the browser to echo back. That allows unlimited depth with no session database, and the trace streams live.
- **Resilience.** No key means deterministic simulated data, labelled *simulated* everywhere. Live calls have a 12 s total deadline, including the response body, and retry a brief 429/503 interruption once within that deadline. Failed calls are labelled *fallback* with the error code; reports using both live and simulated evidence are labelled *mixed* and cannot receive high confidence. A search with no matches stays empty instead of inventing a simulated comparable title.
- **Zero runtime dependencies.** The stack is plain Node 20 and browser ES modules.
- **Security.** The Qloo key stays server-side. Endpoints validate all input and cap request size. The site sends a strict CSP and escapes all rendered values. No Qloo response data is stored in the repo.

## Run it yourself

```bash
git clone https://github.com/aShah2025/CultureRisk && cd CultureRisk
cp .env.example .env      # add QLOO_HACKATHON_API_KEY for live data (optional)
npm start                 # http://localhost:8888
npm test
```

**Deploy:** import the repo into Netlify. `netlify.toml` configures everything and runs the tests on each build. Add `QLOO_HACKATHON_API_KEY` under *Site configuration → Environment variables*, then redeploy.

## Who it's for

- **Studio and streamer development executives:** a culture-risk read on every project in the slate before money is committed.
- **Film financiers and completion-bond firms:** an independent, evidence-backed check on the audience thesis.
- **Brand-partnership, music-supervision and live-events teams:** partners ranked by measured audience affinity, with white-space picks priced below their cultural pull.
- **Film commissions and tourism boards:** proof that a location's taste profile matches a production's audience.

## License

[MIT](LICENSE)
