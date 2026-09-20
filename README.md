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
| Live agent execution loop with funnel progression | ✅ Working |
| DronaHQ agent integration (6 agents over webhooks) | ✅ Working — wired per agent via env vars |
| Voice SDR agent | ⛔ Out of scope for this build |
| Apollo / Gmail / Twilio / LinkedIn sending | ⛔ Not yet wired |
| Authentication, rep assignment, persistent database | ⛔ Out of scope for this build |

### About the agent loop

`lib/simulator.ts` drives campaign execution. Each tick, every **Live** campaign gets one
chance to act: it may discover a new lead, research it, score it against the campaign ICP,
draft outreach on an open channel, follow up, or escalate to a human.

`decideStep()` picks which prospect moves, which agent owns the move, and which channel is
open — enforcing campaign status, per-agent pause, per-channel pause and the global kill
switch before any action can be produced.

How that step is then *executed* depends on configuration:

- If the owning agent has a **DronaHQ webhook** configured, the real published agent is
  called and its structured JSON response drives the outcome — the summary, the generated
  message, the ICP score, and whether the prospect advances, is rejected, or is escalated.
- Otherwise the step falls back to a locally generated narration, so the control plane is
  fully demonstrable without every agent wired.

Every activity event records which of the two actually happened (`source: "dronahq"` or
`"simulated"`), and the UI labels it. **The app never claims a DronaHQ agent ran when it
did not.** The sidebar shows `n / 6 wired` at all times.

### How the DronaHQ integration works

Each agent is a published DronaHQ agent with a **Webhook Trigger** attached.

```
Browser  ──POST──▶  /api/agents/<agent>  ──POST + api-key header──▶  DronaHQ webhook
                    (Next.js route)                                   (published agent)
                          ▲                                                  │
                          └────────── structured JSON response ◀─────────────┘
```

The API key never reaches the browser: `lib/dronahq.ts` is server-only and attaches the
`api-key` header inside the route handler.

**Request** — every agent receives this payload (configure the agent's Webhook Input
against these field names):

```json
{
  "task": "personalisation",
  "thread_id": "<campaign_id>:<prospect_id>",
  "campaign": {
    "id": "camp_ussaas",
    "name": "US SaaS CTO Outreach",
    "system_prompt": "...",
    "agent_prompt": "...",
    "icp_label": "US SaaS CTO",
    "geography": "United States",
    "target_roles": ["CTO", "VP Engineering"],
    "company_criteria": "...",
    "exclusions": "...",
    "open_channels": ["email", "linkedin"]
  },
  "prospect": {
    "id": "p_us_1", "name": "Dana Whitfield", "title": "CTO",
    "company": "Loomwork", "location": "Austin, TX",
    "email": "...", "linkedin": "...",
    "stage": "qualified", "fit_score": 91,
    "channels_touched": ["email"], "last_action": "..."
  }
}
```

**Response** — configure the agent's Response as **Standard** with a JSON Schema. Any of
these fields are understood; all are optional:

| Field | Type | Meaning |
| --- | --- | --- |
| `summary` | string | One line for the activity log |
| `message` | string | The generated outreach copy, shown expandable in the feed |
| `score` | number | ICP fit score, 0-100 |
| `advance` | boolean | `false` holds the prospect; on the ICP agent it means rejected |
| `escalate` | boolean | `true` marks the action as needing a human |
| `channel` | string | Channel the agent chose |

Responses are parsed leniently (`normaliseAgentResult`): common aliases are accepted, the
payload may be wrapped in `result` / `data` / `output`, and a malformed response degrades
to a logged event rather than crashing the run.

`thread_id` is `<campaign_id>:<prospect_id>`, so an agent keeps context across touches to
the same person without leaking one campaign's history into another.

---

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Demo data is seeded on first load. No environment variables are
required — every agent without a configured webhook runs simulated.

To wire real DronaHQ agents, copy `.env.example` to `.env.local` and fill in the webhook
URL and API key for each agent. Check `/api/integrations/status` to confirm what is live.

```bash
npm run build   # production build
npm run lint    # eslint
npx tsc --noEmit  # typecheck
```

### Environment variables

All optional. Any agent left unset runs simulated.

| Variable | Purpose |
| --- | --- |
| `DRONAHQ_API_KEY` | Workspace API key, used for any agent without its own key |
| `DRONAHQ_ICP_FITMENT_URL` / `_KEY` | ICP Fitment Agent webhook |
| `DRONAHQ_RESEARCH_URL` / `_KEY` | Lead Research Agent webhook |
| `DRONAHQ_OUTREACH_STRATEGY_URL` / `_KEY` | Outreach Strategy Agent webhook |
| `DRONAHQ_PERSONALISATION_URL` / `_KEY` | Personalisation Agent webhook |
| `DRONAHQ_CONVERSATION_URL` / `_KEY` | Conversation Agent webhook |
| `DRONAHQ_FOLLOWUP_URL` / `_KEY` | Follow-up Agent webhook |

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
                ├── agent wired?  ──▶  POST /api/agents/<agent>   (Next.js route, server)
                │                            │
                │                            └──▶  DronaHQ published agent (webhook)
                │                                      │
                │                       structured JSON ◀┘
                │
                └── otherwise      ──▶  local fallback step
                       │
                       └──▶  store.advanceProspect() + store.pushEvent()
```

Every state change flows through the store. The agent loop cannot bypass a control-plane
gate, because the gates are checked inside `decideStep()` before any action is produced —
whether that action is executed by DronaHQ or by the local fallback.

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

app/api/
  agents/[agent]/route.ts   Server proxy to a DronaHQ agent — attaches the api-key header
  integrations/status/      Reports which agents are wired (names and booleans only)

lib/
  types.ts                  Domain model: Campaign, Prospect, ActivityEvent, PromptVersion
  seed.ts                   Deterministic demo data — three concurrent campaigns
  store.ts                  Zustand store + derived selectors (funnel, metrics, conflicts)
  simulator.ts              Agent execution loop and step decisions
  dronahq.ts                SERVER ONLY. DronaHQ webhook client, request/response contract
  agentClient.ts            Browser-side bridge; types only from dronahq.ts, never secrets
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

- Agents without a configured DronaHQ webhook fall back to locally generated steps.
- The Voice SDR agent is not wired to DronaHQ in this build.
- Outreach is generated but not actually delivered: no Gmail, Twilio or LinkedIn sending yet.
- State is per-browser; two people opening the deployed URL each get their own demo.
- No authentication — the app assumes a single trusted operator.
- Representative assignment and offboarding reassignment are not implemented.
- A/B variant comparison creates the variant but does not yet chart the two side by side.
- Cost figures on the Activity page are estimated from token counts at a flat rate.
