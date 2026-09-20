/**
 * Generates docs/SDR-Autopilot-Deck.pptx.
 *
 * Kept so the deck is reproducible rather than a binary with no source.
 * pptxgenjs is not an app dependency -- install it only to rebuild:
 *
 *   npm i -D pptxgenjs && node docs/build-deck.cjs docs/SDR-Autopilot-Deck.pptx
 */
const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "SDR Autopilot";
pres.title = "SDR Autopilot — Inter Guild Buildathon 2026";

// Palette lifted from the product: a dark control plane with an emerald live dot.
const BG = "0B1220";
const PANEL = "161F30";
const PANEL2 = "1D2739";
const EMERALD = "34D399";
const VIOLET = "A78BFA";
const AMBER = "FBBF24";
const ROSE = "FB7185";
const SKY = "38BDF8";
const TEXT = "E8EDF5";
const MUTED = "94A3B8";
const DIM = "64748B";

const H = "Arial";
const B = "Calibri";

const dark = () => {
  const s = pres.addSlide();
  s.background = { color: BG };
  return s;
};

/** Slide title. No underline rule — whitespace carries it. */
function title(s, text, kicker) {
  if (kicker) {
    s.addText(kicker.toUpperCase(), {
      x: 0.6, y: 0.52, w: 12.1, h: 0.26, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 11, bold: true, color: EMERALD, charSpacing: 2,
    });
  }
  s.addText(text, {
    x: 0.6, y: kicker ? 0.82 : 0.62, w: 12.1, h: 0.7, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 32, bold: true, color: TEXT,
  });
}

/** The repeating motif: a small status dot, exactly like the app's live indicator. */
function dot(s, x, y, color, size = 0.12) {
  s.addShape(pres.ShapeType.ellipse, {
    x, y, w: size, h: size, fill: { color }, line: { color, width: 0 },
  });
}

function card(s, x, y, w, h, fill = PANEL) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: fill }, line: { color: PANEL2, width: 1 },
  });
}

// ---------------------------------------------------------------- 1. TITLE
{
  const s = dark();
  s.addShape(pres.ShapeType.roundRect, {
    x: 0.6, y: 2.0, w: 0.5, h: 0.5, rectRadius: 0.1,
    fill: { color: PANEL }, line: { color: EMERALD, width: 1 },
  });
  dot(s, 0.79, 2.19, EMERALD);

  s.addText("SDR Autopilot", {
    x: 1.3, y: 1.86, w: 11, h: 1.0, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 54, bold: true, color: TEXT,
  });
  s.addText("An autonomous SDR that runs real GTM campaigns across channels —\nwith a human in control of every agent, every channel, every moment.", {
    x: 1.3, y: 2.98, w: 10.6, h: 0.95, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 17, color: MUTED, lineSpacing: 26,
  });

  const stats = [
    ["3", "campaigns running\nconcurrently", EMERALD],
    ["5 / 6", "DronaHQ agents\nlive in production", VIOLET],
    ["100%", "of agent actions\nlabelled by source", SKY],
  ];
  stats.forEach(([big, small, col], i) => {
    const x = 1.3 + i * 3.6;
    s.addText(big, {
      x, y: 4.35, w: 3.3, h: 0.72, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 40, bold: true, color: col,
    });
    s.addText(small, {
      x, y: 5.08, w: 3.3, h: 0.7, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 12, color: DIM, lineSpacing: 16,
    });
  });

  s.addText("Inter Guild Buildathon 2026  ·  Tech Contingent, IIT Madras × DronaHQ", {
    x: 1.3, y: 6.32, w: 11, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, color: DIM,
  });
  s.addText("sdr-autopilot.vercel.app", {
    x: 1.3, y: 6.62, w: 11, h: 0.32, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, bold: true, color: EMERALD,
  });
  s.addNotes("Open on the live URL already loaded. One line: a control plane where a manager configures campaigns, and AI agents do the selling work inside them.");
}

// ---------------------------------------------------------------- 2. PROBLEM
{
  const s = dark();
  title(s, "Sales development is manual, repetitive, inconsistent", "The problem");

  const rows = [
    ["Research", "Reps read the same company pages over and over", SKY],
    ["Personalise", "Every message rewritten by hand, quality varies by rep", VIOLET],
    ["Chase", "Replies scattered across email, LinkedIn, SMS and calls", AMBER],
    ["Log", "Everything typed into a CRM after the fact, or not at all", ROSE],
  ];
  rows.forEach(([h, d, col], i) => {
    const y = 1.95 + i * 0.85;
    s.addShape(pres.ShapeType.ellipse, {
      x: 0.62, y: y + 0.05, w: 0.38, h: 0.38,
      fill: { color: PANEL }, line: { color: col, width: 1 },
    });
    dot(s, 0.75, y + 0.18, col);
    s.addText(h, {
      x: 1.2, y, w: 2.0, h: 0.3, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 15, bold: true, color: TEXT,
    });
    s.addText(d, {
      x: 1.2, y: y + 0.3, w: 6.0, h: 0.3, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 13, color: MUTED,
    });
  });

  card(s, 7.9, 1.9, 4.8, 3.6);
  s.addText("The question judges keep\ncoming back to", {
    x: 8.25, y: 2.2, w: 4.1, h: 0.6, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, color: DIM, lineSpacing: 16,
  });
  s.addText("“How close is this to a\nreal SDR working\nautonomously across\nmultiple channels?”", {
    x: 8.25, y: 2.95, w: 4.1, h: 1.9, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 20, bold: true, color: EMERALD, lineSpacing: 30,
  });

  s.addText("Our answer had to be one product, not five disconnected bots.", {
    x: 0.62, y: 5.75, w: 12.1, h: 0.4, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 15, italic: true, color: MUTED,
  });
  s.addNotes("Four jobs a rep does by hand. The brief's own question is the bar we set ourselves.");
}

// ---------------------------------------------------------------- 3. TWO HALVES
{
  const s = dark();
  title(s, "One product, two halves that must work as one", "What we built");

  const cols = [
    ["Control plane", "The human stays in charge", EMERALD, [
      "Multiple concurrent campaigns, independent state",
      "Draft → Live → Paused → Completed → Archived",
      "Pause a campaign, an agent, a channel, or everything",
      "Prompt versioning with rollback and full audit trail",
      "Funnel, outreach, escalations, cost per campaign",
    ]],
    ["Intelligence layer", "The agents do the work", VIOLET, [
      "Research a prospect against the live web",
      "Qualify against campaign-specific ICP criteria",
      "Write outreach grounded in that research",
      "Choose channel and cadence by sequence step",
      "Escalate to a human rather than guess",
    ]],
  ];

  cols.forEach(([h, sub, col, items], i) => {
    const x = 0.6 + i * 6.25;
    card(s, x, 1.85, 5.85, 4.55);
    dot(s, x + 0.4, 2.22, col);
    s.addText(h, {
      x: x + 0.7, y: 2.05, w: 4.9, h: 0.35, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 20, bold: true, color: TEXT,
    });
    s.addText(sub, {
      x: x + 0.7, y: 2.42, w: 4.9, h: 0.28, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 12, color: col,
    });
    s.addText(items.map((t, n) => ({
      text: t, options: { bullet: true, breakLine: n !== items.length - 1 },
    })), {
      x: x + 0.45, y: 2.95, w: 5.0, h: 3.2, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 13.5, color: MUTED, paraSpaceAfter: 10, lineSpacing: 18,
    });
  });

  s.addText("Neither half is optional. A control plane with no agents is a dashboard; agents with no control plane is a script.", {
    x: 0.6, y: 6.62, w: 12.1, h: 0.35, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, italic: true, color: DIM,
  });
  s.addNotes("We built the control plane first so the agents plugged into something that already enforced the rules.");
}

// ---------------------------------------------------------------- 4. ARCHITECTURE
{
  const s = dark();
  title(s, "Architecture", "How it fits together");

  const box = (x, y, w, h, label, sub, col) => {
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w, h, rectRadius: 0.06,
      fill: { color: PANEL }, line: { color: col, width: 1 },
    });
    s.addText(label, {
      x: x + 0.18, y: y + 0.13, w: w - 0.36, h: 0.28, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 13, bold: true, color: TEXT,
    });
    s.addText(sub, {
      x: x + 0.18, y: y + 0.42, w: w - 0.36, h: h - 0.55, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 10.5, color: MUTED, lineSpacing: 14,
    });
  };

  box(0.6, 1.8, 3.6, 1.75, "Browser — control plane",
      "Campaigns, prompts, funnel,\nprospects, activity, controls", EMERALD);
  box(0.6, 3.75, 3.6, 1.75, "Agent loop",
      "One step per live campaign.\nGates: status, agent pause,\nchannel pause, kill switch", EMERALD);

  box(4.95, 2.75, 3.4, 1.85, "Next.js API routes",
      "/api/state\n/api/agents/[agent]\n/api/send/email\nSecrets never reach the client", SKY);

  box(9.1, 1.45, 3.6, 1.5, "Neon Postgres", "Campaigns, prompt versions,\nprospects, activity, controls", SKY);
  box(9.1, 3.1, 3.6, 1.5, "DronaHQ Agents", "5 published agents called\nover Webhook Triggers", VIOLET);
  box(9.1, 4.75, 3.6, 1.5, "Gmail API", "send-only scope, every\nmessage redirected", AMBER);

  const arrow = (x1, y1, x2, y2) => {
    s.addShape(pres.ShapeType.line, {
      x: x1, y: y1, w: x2 - x1, h: y2 - y1,
      line: { color: DIM, width: 1.25, endArrowType: "triangle" },
    });
  };
  arrow(4.2, 2.68, 4.95, 3.3);
  arrow(4.2, 4.63, 4.95, 4.05);
  arrow(8.35, 3.3, 9.1, 2.2);
  arrow(8.35, 3.68, 9.1, 3.85);
  arrow(8.35, 4.05, 9.1, 5.5);

  s.addText("Postgres is the source of truth. The browser keeps a working copy and reconciles every 15 seconds, so two people see the same campaigns.", {
    x: 0.6, y: 6.55, w: 12.1, h: 0.45, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12.5, color: DIM, lineSpacing: 16,
  });
  s.addNotes("The loop runs in the browser on purpose: every step is a billable agent call, so it pauses automatically when nobody is watching.");
}

// ---------------------------------------------------------------- 5. CAMPAIGNS
{
  const s = dark();
  title(s, "Three campaigns running at once, fully isolated", "The required demonstration");

  const rows = [
    ["US SaaS CTO Outreach", "US B2B SaaS CTOs", "Email · LinkedIn", "Live", EMERALD],
    ["India BFSI CIO Outreach", "Indian banks, NBFCs", "Email · LinkedIn", "Paused", AMBER],
    ["US Voice AI Founders", "Seed–Series A founders", "LinkedIn · Voice · Email", "Live", EMERALD],
    ["Enterprise Expansion", "Existing customers", "Email", "Draft", DIM],
  ];
  const cx = [0.75, 4.35, 7.55, 11.2];
  ["CAMPAIGN", "ICP", "CHANNELS", "STATE"].forEach((h, i) => {
    s.addText(h, {
      x: cx[i], y: 1.85, w: [3.4, 3.0, 3.4, 1.4][i], h: 0.25, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 9.5, bold: true, color: DIM, charSpacing: 1.5,
    });
  });

  rows.forEach(([name, icp, ch, state, col], i) => {
    const y = 2.25 + i * 0.78;
    card(s, 0.6, y, 12.1, 0.66, i % 2 === 0 ? PANEL : BG);
    s.addText(name, {
      x: cx[0], y: y + 0.18, w: 3.5, h: 0.3, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 13, bold: true, color: TEXT,
    });
    s.addText(icp, {
      x: cx[1], y: y + 0.2, w: 3.0, h: 0.3, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 12, color: MUTED,
    });
    s.addText(ch, {
      x: cx[2], y: y + 0.2, w: 3.4, h: 0.3, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 12, color: MUTED,
    });
    dot(s, cx[3], y + 0.27, col, 0.13);
    s.addText(state, {
      x: cx[3] + 0.25, y: y + 0.18, w: 1.3, h: 0.3, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 12, bold: true, color: col,
    });
  });

  card(s, 0.6, 5.55, 12.1, 1.35, PANEL2);
  s.addText("Pause isolation, measured live", {
    x: 0.95, y: 5.72, w: 5, h: 0.28, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 13, bold: true, color: TEXT,
  });
  s.addText([
    { text: "US SaaS paused → froze at 14 prospects / 2 outreach.   ", options: { color: AMBER } },
    { text: "Voice AI kept running → 13 → 14 and 2 → 3.", options: { color: EMERALD } },
  ], {
    x: 0.95, y: 6.06, w: 11.4, h: 0.32, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 14, bold: true,
  });
  s.addText("Paused campaigns retain every prospect and conversation, and resume exactly where they stopped.", {
    x: 0.95, y: 6.42, w: 11.4, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 11.5, color: DIM,
  });
  s.addNotes("Do this live: say the outreach numbers out loud, pause one campaign, wait 30 seconds, resume it.");
}

// ---------------------------------------------------------------- 6. DRONAHQ
{
  const s = dark();
  title(s, "DronaHQ is the intelligence layer", "How DronaHQ is used");

  const agents = [
    ["Lead Research & Enrichment", "Live web research → sourced dossier", EMERALD, "Live"],
    ["Outreach Strategy", "Whether, when, which channel, which angle", EMERALD, "Live"],
    ["Personalisation / Email", "Writes the message from the dossier", EMERALD, "Live"],
    ["Conversation", "Classifies replies, escalates pricing & legal", EMERALD, "Live"],
    ["Follow-up", "Cadence, revival, when to stop", EMERALD, "Live"],
    ["ICP Fitment", "Upstream returns empty runs — local port of its rules", AMBER, "Local"],
  ];
  agents.forEach(([n, d, col, tag], i) => {
    const y = 1.85 + i * 0.72;
    card(s, 0.6, y, 7.5, 0.6);
    dot(s, 0.9, y + 0.24, col);
    s.addText(n, {
      x: 1.22, y: y + 0.06, w: 3.5, h: 0.26, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 12.5, bold: true, color: TEXT,
    });
    s.addText(d, {
      x: 1.22, y: y + 0.34, w: 5.4, h: 0.24, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 10.5, color: MUTED,
    });
    s.addText(tag, {
      x: 6.9, y: y + 0.18, w: 1.0, h: 0.26, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 10, bold: true, color: col, align: "right",
    });
  });

  card(s, 8.45, 1.85, 4.25, 4.55, PANEL2);
  s.addText("What made it work", {
    x: 8.78, y: 2.05, w: 3.7, h: 0.3, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 15, bold: true, color: TEXT,
  });
  s.addText([
    { text: "Each agent declares its own Webhook Input, and the field names are load-bearing.", options: { bullet: true, breakLine: true } },
    { text: "Our first payload used invented names — the ICP agent’s own guard fired rather than guessing.", options: { bullet: true, breakLine: true } },
    { text: "Every call carries the campaign’s active system prompt and agent prompt.", options: { bullet: true, breakLine: true } },
    { text: "That is what makes one shared set of agents behave differently per campaign.", options: { bullet: true, breakLine: false } },
  ], {
    x: 8.78, y: 2.5, w: 3.7, h: 3.7, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, color: MUTED, paraSpaceAfter: 10, lineSpacing: 16,
  });

  s.addText("Every action in the activity log records its source, latency and harness version — the app never claims an agent ran when it did not.", {
    x: 0.6, y: 6.6, w: 12.1, h: 0.35, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12.5, italic: true, color: DIM,
  });
  s.addNotes("Point at the violet DronaHQ badges with real latency in the activity feed.");
}

// ---------------------------------------------------------------- 7. GROUNDING
{
  const s = dark();
  title(s, "The same agent, with and without research", "Context & personalisation");

  const panels = [
    ["Without the dossier", ROSE, "“Loomwork recently raised a Series C and is expanding its engineering team… companies like Notion optimize workflows.”", "Both facts invented. Nothing in the prompt was wrong — it simply had nothing true to say."],
    ["With the dossier", EMERALD, "“The flat-file approach Linear employs for content management seems effective… as your platform grows, the minimalistic architecture might pose challenges.”", "Grounded in a fact the Research agent found and cited. Same agent, same prompt."],
  ];
  panels.forEach(([h, col, quote, note], i) => {
    const x = 0.6 + i * 6.25;
    card(s, x, 1.85, 5.85, 3.9);
    dot(s, x + 0.4, 2.2, col);
    s.addText(h, {
      x: x + 0.72, y: 2.04, w: 4.8, h: 0.3, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 16, bold: true, color: col,
    });
    s.addText(quote, {
      x: x + 0.45, y: 2.6, w: 5.0, h: 1.9, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 13.5, italic: true, color: TEXT, lineSpacing: 20,
    });
    s.addText(note, {
      x: x + 0.45, y: 4.62, w: 5.0, h: 0.95, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 11.5, color: DIM, lineSpacing: 16,
    });
  });

  card(s, 0.6, 5.95, 12.1, 0.95, PANEL2);
  s.addText("Grounding is enforced by data flow, not by asking nicely.", {
    x: 0.95, y: 6.08, w: 11.4, h: 0.28, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 14, bold: true, color: TEXT,
  });
  s.addText("The Research agent’s brief is stored on the prospect and injected into every downstream agent under a heading that forbids asserting anything absent from it.", {
    x: 0.95, y: 6.40, w: 11.4, h: 0.46, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 11.5, color: MUTED, lineSpacing: 15,
  });
  s.addNotes("This is the strongest thing in the build. Tell it as a before-and-after story.");
}

// ---------------------------------------------------------------- 8. CONTROL
{
  const s = dark();
  title(s, "A human can stop any part of it, instantly", "Control & safety");

  const levels = [
    ["Campaign pause", "One campaign stops, the rest keep running", EMERALD],
    ["Agent pause", "One agent stops, the campaign continues", VIOLET],
    ["Channel pause", "One channel stops, the others stay open", SKY],
    ["Global kill switch", "All autonomous action halts, platform-wide", ROSE],
    ["Loop toggle", "Stops this browser spending; pauses when hidden", AMBER],
  ];
  levels.forEach(([h, d, col], i) => {
    const y = 1.9 + i * 0.78;
    card(s, 0.6, y, 7.0, 0.66);
    dot(s, 0.92, y + 0.27, col);
    s.addText(h, {
      x: 1.25, y: y + 0.1, w: 2.25, h: 0.26, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 12.5, bold: true, color: TEXT,
    });
    s.addText(d, {
      x: 3.65, y: y + 0.11, w: 3.8, h: 0.46, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 11.5, color: MUTED,
    });
  });

  card(s, 7.95, 1.9, 4.75, 2.35, PANEL2);
  s.addText("No outreach reaches a real company", {
    x: 8.28, y: 2.1, w: 4.1, h: 0.55, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 15, bold: true, color: TEXT, lineSpacing: 20,
  });
  s.addText("Prospects are synthetic people at real company domains, so every email is redirected to one demo inbox. There is no code path that delivers to a prospect address — if the redirect is unset, it refuses to send.", {
    x: 8.28, y: 2.72, w: 4.1, h: 1.4, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 11.5, color: MUTED, lineSpacing: 16,
  });

  card(s, 7.95, 4.4, 4.75, 1.9, PANEL2);
  s.addText("Volume guards", {
    x: 8.28, y: 4.58, w: 4.1, h: 0.28, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 14, bold: true, color: TEXT,
  });
  s.addText("Send cap per instance · 15s between sends · agent calls spaced per agent · loop pauses on hidden tab and idle", {
    x: 8.28, y: 4.92, w: 4.1, h: 1.2, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 11.5, color: MUTED, lineSpacing: 16,
  });
  s.addNotes("The kill switch is stored in Postgres, so it survives a restart. That is deliberate for an emergency stop.");
}

// ---------------------------------------------------------------- 9. STATUS
{
  const s = dark();
  title(s, "What works, what is partial, what we skipped", "Honest status");

  s.addChart(pres.ChartType.doughnut, [{
    name: "Status",
    labels: ["Fully working", "Partial", "Skipped"],
    values: [13, 3, 5],
  }], {
    x: 0.55, y: 1.95, w: 4.3, h: 4.2,
    chartColors: [EMERALD, AMBER, DIM],
    holeSize: 58,
    showLegend: true, legendPos: "b", legendColor: MUTED, legendFontSize: 11,
    showTitle: false,
    showValue: true, dataLabelColor: "0B1220", dataLabelFontSize: 12, dataLabelFontBold: true,
    border: { pt: 0, color: BG },
  });

  const cols = [
    ["Fully working", EMERALD, [
      "Concurrent campaigns, independent state",
      "Full lifecycle and four levels of pause",
      "Prompt versioning, rollback, audit trail",
      "5 DronaHQ agents live in production",
      "Grounded personalisation, real email sent",
      "Postgres-backed shared state",
    ]],
    ["Partial", AMBER, [
      "ICP qualification runs a local port of the agent’s rules",
      "Agents return prose, not their JSON schemas",
      "Email sends; LinkedIn, SMS and voice are modelled",
    ]],
    ["Skipped", DIM, [
      "Vector RAG knowledge base — our largest gap",
      "Authentication",
      "Representative assignment",
      "Live lead sourcing (Apollo)",
      "Voice SDR agent",
    ]],
  ];
  cols.forEach(([h, col, items], i) => {
    const x = 5.15 + i * 2.6;
    dot(s, x, 2.03, col);
    s.addText(h, {
      x: x + 0.24, y: 1.88, w: 2.2, h: 0.28, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 13, bold: true, color: col,
    });
    s.addText(items.map((t, n) => ({
      text: t, options: { bullet: true, breakLine: n !== items.length - 1 },
    })), {
      x, y: 2.35, w: 2.45, h: 3.8, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 10.5, color: MUTED, paraSpaceAfter: 8, lineSpacing: 14,
    });
  });

  s.addText("We would rather name the gaps than have a judge find them. Every claim on these slides is verifiable in the running app.", {
    x: 0.55, y: 6.5, w: 12.2, h: 0.35, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12.5, italic: true, color: DIM,
  });
  s.addNotes("Volunteering the vector RAG gap is stronger than being caught by it.");
}

// ---------------------------------------------------------------- 10. DEMO
{
  const s = dark();
  title(s, "See it running", "Live demo");

  card(s, 0.6, 1.85, 12.1, 1.25, PANEL2);
  dot(s, 1.0, 2.42, EMERALD, 0.16);
  s.addText("sdr-autopilot.vercel.app", {
    x: 1.35, y: 2.18, w: 7.5, h: 0.5, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 26, bold: true, color: EMERALD,
  });
  s.addText("github.com/shanmukhapreetham27/sdr-autopilot", {
    x: 1.35, y: 2.74, w: 8, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, color: MUTED,
  });

  const steps = [
    ["1", "Three campaigns, independent state", "Pause one — the others keep climbing"],
    ["2", "Activity feed", "Every action with its source, latency and prompt version"],
    ["3", "A generated message", "Grounded in a dossier another agent researched"],
    ["4", "Qualification you can check", "Accenture rejected as a consultancy; Deepgram held at 250 staff"],
    ["5", "The demo inbox", "An email an agent wrote, actually delivered"],
  ];
  steps.forEach(([n, h, d], i) => {
    const y = 3.35 + i * 0.68;
    s.addShape(pres.ShapeType.ellipse, {
      x: 0.62, y: y + 0.04, w: 0.34, h: 0.34,
      fill: { color: PANEL }, line: { color: EMERALD, width: 1 },
    });
    s.addText(n, {
      x: 0.62, y: y + 0.09, w: 0.34, h: 0.26, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 12, bold: true, color: EMERALD, align: "center",
    });
    s.addText(h, {
      x: 1.15, y: y + 0.02, w: 4.6, h: 0.28, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 13, bold: true, color: TEXT,
    });
    s.addText(d, {
      x: 5.8, y: y + 0.04, w: 6.9, h: 0.28, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 12, color: MUTED,
    });
  });

  s.addText("Built in 51 hours. 31 source files, 6,457 lines, 16 commits.", {
    x: 0.62, y: 6.66, w: 12.1, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, color: DIM,
  });
  s.addNotes("Switch to the live app here. Start the loop about a minute before this slide so an email is waiting.");
}

pres.writeFile({ fileName: process.argv[2] || "SDR-Autopilot.pptx" })
  .then((f) => console.log("written:", f));
