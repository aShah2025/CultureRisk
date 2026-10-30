# CultureRisk AI — Devpost submission draft

**Tagline:** Know the audience before you greenlight.

## Inspiration
A studio greenlight commits $30M–$300M, and the core risk model is the comparable-title pitch: "*La La Land* meets *Hereditary*". Nobody checks whether those two audiences actually overlap until test screenings, months and millions later. Qloo's taste graph can answer that on day one.

## What it does
CultureRisk is an autonomous research agent for film-studio executives. Give it a project and its comps. It plans an investigation across Qloo's insights, demographics, tags, compare and search endpoints, changes course as evidence arrives, and files **audience coverage**: a script-coverage-style memo that ends in a stamp (Recommend / Consider / Rework / Pass) with a 0–100 culture-risk score and the formula behind it.

- Live comp picker backed by Qloo search, with real posters.
- Taste-overlap and demographic fit between comps, concept fit from the script's own genre tags.
- Partner explorer for brands, music, locations, TV and podcasts, toggling distinctive vs mass-market, with explainability showing which comp drives each pick.
- A "popularity trap" section: famous names this audience is lukewarm on.
- Adaptive branches: if the comps' audiences split, the agent searches for a bridge title and offers a one-click re-run.
- "On the desk" panel streams every step, every Qloo call and its parameters, and every decision.
- Also an MCP server, so any agent (Claude, Cursor) can call it as a tool.

## How we built it
Plain Node 20 on Netlify Functions, zero runtime dependencies, browser ES modules. Each request runs one agent action and echoes the evidence ledger back to the client, so depth is unlimited within Netlify's 30 s cap. The agent is deliberately deterministic: the same evidence gives the same verdict, no entity can be hallucinated, and the server verifies every recommended ID against what Qloo returned in the session. 66 tests.

## Challenges
Calibrating scores on live Qloo data (cross-affinity ranges, e.g. Paddington 2 × Saw ≈ 0.65 vs The Revenant × Everest ≈ 0.93), and keeping provenance honest: every figure is labelled live, simulated, fallback or mixed.

## What we learned
Qloo's affinity vs popularity split is the most useful signal for finding under-priced partners, and explainability turns a score into an argument an exec can defend.

## What's next
A first back-test on four released films (two hits, two flops) shows the score does not separate hits from flops. It tests whether a pitch's audience exists, not execution. Next: a larger back-test, concept-fit gating, and more verticals beyond film.

## Built with
Qloo API (search, insights, demographics, tags, analysis/compare, explainability), Node.js, Netlify Functions, Model Context Protocol

## Links
- Demo: https://culturerisk.netlify.app
- Repo: https://github.com/aShah2025/CultureRisk (MIT)

## "Significantly updated during the submission period" note
The repo was created Oct 14, 2026, inside the Sep 30 – Oct 30 window, and built for this hackathon.
