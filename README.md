# CultureRisk AI

**Cultural-affinity intelligence that helps studios decide which films to greenlight.**

CultureRisk AI is an executive decision cockpit for film studios, streamers and independent financiers. It uses [Qloo](https://qloo.com)'s cross-domain Taste AI to estimate how well a proposed film fits its target audience *before* the money is committed. It also lists the brands, music talent and filming locations that audience already likes.

> Built for the **Qloo Agentic Hackathon** · Deployed on **Netlify** · MIT Licensed

---

## 1. The problem: greenlights worth millions are still decided by instinct

A wide-release feature costs **$100M–$300M** once production and global marketing are included. Even a prestige drama often needs **$25M–$60M**. Most of that money is committed when the film is greenlit. That decision usually rests on:

- **Comparable-title math** ("it's *X* meets *Y*"), which explains box office after the fact but says little about *who* the audience is or *what else they love*.
- **Test screenings and tracking surveys**, which arrive too late to change the script, the casting or the partnership strategy.
- **Siloed data**: box-office, music-streaming, travel and consumer-brand data almost never sit in the same room.

The result is a high-variance portfolio. A single misread of the audience can erase a studio's quarterly margin. Partnership revenue from brand placements, soundtrack licensing and location incentives also tends to get negotiated late and priced poorly.

## 2. The solution: cross-domain cultural risk scoring

CultureRisk AI starts from a **box-office anchor**: a released film whose audience matches the project's target. Using Qloo's Insights API, it asks what that audience over-indexes on in other domains:

| Qloo layer | Executive question it answers |
|---|---|
| `urn:entity:brand` | Which brand partners will this audience reward, and which will feel off-brand? |
| `urn:entity:artist` | Which composers and artists will make the trailer and soundtrack land? |
| `urn:entity:destination` | Which shooting locations match the audience's taste and unlock tourism co-marketing? |

The cockpit turns the affinity results into four board-ready metrics:

- **Verdict**: `GREENLIGHT` · `CONDITIONAL` · `HIGH RISK`
- **Culture Risk Score** (0–100): the inverse of mean affinity, with a penalty when affinities are widely spread (a scattered taste profile means a less predictable audience).
- **Alignment Index** (0–100): mean cross-domain affinity.
- **Dispersion (σ)**: the standard deviation of affinity across the returned entities.

Each recommended entity appears as a card showing its **affinity** and **popularity**, with taste tags and, in simulated mode, a short strategic rationale.

## 3. Architecture

```
┌────────────────────────┐   GET /api/qloo_bridge   ┌──────────────────────────────┐
│  index.html            │ ───────────────────────▶ │ Netlify rewrite (netlify.toml)│
│  Executive Cockpit UI  │                          │ /api/* → /.netlify/functions/*│
└────────────────────────┘                          └──────────────┬───────────────┘
                                                                   ▼
                                               ┌──────────────────────────────────────┐
                                               │ netlify/functions/qloo_bridge.js     │
                                               │  • GET-only, input validation        │
                                               │  • API key held server-side only     │
                                               │  • 1) /search  → anchor entity ID    │
                                               │  • 2) /v2/insights                   │
                                               │       filter.type=<URN>              │
                                               │       signal.interests.entities=<ID> │
                                               │  • Fallback → simulated studio data  │
                                               └──────────────────┬───────────────────┘
                                                                  ▼
                                                    Qloo Taste AI (X-Api-Key header)
```

### Dual-mode resilience

The bridge **always answers with HTTP 200 and a usable payload**, so a live demo never breaks:

| Condition | Mode | Behaviour |
|---|---|---|
| `QLOO_HACKATHON_API_KEY` set to a real key and Qloo responds | `live` | Real Qloo affinities |
| Key missing or a placeholder (`mock`, `demo`, `your_api_key_here`, …) | `mock` | Simulated studio data, no outbound call |
| Upstream timeout, non-2xx response, anchor not found, or empty results | `mock` | Simulated studio data; `reason` field explains why |

Simulated payloads are **clearly labelled** in the UI (amber `SIMULATED · STUDIO FALLBACK` badge), so simulated data is never presented as real. They are deterministic for each anchor and domain, which keeps demos reproducible.

### Security posture

- The API key never leaves the server. The browser only sees `/api/qloo_bridge`.
- The function rejects any method other than `GET` with a `405` and an `Allow` header.
- `targetDomain` is checked against a fixed allowlist. `scriptAnchor` has control characters stripped and is capped at 120 characters.
- Responses are sent with strict security headers (CSP, `X-Frame-Options: DENY`, `nosniff`, `no-store` on the API).
- All dynamic UI content is HTML-escaped before rendering.
- The script log textarea is **never transmitted**. It is analysed in the browser for genre signals only.

## 4. Deployment on Netlify (zero-contact)

| Setting | Value |
|---|---|
| Publish directory | `.` (repository root) |
| Functions directory | `netlify/functions` |
| Build command | *(none, no build step)* |
| Runtime | Node 20 (native `fetch`) |
| Dependencies | **None** |

### One-click / Git deploy
1. Push this repository to GitHub.
2. In Netlify, choose **Add new site → Import an existing project** and select the repo. `netlify.toml` provides all the settings.
3. *(Optional, enables live mode)* Go to **Site configuration → Environment variables** and add:
   - `QLOO_HACKATHON_API_KEY` = your Qloo hackathon key
   - `QLOO_API_BASE` = *(optional)* defaults to `https://hackathon.api.qloo.com`
4. Redeploy. Without step 3 the site runs in simulated mode.

### CLI deploy
```bash
npm install -g netlify-cli
```
```bash
netlify deploy --prod
```

### Local development
```bash
netlify dev
```
Then open http://localhost:8888. The `/api/*` rewrite and the function run locally. To use live mode, put your key in a local `.env` file and don't commit it.

## 5. How judges can test the live system

**Approximate time: 60 seconds.**

1. **Open the deployed site.** The status pill in the top-right reads `STANDBY`.
2. **Click a preset** under *Preset Case Study Evaluation*:
   - **Cyberpunk Neo-Noir Thriller**: anchor *Blade Runner 2049*, layer *Soundtrack & Talent*
   - **Royal Period Drama**: anchor *The King's Speech*, layer *Location & Tourism*
   - **Elevated Survival Adventure**: anchor *The Revenant*, layer *Brand Partnerships*

   The script log, anchor and layer fill in automatically.
3. **Click ▶ Execute Culture Risk Analysis.**
4. **Read the results:**
   - The badge shows **`LIVE · QLOO`** (green) when real Qloo data came back, or **`SIMULATED · STUDIO FALLBACK`** (amber) with a `reason` value.
   - The four KPI tiles show the verdict, risk, alignment and dispersion.
   - Ranked entity cards show the affinity and popularity bars.
5. **Try your own scenario.** Change the anchor title (e.g. *Dune*, *Little Women*, *Top Gun: Maverick*) or switch the layer and run it again.

### Testing the API directly
```bash
curl "https://<your-site>.netlify.app/api/qloo_bridge?scriptAnchor=Blade%20Runner%202049&targetDomain=urn:entity:artist"
```
To confirm the GET-only rule, send a POST. Expect a 405:
```bash
curl -i -X POST "https://<your-site>.netlify.app/api/qloo_bridge"
```

#### Response shape
```json
{
  "mode": "live | mock",
  "reason": "null | api_key_not_configured | upstream_timeout | anchor_not_found | ...",
  "anchor": { "title": "Blade Runner 2049", "entityId": "…" },
  "targetDomain": "urn:entity:artist",
  "domainLabel": "Soundtrack & Talent",
  "generatedAt": "2026-10-14T00:00:00.000Z",
  "summary": {
    "alignmentIndex": 84,
    "cultureRiskScore": 23,
    "dispersion": 0.061,
    "verdict": "GREENLIGHT",
    "sampleSize": 6
  },
  "results": [
    { "name": "…", "entityId": "…", "affinity": 0.93, "popularity": 0.95, "tags": ["…"], "rationale": "…" }
  ]
}
```

## 6. Market opportunity

- **Studios and streamers:** a pre-greenlight risk score for every project on the development slate.
- **Film finance and completion-bond firms:** an independent, data-backed check on the audience thesis.
- **Brand-partnership and music-licensing teams:** placements and sync deals ranked by audience affinity instead of relationships.
- **Film commissions and tourism boards:** evidence that a location's taste profile matches the production's audience.

Next on the roadmap: LLM-based script parsing that maps treatments straight to Qloo tags, multi-anchor blending, demographic and geographic signal filters, and slate-level portfolio risk dashboards.

## 7. Repository layout

```
.
├── index.html                    # Executive cockpit (single-file UI)
├── netlify.toml                  # Build, functions, /api rewrite, security headers
├── netlify/
│   └── functions/
│       └── qloo_bridge.js        # Secure Qloo proxy with dual-mode fallback
├── LICENSE                       # MIT
└── README.md
```

## License

Released under the [MIT License](LICENSE).
