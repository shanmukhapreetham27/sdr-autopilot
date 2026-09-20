# SDR Autopilot — Build Report

**Inter Guild Buildathon 2026** · Tech Contingent, IIT Madras × DronaHQ

| | |
| --- | --- |
| Live deployment | **https://sdr-autopilot.vercel.app** |
| Repository | **https://github.com/shanmukhapreetham27/sdr-autopilot** |
| Scale | 31 source files, ~6,450 lines, 16 commits |

---

## 1. What we built

A control plane for running several autonomous SDR campaigns at once, and an
intelligence layer of DronaHQ agents that does the actual selling work inside
them.

A manager creates a campaign, sets its ICP and its prompts, and turns it on.
From that point agents discover prospects, research them against the live web,
qualify them, write outreach grounded in that research, send it, and decide
when to follow up or escalate to a human — while the manager can stop one
agent, one channel, one campaign or the entire platform at any moment.

Four campaigns ship configured. Three run concurrently with independent state,
which is the demonstration the brief asks for.

---

## 2. Approach

We made three decisions early that shaped everything else.

**Build the control plane first.** The brief is explicit that neither half is
optional and neither is judged alone. A control plane with no agents is a
dashboard; agents with no control plane is a script. We built the campaign
model, the lifecycle and the pause hierarchy first, then wired real agents
into it. That ordering meant the agents plugged into something that already
enforced the rules, rather than the rules being retrofitted around whatever
the agents happened to do.

**Make the system say what is actually true.** Every agent action records
whether it came from a DronaHQ agent or a local fallback, and the UI labels
it. When a lead-source integration did not exist, the activity log said so in
plain words rather than printing "Apollo search". This cost us nothing and
repeatedly caught our own mistakes — see §8.

**Treat the agents as a contract to discover, not to assume.** We probed the
published webhooks and built against what they actually returned, which was
different from what we first assumed in three separate ways.

---

## 3. System architecture

```
┌──────────────────────────── BROWSER ─────────────────────────────┐
│                                                                  │
│  Control plane (React)          Agent loop (setInterval, 2.6s)   │
│  campaigns · prompts · funnel        │                           │
│  prospects · activity · controls     │                           │
│            │                         ▼                           │
│            │                  decideStep()                        │
│            │                  gates: campaign status,             │
│            │                  agent pause, channel pause,         │
│            │                  kill switch, loop toggle            │
│            │                         │                           │
│            └──────┬──────────────────┘                           │
│                   ▼                                              │
│          useSdr (Zustand working copy)                           │
│          optimistic write ─┐        ▲ reconcile every 15s        │
└────────────────────────────┼────────┼────────────────────────────┘
                             │        │
                    POST /api/state   GET /api/state
                             │        │
┌────────────────────────────▼────────┴────────── VERCEL ──────────┐
│                                                                  │
│  /api/state          applyCommand() · readState()                │
│  /api/agents/[agent] attaches api-key, calls DronaHQ             │
│  /api/send/email     mints Gmail token, redirects recipient      │
│  /api/integrations   reports which agents are wired              │
└──────┬───────────────────────┬──────────────────┬────────────────┘
       │                       │                  │
       ▼                       ▼                  ▼
  Neon Postgres          DronaHQ Agents       Gmail API
  campaigns              5 published          send-only scope
  prompt_versions        agents over          all mail redirected
  prospects              Webhook Triggers     to one demo inbox
  activity_events
  platform_control
```

**Why the loop runs in the browser.** A server-side scheduler would have been
architecturally cleaner, but it would also have run unattended — and each step
is a billable agent call. Running in the browser with automatic pause on a
hidden tab means the system spends only while someone is watching it. Under a
51-hour clock that trade bought us cost control we could demonstrate, instead
of a cron job we could not afford to leave running.

**Why two API endpoints and not a REST resource per mutation.** The operations
are not CRUD. "Pause this one agent while the campaign keeps running" is not a
PATCH on a resource, and modelling it as one loses the intent. `lib/commands.ts`
makes every mutation a case in one discriminated union, so the client and the
server cannot drift: adding a case is a compile error until both sides handle
it.

---

## 4. Campaigns

Four campaigns, each with its own ICP, prompts, policy, channel mix and
lifecycle state.

| Campaign | ICP | Channels | Threshold | Cadence | State |
| --- | --- | --- | --- | --- | --- |
| US SaaS CTO Outreach | US B2B SaaS CTOs, 50-1000 staff | Email, LinkedIn | 0.60 | 4 touches / 3 days | **Live** |
| India BFSI CIO Outreach | Indian banks, NBFCs, insurers, 500+ | Email, LinkedIn | 0.70 | 3 touches / 7 days | **Paused** |
| US Voice AI Founders | Seed–Series A voice AI founders | LinkedIn, Voice, Email | 0.65 | 3 touches / 2 days | **Live** |
| Enterprise Expansion | Existing customers | Email | 0.80 | 2 touches / 14 days | **Draft** |

The differences are not cosmetic. BFSI is slower, has a higher qualification
bar, forbids SMS and instructs a formal register with compliance framing.
Voice AI is founder-to-founder, short, and prefers LinkedIn first. Each
campaign carries its own system prompt and per-agent prompts, and those are
sent to the agents on every call — which is what makes one shared set of
agents behave differently per campaign.

**Isolation.** Pausing one campaign stops only that campaign. Verified during
testing: with US SaaS paused, it froze at 14 prospects / 2 outreach while US
Voice AI continued from 13 → 14 and 2 → 3. Paused campaigns retain all
prospect and conversation data and resume where they stopped.

**Levels of control**, each independent:

| Level | Effect | Stored |
| --- | --- | --- |
| Campaign pause | One campaign stops | Postgres |
| Agent pause | One agent stops, campaign continues | Postgres |
| Channel pause | One channel stops, others continue | Postgres |
| Global kill switch | All autonomous action halts, platform-wide | Postgres |
| Loop toggle | This browser tab stops spending | Local only |

The last two are deliberately different. The kill switch is an emergency stop:
global, durable, and written to the activity log. The loop toggle is one
operator saying "not right now" — it also pauses automatically when the tab is
hidden or idle, because the loop runs in each visitor's browser and a
forgotten tab would keep spending.

---

## 5. Agents, and how DronaHQ is used

DronaHQ is the intelligence layer. Seven agents were authored on the Agentic
platform with full instructions, declared Webhook Inputs and JSON output
schemas. Five are called live from the product.

| Agent | Role | Status |
| --- | --- | --- |
| Lead Research & Enrichment | Live web research, sourced dossier | ✅ Live |
| Outreach Strategy | Whether, when, which channel, which angle | ✅ Live |
| Personalisation / Email | Writes the message | ✅ Live |
| Conversation | Classifies replies, escalates | ✅ Live |
| Follow-up | Cadence, revival, when to stop | ✅ Live |
| ICP Fitment | Qualification verdict | ⚠️ Local port — see §7 |
| Voice SDR | Call planning | ⛔ Out of scope |

### How the integration works

Each agent exposes a Webhook Trigger. The browser posts to
`/api/agents/<agent>`; that route attaches the `api-key` header server-side so
the secret never reaches the client, and calls DronaHQ.

```
Browser → /api/agents/personalisation → DronaHQ Webhook Trigger
                                             ↓
        AgentOutcome ← parseResponse ← { success, run_id, response }
```

`lib/agentContracts.ts` mirrors each agent's declared input one-to-one. This
matters more than it sounds: the field names are load-bearing. Our first
implementation used invented names, and the ICP agent's own guard fired —
returning `"input binding failed"` rather than guessing. That was the agent
behaving correctly and us getting it wrong.

Every call carries the campaign's **active system prompt and agent prompt**,
plus the harness version. So editing a prompt in the control plane changes the
next agent call, and every action in the activity log can be traced back to
the version that produced it.

### Prompt and harness management

Prompt versions are immutable. Editing writes a new version and activates it;
older versions stay for rollback. A campaign's versions are cloned when it is
duplicated into a variant, so editing a variant can never silently change the
original. Every activity event stores `version_id`, which is what lets a
manager answer *"which configuration produced this outcome?"*

---

## 6. Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16, React 19, TypeScript | One codebase for UI and the server routes that hold secrets |
| Styling | Tailwind CSS v4 | Speed |
| Client state | Zustand | A working copy for responsiveness; Postgres is the source of truth |
| Database | Neon Postgres | Serverless, shared across visitors, survives reload |
| Agents | DronaHQ Agentic AI | The intelligence layer |
| Email | Gmail API, `gmail.send` scope | Least privilege — send only, no mailbox read |
| Hosting | Vercel | Deploys the framework it was built for |

Five runtime dependencies: `next`, `react`, `react-dom`, `zustand`, `pg`.
Everything else — the agent contracts, the qualification scorer, the execution
loop, the Gmail client, the schema and migrations — is code we wrote.

---

## 7. Status: working, partial, skipped

### Fully working

- Multiple concurrent campaigns with independent Live/Paused/Draft state
- Campaign lifecycle: Draft → Live → Paused → Completed → Archived
- Pause isolation, verified end to end
- Campaign, agent, channel and global kill-switch controls
- Campaign dashboards: prospect funnel, outreach, agent activity, outcomes
- Prompt/harness versioning, comparison, rollback, per-action audit trail
- Campaign creation (always as Draft) and duplication into an A/B variant
- Cross-campaign duplicate detection and resolution
- Five DronaHQ agents called live, with per-action source, latency and version
- Research dossier chained into downstream agents for grounding
- Real email delivery via Gmail, redirected to a demo inbox, rate-limited and capped
- Postgres-backed shared state with 15-second reconciliation across tabs
- Agent loop with auto-pause on hidden tab and idle

### Partially working

**ICP qualification runs locally.** The published ICP Fitment agent returns a
completed run with no output on most calls. Diagnosed across roughly thirty
calls: the identical payload returns null, null, then a real answer, and every
rapid-fire call fails. It is not a payload problem and not fixable from our
codebase. Rather than spend credits on a call that usually fails, that stage
runs `lib/icpScorer.ts` — a faithful port of the agent's own documented rules:
the same four weighted dimensions summing to 100, the same decision order, the
same verdict vocabulary, the same threshold arithmetic. It also fixes an
arithmetic bug the live agent exhibits, which scored industry and employee
count as two separate 30-point dimensions, divided by an invented denominator
of 200, and returned `0.7` where its own schema requires an integer 0-100.
Results are attributed to the local fallback in the UI, never to DronaHQ, and
the sidebar reads `5 / 6 wired`. Reverting is one line.

**Agents return prose, not their JSON schemas.** The Structured Output schemas
are authored but do not take effect on the Webhook Trigger responses. The
parser reads structured JSON first and falls back to parsing prose, tolerating
markdown emphasis and `VERDICT:` where the schema says `action:`. This works,
but it is looser than it should be.

**Channels.** Email genuinely sends. LinkedIn, SMS and voice are modelled —
the channel policy, cadence, preference order and per-channel pause are all
real and enforced — but the transport is not wired.

### Skipped

- **Authentication.** A single trusted operator is assumed.
- **Representative assignment.** Reps, working hours and offboarding
  reassignment are in the brief; we ran out of clock.
- **Vector RAG.** The Research agent retrieves from the live web rather than a
  campaign knowledge base with embeddings. This is the largest gap against the
  brief.
- **Voice SDR agent.** Published but not wired.
- **Live lead sourcing.** Prospects come from a seeded pool of real companies.
  There is no Apollo or Crunchbase integration, and the activity log says so.

---

## 8. Engineering decisions worth defending

**Prospect companies are real; contacts are synthetic.** An earlier version
used invented company names. That fails in a way that is worse than returning
nothing: asked about "Kestrel Cloud", the Research agent matched it to
`usekestrel.ai` — a real, unrelated business — and produced a confident,
sourced brief about the wrong company, which every downstream agent then wrote
from. Real companies make research, scoring and generated copy checkable
against reality. Contacts stay synthetic because real people's details do not
belong in a system that models outbound outreach.

**Email is always redirected.** Prospects are synthetic people at real company
domains. `lib/gmail.ts` has no code path that delivers to `prospect.email`; if
the redirect address is unset it refuses to send rather than falling back. The
intended recipient survives as a subject prefix and an `X-Intended-To` header.

**Grounding is enforced by data flow, not by asking nicely.** Asked to write to
a CTO with no dossier attached, the Personalisation agent invented a funding
round and a customer name. The Research agent's full brief is now stored on the
prospect and injected into every downstream agent under a heading that forbids
asserting anything absent from it. Re-run on the same prospect, the agent opened
on the company's actual product architecture — a fact the Research agent had
sourced and cited. Same agent, same prompt; the difference is the context.

**Channel choice follows the documented order.** Channels were being picked at
random, which contradicted the Outreach Strategy agent's own rules. They now
follow email → linkedin → email → voice → sms by sequence step, and voice and
SMS are never a first touch. A cold call before any written contact is exactly
the behaviour that rule exists to prevent.

---

## 9. Known limitations and trade-offs

| Limitation | Why | Cost |
| --- | --- | --- |
| No vector RAG | Ran out of clock; the Research agent uses live web search instead | Largest gap against the brief |
| Loop runs per browser | Cheaper and demonstrably controllable vs. an unattended scheduler | Several visitors = several loops |
| Convergence is eventual (15s) | Polling harder would fight the optimistic updates it protects | Two tabs can differ briefly |
| Approximate headcounts | The ICP scorer needs a company size; the Research agent supplies verified facts, this is a floor | Not presented as verified anywhere |
| Email send cap is per server instance | In-memory counter; a durable limit belongs in the database | Resets on redeploy |
| No auth | Out of scope for the time available | Anyone with the URL is an operator |

### If we had another day

1. Attach the Structured Output schemas properly and restore the live ICP agent
2. A campaign knowledge base with pgvector, so agents retrieve before generating
3. Move the loop server-side behind a scheduler with a durable spend budget
4. Representative assignment, working hours and offboarding reassignment
5. A/B variant comparison — campaigns can already be duplicated into variants,
   but the two are not charted side by side

---

## 10. What to look at first

1. **`/campaigns`** — three concurrent campaigns, independent states. Pause one
   and watch the others continue.
2. **`/activity`** — every agent action with its source, latency and harness
   version. Expand a Personalisation event to read what the agent actually wrote.
3. **A campaign's Prospects tab** — qualification verdicts you can check:
   Accenture rejected as a consultancy, Deepgram held for review at 250
   employees against an 80-employee ceiling.
4. **AI Harness tab** — edit a prompt, save a version, roll it back.
5. **The demo inbox** — an email an agent wrote, grounded in a dossier another
   agent researched.
