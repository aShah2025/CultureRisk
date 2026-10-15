# CultureRisk AI

**Know the audience before you greenlight.**

CultureRisk is an AI agent for film-studio executives. You give it a project and its comparable titles ("it's *X* meets *Y*"). It plans and runs its own research against **Qloo's cross-domain taste graph**, checks whether the comparable titles actually share an audience, finds under-priced brand, music and location partners, and writes a board-ready **greenlight memo**. Every claim in the memo traces back to a Qloo API call.

> Built for the **Qloo Agentic Hackathon** · Claude agent + Qloo Taste AI · Netlify · MIT licensed

**Live demo:** _add your Netlify URL here_ · **Try it in 60 seconds:** [see "For judges"](#for-judges-try-it-in-60-seconds)

---

## Why this needs Qloo, not just an LLM

Studios commit **$30M–$300M** at greenlight, mostly on instinct and comparable-title math. The "X meets Y" pitch is the industry's core risk model, and nobody checks whether X's audience and Y's audience actually overlap.

An LLM alone can't answer this. It can describe *Blade Runner 2049* fans, but it has no measured data on what they love across brands, music and travel, or how that compares with *Ghost in the Shell* fans. Qloo does. CultureRisk proves the difference inside the product:

**Qloo vs LLM-only blind-spot report.** While the agent works, the same model is asked, with no Qloo access, to guess this audience's brands, artists and places. The cockpit then diffs those guesses against Qloo's results and shows the share of audience signals **only Qloo surfaced**. Those are the partnerships and locations a generic model would have missed.

## What the agent does

```
Brief ──▶ Claude (plans the research) ──▶ Qloo tools ──▶ evidence ledger ──▶ memo + deterministic scorecard
```

| Step | Tool | Qloo endpoint |
|---|---|---|
| Resolve each comparable title to a Qloo entity, catching remakes and same-name titles | `resolve_entities` | `GET /search` |
| Turn the script's themes into taste tags | `find_taste_tags` | `GET /v2/tags` |
| Map the audience across domains: brands, music, destinations, TV, podcasts | `get_audience_affinities` | `GET /v2/insights` (`filter.type`, `signal.interests.entities`, `signal.interests.tags`) |
| **Stress-test the "X meets Y" pitch**: query each comp separately and measure taste-graph overlap | `stress_test_comps` | `GET /v2/insights` × N |
| Write the greenlight memo (strict JSON schema) | `submit_greenlight_memo` | n/a |

Claude decides which calls to make and in what order (in parallel where it can), reacts to what Qloo returns, and narrates each step. The cockpit streams that reasoning and every Qloo call live.

### Original metrics, computed only from Qloo data

- **Comp coherence.** Jaccard overlap of each comp's top Qloo affinities, blended with rank agreement. A low score means the hybrid audience the pitch assumes may not exist. Try the *Musical × Horror* preset.
- **White space.** Entities whose Qloo affinity clearly exceeds their mainstream popularity. These partners over-index with this audience but aren't saturated, so they're cheaper to sign and more distinctive.
- **Domain alignment and dispersion.** How strongly, and how consistently, the audience gravitates to each domain.
- **Culture-risk score and verdict.** A composite of the metrics above: GREENLIGHT, CONDITIONAL, REWORK or PASS.

### Trust by design

- **Two verdicts.** The agent gives a reasoned verdict. A deterministic risk model, which never touches the LLM, gives a second verdict computed straight from the Qloo evidence ledger. If they disagree, the UI says so.
- **Hallucination guard.** Each recommendation must cite a Qloo entity ID. The server checks every ID against what Qloo actually returned this session and flags anything unverified.
- **Full audit trail.** The Evidence tab lists every Qloo call with its endpoint, signals, provenance (live, fallback or simulated), result count and latency.
- **Export.** Copy the memo as Markdown, or download the full evidence bundle as JSON.

## Architecture

```
public/                      Static cockpit: HTML + ES modules, no build step
  js/session.js              Stepwise agent loop (retries, stop button)
  js/blindspot.js            Qloo vs LLM-only diff
netlify/functions/
  agent.js                   GET capabilities · POST one agent step
  baseline.js                LLM-only guesses (structured output)
  qloo_bridge.js             Single-shot quick scan
netlify/lib/
  qloo-client.js             Live Qloo client (timeouts, normalisation, typed errors)
  qloo-service.js            Per-call fallback + audit log (the data engine)
  qloo-mock.js               Deterministic simulator (same interface)
  risk-model.js              Coherence, white space, scorecard (pure functions)
  agent/
    tools.js                 Strict-schema tool definitions + validated executors
    claude-runner.js         One Claude turn per request; echoes thinking blocks
    scripted-runner.js       No-LLM fallback planner through the same tools
    ledger.js                Evidence ledger carried between steps
    finalize.js              Scorecard, grounding check, memo composer
    prompt.js                System prompt, brief validation
tests/                       node:test suite (risk math, Qloo client, both engines, handlers)
scripts/dev-server.js        Zero-dependency local server
```

**Why stepwise?** Netlify synchronous functions are capped at 30 seconds. Each `POST /api/agent` runs exactly one Claude turn and its tool calls, then returns the session state for the browser to echo back. The result is unlimited agent depth, no session database, and a live trace for free. Assistant content, including thinking blocks, is echoed back unchanged, as the API requires.

**Resilience.** The app never shows a blank screen:

| Missing | Behaviour |
|---|---|
| `QLOO_HACKATHON_API_KEY` | Deterministic simulated Qloo data, labelled **simulated** everywhere |
| A live Qloo call fails | That call falls back to the simulator and is labelled **fallback** with the error code |
| `ANTHROPIC_API_KEY` | A scripted planner runs the same research through the same tools; the memo is templated |
| A slow model step | The client retries with backoff; after 10 steps the server writes the memo straight from the evidence |

**Model.** Claude Opus 5.5 (`claude-opus-5-5`) with adaptive thinking (summarised reasoning is shown in the trace), strict tool schemas, prompt caching on the static tools and system prefix, and server-side refusal fallback (`fallbacks: "default"`). You can change these with `CULTURERISK_MODEL`, `CULTURERISK_EFFORT` and `CULTURERISK_MAX_STEPS`.

## For judges: try it in 60 seconds

1. Open the live demo. The pills in the top-right show the agent engine and whether Qloo data is live.
2. Pick a case study:
   - **Cyberpunk Neo-Noir:** *Blade Runner 2049* × *Ghost in the Shell*
   - **Royal Period Drama:** *The King's Speech* × *The Favourite*
   - **Elevated Survival:** *The Revenant* × *Everest*
   - **Risky Hybrid: Musical × Horror:** *La La Land* × *Hereditary*. Watch the comp stress test.
3. Press **Run greenlight analysis** and watch the agent trace. Each card is a real Qloo call.
4. Read the **Memo** (verdicts, scorecard, Qloo-verified recommendations, risk register), then open **Qloo vs LLM-only** and **Evidence**.
5. Try your own project. Any title, any comps.

API checks:

```bash
curl https://<site>.netlify.app/api/agent
curl "https://<site>.netlify.app/api/qloo_bridge?scriptAnchor=Dune&targetDomain=urn:entity:artist"
```

## Run it yourself

```bash
git clone https://github.com/aShah2025/CultureRisk && cd CultureRisk
npm install
cp .env.example .env      # optional: add QLOO_HACKATHON_API_KEY and ANTHROPIC_API_KEY
npm start                 # http://localhost:8888
npm test                  # test suite
```

**Deploy on Netlify:** import the repo. `netlify.toml` sets the publish directory (`public`), the functions directory, the `/api/*` rewrites and the security headers, and runs the tests on every build. Add `QLOO_HACKATHON_API_KEY` and `ANTHROPIC_API_KEY` under *Site configuration → Environment variables*, then redeploy.

## Who it's for

- **Studio and streamer development executives:** a culture-risk read on every project in the slate before money is committed.
- **Film financiers and completion-bond firms:** an independent, evidence-backed check on the audience thesis.
- **Brand-partnership, music-supervision and live-events teams:** partners ranked by measured audience affinity, with white-space picks priced below their cultural pull.
- **Film commissions and tourism boards:** proof that a location's taste profile matches a production's audience.

## License

[MIT](LICENSE)
