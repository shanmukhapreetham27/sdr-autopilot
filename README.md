# SDR Autopilot

An autonomous SDR platform: a **control plane** where a human manager configures, launches,
pauses and monitors multi-channel GTM campaigns, and an **intelligence layer** of specialised
agents that research, qualify, personalise, contact and follow up with prospects inside those
campaigns.

Built for the Inter Guild Buildathon 2026 (Tech Contingent, IIT Madras × DronaHQ).

---

## What works right now

| Area | Status |
| --- | --- |
| Multiple concurrent campaigns with independent state | ✅ Working |
| Campaign lifecycle: Draft → Live → Paused → Completed → Archived | ✅ Working |
| Per-campaign pause/resume that does **not** affect other campaigns | ✅ Working |
| Per-agent pause, per-channel pause, global kill switch | ✅ Working |
| Campaign dashboard: funnel, outreach, agent activity, outcomes | ✅ Working |
| Prompt / AI-harness versioning, rollback, audit trail | ✅ Working |
| Cross-campaign duplicate-prospect conflict detection | ✅ Working |
| Campaign creation and duplication into an A/B variant | ✅ Working |
| Live agent execution loop with funnel progression | ✅ Working (locally simulated — see below) |
| Real LLM calls, RAG retrieval, Apollo / Gmail / Twilio / LinkedIn | ⛔ Not yet wired |
| Authentication, rep assignment, persistent database | ⛔ Out of scope for this build |

### About the agent loop

`lib/simulator.ts` drives campaign execution. Each tick, every **Live** campaign gets one
chance to act: it may discover a new lead, research it, score it against the campaign ICP,
draft outreach on an open channel, follow up, or escalate to a human.

The step *decisions* are currently generated locally rather than by a live model. Everything
around them is real: campaign status, per-agent pause, per-channel pause and the global kill
switch are all genuinely enforced before a step can produce an action, prospects really move
through the funnel, rejections and failures really happen, and every action is written to the
activity log with the harness version that produced it.

`decideStep()` returns an `AgentStep` — the exact shape a real agent backend would return.
Wiring in live LLM and tool calls means replacing the body of that one function; the store,
the UI and the activity log do not change.

---

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. No environment variables or API keys are needed for the current
build — demo data is seeded on first load.

```bash
npm run build   # production build
npm run lint    # eslint
npx tsc --noEmit  # typecheck
```

### Environment variables

None required today. When the live agent backend lands, the following will be needed:

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | LLM calls for the agent harness |
| `APOLLO_API_KEY` | Lead discovery and enrichment |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | SMS and voice |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | Email sending and reply reading |
| `DATABASE_URL` | Postgres + pgvector for campaign data and the RAG knowledge base |

Secrets are never committed. `.env*` files are gitignored.

---

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** for styling
- **Zustand** (with `persist`) for client state, so a demo survives a page reload
- Deployed on **Vercel**

State currently lives in the browser via `localStorage`. This is deliberate for the MVP: it
makes the deployed demo work with zero infrastructure. The store is the single seam between
the UI and persistence, so swapping in a server-backed database is a contained change.

---

## Architecture

```
Browser
  │
  ├── Control plane (React)          Campaign CRUD, lifecycle, prompts, dashboards
  │      │
  │      └── useSdr (Zustand store)  ◄── single source of truth
  │               │
  └── Agent loop (setInterval)       One step per live campaign per tick
         │
         └── decideStep()            Gates: status, agent pause, channel pause, kill switch
                │
                └── AgentStep  ──►   store.advanceProspect() + store.pushEvent()
```

Every state change flows through the store. The agent loop cannot bypass a control-plane
gate, because the gates are checked inside `decideStep()` before any action is produced —
the same function the real backend will implement.

---

## File / folder structure

```
app/
  layout.tsx                Root layout, mounts the app shell
  globals.css               Theme tokens and animations
  campaigns/
    page.tsx                Campaign list — the home screen of the control plane
    new/page.tsx            Create a campaign (always starts in Draft)
    [id]/page.tsx           Campaign dashboard: Overview, Prospects, Activity, Harness, Settings
  prospects/page.tsx        All prospects across campaigns, with conflict flags
  activity/page.tsx         Global agent activity log with filters

components/
  AppShell.tsx              Sidebar, top bar, global kill switch, agent-loop host
  ActivityFeed.tsx          Shared activity feed (campaign-scoped and global)
  HarnessTab.tsx            Prompt versioning: view, edit, save, compare, roll back
  ui.tsx                    Shared primitives (Card, Stat, StatusPill, tags, Button)

lib/
  types.ts                  Domain model: Campaign, Prospect, ActivityEvent, PromptVersion
  seed.ts                   Deterministic demo data — three concurrent campaigns
  store.ts                  Zustand store + derived selectors (funnel, metrics, conflicts)
  simulator.ts              Agent execution loop and step decisions
```

Why this split: `lib/` holds everything that would survive moving to a server — the domain
model, the state transitions and the agent logic. `app/` and `components/` hold only
presentation. The agent loop lives in `lib/simulator.ts` alone, so there is exactly one place
to change when the real backend arrives.

---

## The required demonstration

Four campaigns ship seeded, three of them concurrent with independent state:

| Campaign | ICP | Channels | Initial state |
| --- | --- | --- | --- |
| US SaaS CTO Outreach | US B2B SaaS CTOs | Email, LinkedIn | Live |
| India BFSI CIO Outreach | Indian banks, NBFCs, insurers | Email, LinkedIn | Paused |
| US Voice AI Founders | Seed/Series A voice AI founders | LinkedIn, Voice, Email | Live |
| Enterprise Expansion | Existing customers | Email | Draft |

Each has a different ICP, different system and per-agent prompts, a different target audience
and its own dashboard, agent execution and analytics.

**To verify isolation:** open `/campaigns`, note the Outreach counts, pause one Live campaign,
wait ten seconds. The paused campaign's numbers freeze; the other Live campaign keeps
climbing. Its prospect and conversation data is retained and resumes exactly where it stopped.

The India BFSI campaign ships Paused on purpose, so the difference is visible on first load.

---

## Known limitations

- Agent step decisions are generated locally, not by a live model (see above).
- State is per-browser; two people opening the deployed URL each get their own demo.
- No authentication — the app assumes a single trusted operator.
- Representative assignment and offboarding reassignment are not implemented.
- A/B variant comparison creates the variant but does not yet chart the two side by side.
- Cost figures on the Activity page are estimated from token counts at a flat rate.
