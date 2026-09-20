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
| DronaHQ agent integration — all 6 agents live | ✅ Working, verified against the published endpoints |
| Research brief chained into downstream agents (grounding) | ✅ Working |
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

**Request** — the agents bind on a single top-level `message` string. Posting nested JSON
instead returns `"Input binding failed"`, so the app renders campaign and prospect state
into a natural-language brief (`lib/agentBrief.ts`):

```json
{
  "message": "TASK: Score this prospect against the campaign ICP...

CAMPAIGN OPERATING INSTRUCTIONS:
...

AGENT INSTRUCTIONS FOR THIS TASK:
...

CAMPAIGN CONTEXT:
- Ideal customer profile: US SaaS CTO
...

PROSPECT:
- Name: Dana Whitfield
- Title: CTO
...",
  "task": "icp_fitment",
  "campaign_id": "camp_ussaas",
  "prospect_id": "p_us_1"
}
```

`task`, `campaign_id` and `prospect_id` are ignored by the binding but appear in DronaHQ's
Request Logs, so any run can be traced back to a campaign and prospect.

The brief always includes **the campaign's own system prompt and agent prompt**. That is
what makes one shared set of agents behave differently per campaign: editing a prompt in
the control plane changes the next call.

`thread_id` is deliberately **not** sent. DronaHQ issues its own thread UUIDs per assistant,
and passing an arbitrary id fails with `"Assistant ID does not match thread"`. Every call
carries full context instead.

**Response** — DronaHQ replies with an envelope:

```json
{ "success": true, "thread_id": "...", "run_id": "...",
  "message": "Agent run completed successfully...",
  "response": "fit_score: 80
verdict: QUALIFIED
criteria_breakdown: ..." }
```

The agent's own output is in `response`. `normaliseAgentResult` handles three shapes:

| Shape | Handling |
| --- | --- |
| Plain text | Regex-extracts `fit_score`, `verdict`, `channel`; full text kept as the message |
| JSON string | Re-parsed, then treated as structured |
| Structured JSON | Reads `summary`, `message`, `score`, `verdict`, `advance`, `escalate`, `channel` |

Verdict tokens drive the funnel: `QUALIFIED` / `CONTACT` / `PROCEED` / `FOLLOW_UP` advance
the prospect, `REJECTED` / `HOLD` / `STOP` do not, and `ESCALATE` / `NEEDS_REVIEW` mark the
action as needing a human. A response matching none of these is logged rather than crashing
the run.

**What each live agent actually returns** (observed against the published endpoints):

| Agent | Output |
| --- | --- |
| Qualify | `fit_score: 80` / `verdict: QUALIFIED` / criteria breakdown |
| Research | Markdown brief with sources; no verdict, so the prospect advances |
| Outreach | `channel: email, verdict: CONTACT` + reasoning |
| Personalise | The message body only |
| Converse | `intent: objection, verdict: ESCALATE` + reason |
| Followup | `VERDICT: FOLLOW_UP` + timing, channel and new angle |

### Grounding: chaining research into personalisation

The Research Agent's full brief is stored on the prospect (`Prospect.researchBrief`) and
injected into every downstream agent's brief under a "VERIFIED RESEARCH BRIEF" heading that
forbids asserting anything not present in it.

This matters. Asked to write to a CTO with no brief attached, the Personalisation Agent
invented a funding round and a customer name. Given the Research Agent's brief for the same
company, it instead opened on the company's actual flat-file content architecture — a fact
the Research Agent had sourced and cited. Same agent, same prompt; the difference is the
grounding context.

Prospects carrying a brief are marked in the campaign's Prospects tab.



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

## Where the data comes from

Being precise about this, because it is the part of the build that is *not* live.

| Data | Source | Real? |
| --- | --- | --- |
| Campaign config — ICP, prompts, channels, limits | `lib/seed.ts`, hardcoded | Authored for the demo |
| Prospect **companies** | `lib/seed.ts` and `lib/simulator.ts` | ✅ Real, publicly known companies |
| Prospect **contacts** — names, titles, emails | Synthetic personas | ❌ Fictional, deliberately |
| Company research | DronaHQ Research Agent, live web lookup | ✅ Real, with cited sources |
| ICP scoring, copy, decisions, escalations | DronaHQ agents, real LLM calls | ✅ Real |
| Lead discovery | Seeded pool of real companies | ❌ No Apollo/Crunchbase/LinkedIn integration |
| All state | Browser `localStorage` | Per-visitor, not shared |

There is **no lead-sourcing integration**. The activity log says so in plain words
(`seeded demo pool — no lead-source integration connected`) rather than implying an Apollo
or Crunchbase call that does not happen.

### Why the companies are real

An earlier version used invented company names. That fails in a way that is worse than
returning nothing: asked about "Kestrel Cloud", the Research Agent matched it to
`usekestrel.ai` — a real, unrelated business — and produced a confident, sourced brief
about the wrong company. Every downstream agent then wrote from that.

Using real companies means the research, the ICP score and the generated copy are all
checkable against reality. Each pool also deliberately includes companies that **miss**
the ICP — a consultancy in the SaaS campaign, a crypto exchange in the BFSI campaign, a
robotics firm in the voice-AI campaign — so the ICP Fitment Agent has genuine decisions to
make instead of approving everything.

### Why the contacts are not real

Real people's names and email addresses are deliberately kept out of a system that models
outbound outreach. Nothing is ever actually delivered — there is no Gmail, Twilio or
LinkedIn sending in this build — but synthetic contacts mean that stays true even by
accident.

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
- Lead discovery draws from a seeded pool of real companies; there is no live
  lead-sourcing integration.
- Prospect contacts are synthetic personas at real companies.
- The Voice SDR agent is not wired to DronaHQ in this build.
- Outreach is generated but not actually delivered: no Gmail, Twilio or LinkedIn sending yet.
- State is per-browser; two people opening the deployed URL each get their own demo.
- No authentication — the app assumes a single trusted operator.
- Representative assignment and offboarding reassignment are not implemented.
- A/B variant comparison creates the variant but does not yet chart the two side by side.
- Cost figures on the Activity page are estimated from token counts at a flat rate.
