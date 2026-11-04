/* NovaBank Governance Console: single-page app, no build step.
   Pages render a static skeleton once; live "regions" are refreshed every few seconds and only
   re-painted when their HTML changes, so form inputs are never wiped while you type. */
"use strict";

// --------------------------------------------------------------------------- utilities
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f2 = (v) => (v == null ? "–" : Number(v).toFixed(2));
const f3 = (v) => (v == null ? "–" : Number(v).toFixed(3));
const pct = (v, d = 1) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);
const ms = (v) => (v == null ? "–" : `${Math.round(v).toLocaleString()} ms`);
const usd = (v, d = 6) => (v == null ? "–" : `$${Number(v).toFixed(d)}`);
const when = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" }) : "–");
const titleCase = (s) => String(s).replaceAll("_", " ");

const I = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
  flask: '<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6L4.5 18.5A1.6 1.6 0 0 0 5.9 21h12.2a1.6 1.6 0 0 0 1.4-2.5L14 9V3"/></svg>',
  route: '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
  rollback: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/></svg>',
  pulse: '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};

const pill = (ok, yes = "PASS", no = "FAIL") =>
  ok == null ? `<span class="pill neutral">${I.clock}pending</span>`
    : ok ? `<span class="pill pass">${I.check}${yes}</span>` : `<span class="pill fail">${I.x}${no}</span>`;
const vtag = (v) => (v ? `<span class="tag-v ${esc(v)}">${esc(v)}</span>` : "–");
const mdSafe = (t) => DOMPurify.sanitize(marked.parse(String(t ?? "")));
const srcPill = (simulated) => (simulated ? '<span class="pill sim">simulated</span>' : '<span class="pill real">real</span>');

let S = null;          // global state from /api/state
let page = null;       // current page object
let pageTimer = null;
const memo = {};       // per-page memory (last gate result, loaded docs …)

function who() {
  return { name: $("#who-name").value.trim() || "anonymous", role: $("#who-role").value };
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409) throw new Error(data.refused || "Refused");
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}
const post = (path, body = {}) => api(path, { method: "POST", body: { ...who(), ...body } });

function toast(msg, kind = "good") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${kind === "bad" ? I.alert : I.check}<div>${msg}</div>`;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "bad" ? 9000 : 5000);
}

function region(id, html) {
  const el = document.getElementById(id);
  if (el && el.__h !== html) { el.innerHTML = html; el.__h = html; }
}

// --------------------------------------------------------------------------- lifecycle model
const STAGE_INDEX = {
  not_initialised: -1, baseline: 0, proposal_submitted: 1, proposal_approved: 1, proposal_rejected: 1,
  offline_evaluating: 2, offline_passed: 2, offline_failed: 2, challenger_registered: 3,
  shadow: 4, shadow_passed: 4, shadow_failed: 4, canary: 5, canary_passed: 5, rolled_back: 5,
  rollout_25: 6, rollout_25_passed: 6, rollout_50: 6, rollout_50_passed: 6, rollout_100: 6, rollout_100_passed: 6, promoted: 7,
};
const curIndex = () => STAGE_INDEX[S?.lifecycle?.stage] ?? 0;
const stageIs = (...names) => names.includes(S?.lifecycle?.stage);

const PAGES_META = [
  { id: "overview", label: "Overview", section: "Console" },
  { id: "s0", n: 0, label: "Baseline", section: "Lifecycle" },
  { id: "s1", n: 1, label: "Model proposal" },
  { id: "s2", n: 2, label: "Offline evaluation" },
  { id: "s3", n: 3, label: "Register challenger" },
  { id: "s4", n: 4, label: "Shadow deployment" },
  { id: "s5", n: 5, label: "Canary" },
  { id: "s6", n: 6, label: "Gradual rollout" },
  { id: "s7", n: 7, label: "Promotion & monitoring" },
  { id: "audit", label: "Audit log", section: "Records" },
  { id: "policy", label: "Governance policy" },
];

function renderNav() {
  const ci = curIndex();
  const active = location.hash.replace("#/", "") || "overview";
  let html = "";
  let inRail = false;
  for (const p of PAGES_META) {
    if (p.section) {
      if (inRail) { html += "</div>"; inRail = false; }
      html += `<div class="nav-section">${p.section}</div>`;
      if (p.section === "Lifecycle") { html += '<div class="nav-rail">'; inRail = true; }
    }
    let cls = "nav-item" + (p.id === active ? " active" : "");
    let mark = "";
    if (p.n != null) {
      const done = p.n < ci || (p.n === 7 && stageIs("promoted"));
      cls += done ? " done" : p.n === ci ? " current" : "";
      mark = `<span class="step">${done ? I.check : p.n}</span>`;
    } else {
      mark = `<span class="step">${{ overview: I.pulse, audit: I.lock, policy: I.doc }[p.id]}</span>`;
    }
    html += `<a class="${cls}" href="#/${p.id}">${mark}<span>${p.label}</span></a>`;
    if (p.id === "s7" && inRail) { html += "</div>"; inRail = false; }
  }
  region("nav", html);
}

function splitBar(w, big = false) {
  const a = w?.v1 ?? 0, b = w?.v2 ?? 0;
  return `<div class="split ${big ? "big" : "mini"}" role="img" aria-label="Traffic: v1 ${a}%, v2 ${b}%">
    ${a ? `<div class="v1" style="width:${a}%" data-tip="<b>v1</b> · ${a}% of production traffic"></div>` : ""}
    ${b ? `<div class="v2" style="width:${b}%" data-tip="<b>v2</b> · ${b}% of production traffic"></div>` : ""}</div>`;
}

function renderChrome() {
  renderNav();
  const lc = S.lifecycle;
  $("#sim-badge").hidden = !S.simulation;
  region("traffic-pill", `<span>Champion ${vtag(lc.champion || "v1")}</span>${splitBar(S.weights)}
    <span class="mono">${S.weights.v1}/${S.weights.v2}</span>${lc.shadow ? '<span class="pill brand">mirroring</span>' : ""}`);
}

// --------------------------------------------------------------------------- shared blocks
function head(meta) {
  return `<div class="page-head"><div>
      ${meta.n != null ? `<div class="eyebrow">Stage ${meta.n} of 7</div>` : `<div class="eyebrow">${esc(meta.eyebrow || "")}</div>`}
      <h1>${meta.title}</h1><p class="lead">${meta.lead}</p></div>
      <div id="head-status"></div></div>`;
}

function how(ex) {
  return `<section class="card how"><div class="card-title">${I.route}How this stage works</div>
    <div class="how-grid">
      <ol class="flow">${ex.flow.map(([w, t]) => `<li><span class="who">${w}</span><div class="what">${t}</div></li>`).join("")}</ol>
      <div class="why">
        <h4>Why companies do this</h4><p>${ex.why}</p>
        ${ex.gate ? `<h4>The gate</h4><p>${ex.gate}</p>` : ""}
        ${ex.chips ? `<div class="chips">${ex.chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div>` : ""}
        ${ex.real ? `<div class="realsim">${I.flask}<div>${ex.real}</div></div>` : ""}
      </div></div></section>`;
}

function acting(roles) {
  const w = who();
  const ok = !roles || roles.includes(w.role);
  return `<div class="acting">${I.user}Acting as <b>${esc(w.name)}</b> · ${esc(w.role)}
    ${roles ? `· allowed: ${roles.map((r) => `<span class="pill ${r === w.role ? "pass" : "neutral"}">${esc(r)}</span>`).join(" ")}` : ""}
    ${roles && !ok ? '<span class="pill warn">switch role in the top bar</span>' : ""}</div>`;
}

function gateBanner(passed, title, sub = "") {
  const cls = passed == null ? "wait" : passed ? "pass" : "fail";
  const icon = passed == null ? I.clock : passed ? I.check : I.x;
  const word = passed == null ? "Not enough data yet" : passed ? "PASS" : "FAIL";
  return `<div class="gate ${cls}"><div class="seal">${icon}</div><div><h3>${title}: ${word}</h3>${sub ? `<p>${sub}</p>` : ""}</div></div>`;
}

function checksTable(checks) {
  if (!checks?.length) return `<div class="empty">${I.shield}<div>No checks yet</div></div>`;
  const rule = (r) => Object.entries(r || {}).map(([k, v]) => `${k === "min" ? "≥" : "≤"} ${typeof v === "number" ? +v.toFixed(4) : v}`).join(", ");
  return `<div class="table-wrap"><table><thead><tr><th>Result</th><th>Check</th><th class="num">Value</th><th class="num">Threshold</th></tr></thead><tbody>
    ${checks.map((c) => `<tr><td>${pill(c.passed)}</td><td>${esc(c.check)}${c.note ? ` <span class="muted small">(${esc(c.note)})</span>` : ""}</td>
      <td class="num mono">${c.value == null ? "–" : +Number(c.value).toFixed(4)}</td><td class="num mono">${esc(rule(c.rule))}</td></tr>`).join("")}
    </tbody></table></div>`;
}

async function jobsRegion(id, kinds) {
  const rows = await api(`/api/jobs?kinds=${kinds}`);
  if (!rows.length) { region(id, ""); return rows; }
  const j = rows[0];
  const cls = { queued: "neutral", running: "brand", done: "pass", failed: "fail", cancelled: "neutral" }[j.status];
  const icon = { queued: I.clock, running: I.pulse, done: I.check, failed: I.x, cancelled: I.x }[j.status];
  region(id, `<div class="notice ${j.status === "failed" ? "bad" : "info"}">${icon}<div>
      <b>Job #${j.id} · ${esc(titleCase(j.kind))}</b> <span class="pill ${cls}">${j.status}</span>
      <div class="small">${esc(j.progress || "")} ${j.error ? `<br>${esc(j.error)}` : ""}</div>
      <div class="small muted">requested by ${esc(j.actor)} · ${when(j.created_at)}</div></div></div>`);
  return rows;
}

const disabledNote = (text) => `<div class="notice">${I.lock}<div>${text}</div></div>`;

// --------------------------------------------------------------------------- charts (inline SVG)
function metricBars(champ, chall, thresholds) {
  const metrics = ["answer_relevancy", "helpfulness", "correctness", "policy_compliance", "toxicity_free", "bias_free", "redteam_pass_rate"];
  const W = 560, L = 140, R = 44, rowH = 44, plot = W - L - R;
  const H = metrics.length * rowH + 26;
  const x = (v) => L + Math.max(0, Math.min(1, v)) * plot;
  let g = "";
  [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
    g += `<line class="grid-line" x1="${x(t)}" x2="${x(t)}" y1="4" y2="${H - 22}"/>
          <text x="${x(t)}" y="${H - 6}" text-anchor="middle">${t}</text>`;
  });
  metrics.forEach((m, i) => {
    const y = i * rowH + 8, a = champ[m], b = chall[m], thr = thresholds[m]?.min;
    const bar = (v, yy, cls) => v == null ? "" :
      `<rect x="${L}" y="${yy}" width="${Math.max(2, x(v) - L)}" height="13" rx="4" fill="var(--${cls})"/>
       <text x="${x(v) + 6}" y="${yy + 11}">${f2(v)}</text>`;
    g += `<text x="${L - 12}" y="${y + 18}" text-anchor="end" style="fill:var(--text)">${titleCase(m)}</text>
      ${bar(a, y + 2, "v1")}${bar(b, y + 17, "v2")}
      ${thr != null ? `<line class="thr" x1="${x(thr)}" x2="${x(thr)}" y1="${y - 1}" y2="${y + 33}"/>` : ""}
      <rect class="hit" x="0" y="${y - 3}" width="${W}" height="${rowH - 4}"
        data-tip="<b>${titleCase(m)}</b><br>v1 champion: ${f3(a)}<br>v2 challenger: ${f3(b)}${thr != null ? `<br>threshold: ≥ ${thr}` : ""}"/>`;
  });
  return `<div class="legend"><span><i style="background:var(--v1)"></i>v1 champion</span><span><i style="background:var(--v2)"></i>v2 challenger</span><span><i class="tick"></i>gate threshold</span></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Offline metrics v1 vs v2">${g}</svg>`;
}

function sliceDumbbell(champSlices, challSlices, metric) {
  const rows = Object.keys(challSlices).map((s) => ({ s, a: champSlices[s]?.[metric], b: challSlices[s]?.[metric], n: challSlices[s]?.n }))
    .filter((r) => r.a != null && r.b != null).sort((p, q) => (p.b - p.a) - (q.b - q.a));
  if (!rows.length) return `<div class="empty">${I.chart}<div>No slices</div></div>`;
  const W = 1060, L = 230, R = 30, rowH = 24, plot = W - L - R;
  const lo = Math.max(0, Math.floor(Math.min(...rows.flatMap((r) => [r.a, r.b])) * 10) / 10);
  const H = rows.length * rowH + 28;
  const x = (v) => L + ((v - lo) / (1 - lo)) * plot;
  let g = "";
  for (let t = lo; t <= 1.0001; t += 0.1) {
    g += `<line class="grid-line" x1="${x(t)}" x2="${x(t)}" y1="2" y2="${H - 22}"/><text x="${x(t)}" y="${H - 6}" text-anchor="middle">${t.toFixed(1)}</text>`;
  }
  rows.forEach((r, i) => {
    const y = i * rowH + 12, worse = r.b < r.a;
    g += `<text x="${L - 12}" y="${y + 4}" text-anchor="end" style="fill:${worse ? "var(--bad-ink)" : "var(--text-2)"}">${esc(titleCase(r.s))}</text>
      <line x1="${x(r.a)}" x2="${x(r.b)}" y1="${y}" y2="${y}" stroke="var(--border-strong)" stroke-width="2"/>
      <circle cx="${x(r.a)}" cy="${y}" r="5" fill="var(--v1)" stroke="var(--surface)" stroke-width="2"/>
      <circle cx="${x(r.b)}" cy="${y}" r="5" fill="var(--v2)" stroke="var(--surface)" stroke-width="2"/>
      <rect class="hit" x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}"
        data-tip="<b>${esc(titleCase(r.s))}</b> (n=${r.n})<br>v1: ${f3(r.a)} · v2: ${f3(r.b)}<br>Δ ${(r.b - r.a >= 0 ? "+" : "") + (r.b - r.a).toFixed(3)}"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Per-slice ${metric}">${g}</svg>`;
}

function verdictBar(st) {
  const total = (st.challenger_wins || 0) + (st.ties || 0) + (st.champion_wins || 0);
  if (!total) return `<div class="empty">${I.eye}<div>No judged pairs yet</div></div>`;
  const w = (n) => (n / total) * 100;
  return `<div class="split big">
      <div class="v2" style="width:${w(st.challenger_wins)}%" data-tip="<b>v2 wins</b> · ${st.challenger_wins} pairs"></div>
      <div class="tie" style="width:${w(st.ties)}%" data-tip="<b>Ties</b> · ${st.ties} pairs"></div>
      <div class="v1" style="width:${w(st.champion_wins)}%" data-tip="<b>v1 wins</b> · ${st.champion_wins} pairs"></div></div>
    <div class="split-labels"><span><span class="tag-v v2">v2 wins</span> ${st.challenger_wins} (${pct(st.challenger_wins / total, 0)})</span>
      <span><span class="tag-v">tie</span> ${st.ties} (${pct(st.ties / total, 0)})</span>
      <span><span class="tag-v v1">v1 wins</span> ${st.champion_wins} (${pct(st.champion_wins / total, 0)})</span></div>`;
}

// --------------------------------------------------------------------------- stage explanations
const EX = {
  s0: {
    why: "You cannot govern what you have not inventoried. Before any change, the bank records exactly which model, prompt, parameters and route serve customers. SR 11-7 starts with a model inventory.",
    flow: [["Worker · startup", "Registers the bank policy (<code>governance/policy.md</code>) as a versioned prompt in the <b>MLflow Prompt Registry</b>."],
      ["Worker → MLflow", "Logs Nova Assist v1 as an MLflow <b>pyfunc</b> model (route, prompt version, parameters) and sets alias <code>@champion</code>."],
      ["Worker → LiteLLM", "Creates least-privilege <b>virtual keys</b> and points the production route <code>nova-assist</code> 100% at v1."],
      ["Customer → App → Gateway", "The Nova Assist app answers only through the gateway, tagging every request with an ID and the traffic window."]],
    chips: ["SR 11-7 model inventory", "ISO/IEC 42001 · documented AI system"],
    real: "<b>Real here:</b> \"Try production\" sends 1 real request through the app to Groq.",
  },
  s1: {
    why: "Every change starts as a written request: why, for what use, with what risk, at what cost, how success is judged and how it is undone. Then someone independent with authority decides. That is SR 11-7's \"effective challenge\".",
    flow: [["Product owner", "Submits the proposal (<code>proposals/nova-assist-v2.yaml</code>) and model card. Their SHA-256 hashes are recorded."],
      ["Approver", "A role listed in <code>policy.yaml → approvals.proposal</code> approves or rejects, with a written rationale."],
      ["Console → audit log + MLflow", "The decision is written to the append-only audit log and as tags on the registered model."],
      ["Gate", "Nothing moves to evaluation until the proposal is APPROVED."]],
    gate: "Approver role must be allowed, and a rationale is mandatory.",
    chips: ["NIST AI RMF · Map", "EU AI Act · risk classification", "SR 11-7 · effective challenge"],
    real: "<b>No LLM calls</b> in this stage.",
  },
  s2: {
    why: "Before any customer sees v2, both versions sit the same exam (a golden set of real banking questions plus red-team attacks), graded by an independent LLM judge against thresholds written down in advance.",
    flow: [["Console → Worker", "Queues an evaluation job. The worker scores <b>v1 and v2 on the same examples</b>."],
      ["Worker → Gateway → Judge", "DeepEval metrics (answer relevancy, G-Eval helpfulness/correctness/policy compliance, toxicity, bias, red-team refusal) are scored by <code>nova-judge</code>, a different model family."],
      ["Worker → MLflow", "Logs params (judge, dataset version, prompt, git commit, policy fingerprint), metrics, datasets and the per-example table."],
      ["Gate", "Absolute thresholds <b>and</b> no safety regression vs v1 <b>and</b> no per-intent slice regression."]],
    gate: "All checks must pass; one ❌ means FAIL. Thresholds live in <code>policy.yaml → evaluation</code>.",
    chips: ["NIST AI RMF · Measure", "EU AI Act Art. 15 · accuracy & robustness", "SR 11-7 · validation"],
    real: "<b>Real here:</b> 1 v2 answer + 1 real judge call (the live sample). The other 141 examples per version are <b>simulated</b> and labelled.",
  },
  s3: {
    why: "A passing candidate gets an official identity in the registry, linked to its evidence. Two years from now, \"why was this model allowed?\" must be answerable from the registry alone.",
    flow: [["Precondition", "Only possible after the offline gate PASSED."],
      ["Console → MLflow", "Logs v2 as a new version of <code>nova-assist</code> (pyfunc: route, prompt, parameters)."],
      ["Lineage tags", "Tags the version with the evaluation run, proposal SHA, model card SHA and approver."],
      ["Alias", "Sets <code>@challenger</code>. <code>@champion</code> still points at v1."]],
    chips: ["MLflow aliases replace Staging/Production stages (deprecated since 2.9)", "Traceability"],
    real: "<b>No LLM calls</b> in this stage.",
  },
  s4: {
    why: "Curated exams miss messy real traffic. In shadow mode v2 receives a copy of every production request, but customers only ever see v1's answer. Zero customer risk.",
    flow: [["Approver → Gateway", "LiteLLM's native <code>silent_model</code> is set on the v1 deployment: every request is mirrored to v2."],
      ["Customer", "Gets v1's answer. The mirrored call runs in the background and adds no latency."],
      ["Worker", "Pairs each mirrored call with the customer's answer using the request ID LiteLLM copies into its spend logs."],
      ["Worker → Judge", "Pairwise comparison with randomised A/B order (counters position bias), plus a policy-violation check."],
      ["Human review", "A judge-flagged <b>critical</b> violation blocks the gate until a Model Risk Officer confirms or overturns it."]],
    gate: "Minimum judged pairs, win+tie rate, zero critical violations, challenger error-rate ceiling.",
    chips: ["Zero customer exposure", "EU AI Act Art. 14 · human oversight"],
    real: "<b>Real here:</b> 1 request is really mirrored and really judged (3 calls). <b>400 simulated</b> pairs give production-sized evidence.",
  },
  s5: {
    why: "A small slice of real customers is served by v2 while metrics are watched closely, ready to pull back at once. Lab results are not enough; the EU AI Act (Art. 72) and SR 11-7 expect live monitoring.",
    flow: [["Approver → Gateway", "Changes the LiteLLM router weights on <code>nova-assist</code> (e.g. 95 / 5). This is a governed, audited action."],
      ["Router", "Each customer request lands on v1 or v2 by weight; the app tags the answer with the version that produced it."],
      ["Worker", "Computes per-version error rate (including failures hidden by fallback), p95 latency, cost and judged quality."],
      ["Worker · every 15 s", "Re-checks the live gate: PASS completes the step; a breach <b>rolls back automatically</b> to 100% v1 and logs an incident."]],
    gate: "Minimum samples; error rate, p95 latency ratio and cost ratio vs v1; minimum sampled quality.",
    chips: ["EU AI Act Art. 72 · post-market monitoring", "Automatic rollback"],
    real: "<b>Real here:</b> 1 request really routed by the gateway weights. <b>1,500 simulated</b> requests. Rollback demo: tighten <code>live_gate.max_p95_latency_ratio</code> to 0.5 on the Policy page.",
  },
  s6: {
    why: "Some problems only appear at scale: rate limits, cost, rare intents. Exposure grows in pre-agreed steps, each with the same gate and automatic rollback, which bounds the blast radius.",
    flow: [["Approver", "Approves each increase: 25% → 50% → 100%. People approve increases; the system may only decrease exposure on its own."],
      ["Gateway", "Router weights change for real at each step."],
      ["Worker · every 15 s", "Same live gate as canary. At 100% there is no v1 traffic, so ratios compare against v1's metrics from the canary window."],
      ["Breach", "Automatic rollback to 100% v1 plus an incident entry in the audit log."]],
    gate: "Same live gate as canary, at every step.",
    chips: ["Blast-radius control", "Human approves increases"],
    real: "<b>Real here:</b> 1 real request at 100% (answered by v2 and judged). <b>400 / 300 / 200 simulated</b> per step.",
  },
  s7: {
    why: "With every gate passed at 100%, it becomes official: v2 is champion, v1 is retired but kept for rollback. A report is generated from the records, and the champion keeps being re-checked because models and providers drift.",
    flow: [["Governance Board → MLflow", "Moves <code>@champion</code> to v2; v1 gets status <code>retired</code> and alias <code>@retired</code> (never deleted)."],
      ["Gateway", "Production route serves 100% v2 with no challenger."],
      ["Report", "Generated purely from records: proposal, registry, evaluation, shadow, gate decisions, approvals, full audit trail."],
      ["Continuous governance", "A drift check re-evaluates the champion against its reference scores and records a gate decision."]],
    chips: ["SR 11-7 · ongoing monitoring", "EU AI Act Art. 12 · record-keeping", "ISO/IEC 42001 · continual improvement"],
    real: "<b>No LLM calls</b> for promotion and report. Drift check is <b>simulated</b>; set <code>simulation.drift_shift: -0.10</code> to make it detect drift.",
  },
};

// --------------------------------------------------------------------------- pages
const PAGES = {};

PAGES.overview = {
  render: () => `${head({ eyebrow: "NovaBank · Nova Assist", title: "Model governance, end to end",
      lead: "NovaBank's support assistant runs <b>v1</b>. The product team proposes <b>v2</b>. The governance board says: <i>prove it, roll it out safely, and keep an audit trail.</i> Follow the change through the stages in the sidebar." })}
    <div class="grid g4" id="ov-health"></div>
    <section class="card"><div class="card-title">${I.route}The lifecycle<span class="sub">click a stage to open it</span></div><div class="map" id="ov-map"></div></section>
    <div class="grid g2">
      <section class="card"><div class="card-title">${I.route}Production traffic right now</div><div id="ov-traffic"></div></section>
      <section class="card"><div class="card-title">${I.pulse}Real Groq usage<span class="sub">from LiteLLM spend logs</span></div><div id="ov-usage"></div></section>
    </div>
    <section class="card"><div class="card-title">${I.route}Routes behind the gateway<span class="sub">live from the LiteLLM model API</span></div><div id="ov-routes"></div>
      <hr class="sep"><div class="row between"><div class="muted small">Make one tiny real call to each model to prove the key and routes work (3 Groq calls).</div>
      <button class="btn" data-act="liveCheck">${I.play}Live check</button></div><div id="ov-live" style="margin-top:12px"></div></section>
    <section class="card flat"><div class="card-title">${I.info}Open the underlying tools</div>
      <div class="grid g3">
        <a class="card" href="http://localhost:5000" target="_blank" rel="noopener"><b>MLflow</b><div class="muted small">Runs, Model Registry, Prompt Registry · :5000</div></a>
        <a class="card" href="http://localhost:4000/ui" target="_blank" rel="noopener"><b>LiteLLM admin</b><div class="muted small">Routes, keys, spend logs · user <code>admin</code>, password = master key · :4000</div></a>
        <a class="card" href="http://localhost:8000/docs" target="_blank" rel="noopener"><b>Nova Assist API</b><div class="muted small">The production app's Swagger UI · :8000</div></a>
      </div></section>`,
  async refresh() {
    const [h, u] = await Promise.all([api("/api/health"), api("/api/usage")]);
    const tile = (k, label) => `<div class="card stat"><div class="label">${label}</div><div class="value" style="font-size:20px">${pill(h[k], "Healthy", "Down")}</div></div>`;
    region("ov-health", tile("gateway", "LiteLLM gateway") + tile("mlflow", "MLflow") + tile("app", "Nova Assist app") + tile("postgres", "Postgres"));
    const ci = curIndex();
    const desc = ["Inventory what is live", "Written request + approval", "Same exam for v1 and v2", "Official identity + lineage", "Mirror traffic silently", "Small slice of customers", "25% → 50% → 100%", "Champion, report, drift"];
    region("ov-map", PAGES_META.filter((p) => p.n != null).map((p) => {
      const done = p.n < ci || (p.n === 7 && stageIs("promoted"));
      return `<a href="#/${p.id}" class="${done ? "done" : p.n === ci ? "current" : ""}"><div class="n">STAGE ${p.n} ${done ? "· DONE" : p.n === ci ? "· NOW" : ""}</div>
        <div class="t">${p.label}</div><div class="d">${desc[p.n]}</div></a>`;
    }).join(""));
    region("ov-traffic", `${splitBar(S.weights, true)}<div class="split-labels"><span>${vtag("v1")} ${S.weights.v1}%</span><span>${vtag("v2")} ${S.weights.v2}%</span></div>
      <div class="kv" style="margin-top:16px"><div><div class="k">Lifecycle stage</div><div class="v" style="font-size:14px">${esc(titleCase(S.lifecycle.stage))}</div></div>
      <div><div class="k">Champion</div><div class="v" style="font-size:14px">${vtag(S.lifecycle.champion || "v1")}</div></div>
      <div><div class="k">Shadow mirroring</div><div class="v" style="font-size:14px">${S.lifecycle.shadow ? "on" : "off"}</div></div></div>`);
    region("ov-usage", u.length ? `<div class="table-wrap"><table><thead><tr><th>Route</th><th class="num">Calls</th><th class="num">Tokens</th></tr></thead><tbody>
      ${u.map((r) => `<tr><td class="mono">${esc(r.model_group)}</td><td class="num">${r.calls}</td><td class="num">${Number(r.tokens || 0).toLocaleString()}</td></tr>`).join("")}</tbody></table></div>
      <div class="muted small" style="margin-top:8px">Free tier for this key: 1,000 requests/day, 8,000 tokens/min, 200,000 tokens/day per model. Simulated records never appear here.</div>`
      : `<div class="empty">No calls yet</div>`);
    region("ov-routes", `<div class="table-wrap"><table><thead><tr><th>Route</th><th>Provider model</th><th>Version</th><th class="num">Weight</th><th>Mirrors to</th><th>Defined in</th></tr></thead><tbody>
      ${S.routes.map((r) => `<tr><td class="mono">${esc(r.route)}</td><td class="mono">${esc(r.provider_model)}</td><td>${vtag(r.version)}</td>
        <td class="num">${r.weight ?? "–"}</td><td class="mono">${esc(r.silent_model || "–")}</td>
        <td>${r.db_model ? '<span class="pill brand">LiteLLM DB · governed</span>' : '<span class="pill neutral">config file</span>'}</td></tr>`).join("")}</tbody></table></div>`);
  },
};

PAGES.s0 = {
  render: () => `${head({ n: 0, title: "Baseline", lead: "What exactly is in production before anything changes: model, prompt, parameters and route, all versioned." })}
    ${how(EX.s0)}
    <div class="grid g2">
      <section class="card"><div class="card-title">${I.shield}In production now</div><div id="s0-prod"></div></section>
      <section class="card"><div class="card-title">${I.send}Try production<span class="sub">1 real Groq call</span></div>
        <label class="field">Ask Nova Assist as a customer<input class="input" id="s0-q" value="How do I activate my new debit card?"></label>
        <button class="btn primary" data-act="askProd">${I.send}Send to the production app</button><div id="s0-answer" style="margin-top:14px"></div></section>
    </div>
    <section class="card"><div class="card-title">${I.tag}Model Registry · <code>nova-assist</code><span class="sub"><a href="http://localhost:5000/#/models/nova-assist" target="_blank" rel="noopener">open in MLflow ↗</a></span></div><div id="s0-reg"></div></section>
    <section class="card flat"><div class="card-title">${I.rollback}Reset demo</div>
      <p class="muted" style="margin-top:-6px">Restores Stage 0: 100% v1, <code>@champion</code> → v1, clears traffic, shadow pairs and gate decisions. The audit log is append-only, so the reset itself is recorded there.</p>
      <label class="check-line"><input type="checkbox" id="s0-confirm"> I understand this restarts the lesson</label>
      <button class="btn danger" data-act="reset">${I.rollback}Reset to Stage 0</button></section>`,
  async refresh() {
    const champ = S.registry.find((v) => v.aliases.includes("champion"));
    region("s0-prod", `<div class="kv"><div><div class="k">Champion</div><div class="v">${vtag(champ?.tags.nova_version)} <small>registry v${champ?.version ?? "–"}</small></div></div>
      <div><div class="k">Provider model</div><div class="v mono" style="font-size:12.5px">${esc(champ?.tags.provider_model)}</div></div>
      <div><div class="k">Prompt</div><div class="v mono" style="font-size:12.5px">${esc(S.prompt.uri)}</div></div>
      <div><div class="k">Gateway route</div><div class="v mono" style="font-size:12.5px">nova-assist → ${esc(champ?.tags.gateway_route)}</div></div></div>
      <div style="margin-top:14px">${splitBar(S.weights, true)}<div class="split-labels"><span>${vtag("v1")} ${S.weights.v1}%</span><span>${vtag("v2")} ${S.weights.v2}%</span></div></div>
      ${S.prompt.in_sync ? "" : `<div class="notice warn" style="margin-top:12px">${I.alert}<div><b>policy.md differs from the registered prompt.</b> Restart the worker to register a new prompt version.</div></div>`}`);
    region("s0-reg", registryTable());
  },
};

function registryTable() {
  if (!S.registry.length) return `<div class="empty">Not registered yet</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Registry version</th><th>Aliases</th><th>Nova version</th><th>Status</th><th>Provider model</th><th>Prompt</th><th>Evaluation run</th></tr></thead><tbody>
    ${S.registry.slice().reverse().map((v) => `<tr><td><b>v${v.version}</b></td>
      <td>${v.aliases.map((a) => `<span class="pill ${a === "champion" ? "pass" : a === "challenger" ? "brand" : "neutral"}">@${esc(a)}</span>`).join(" ") || "–"}</td>
      <td>${vtag(v.tags.nova_version)}</td><td>${esc(v.tags.status || "–")}</td><td class="mono">${esc(v.tags.provider_model)}</td>
      <td class="mono">${esc(v.tags.prompt_uri)}</td><td class="mono small">${esc((v.tags.eval_run_id || "–").slice(0, 12))}</td></tr>`).join("")}</tbody></table></div>`;
}

PAGES.s1 = {
  render: () => `${head({ n: 1, title: "Model proposal", lead: "The product team asks to replace v1 with v2. Nothing moves until someone independent, with the right role, approves it in writing." })}
    ${how(EX.s1)}
    <div class="grid" style="grid-template-columns: minmax(0,1.6fr) minmax(0,1fr)">
      <section class="card"><div class="card-title">${I.doc}Proposal</div><div id="s1-doc"><div class="empty">Loading…</div></div></section>
      <section class="card"><div class="card-title">${I.shield}Board decision</div><div id="s1-act"></div></section>
    </div>`,
  async refresh() {
    if (!memo.proposal) {
      memo.proposal = await api("/api/proposal");
      const p = memo.proposal.proposal, est = p.expected_cost_impact.estimated_cost_per_1k_requests_usd;
      region("s1-doc", `<h2 style="font-size:18px">${esc(p.id)} · ${esc(p.title)}</h2>
        <div class="kv" style="margin:14px 0"><div><div class="k">Risk tier</div><div class="v">${esc(p.risk.tier)}</div></div>
          <div><div class="k">Est. cost / 1K requests</div><div class="v">$${est.v2} <small>vs $${est.v1} (+${Math.round((est.v2 / est.v1 - 1) * 100)}%)</small></div></div>
          <div><div class="k">Owner</div><div class="v" style="font-size:14px">${esc(p.owner.name)}</div></div></div>
        <p><b>Business justification.</b> ${esc(p.business_justification)}</p>
        <div class="grid g2"><div><b>Intended use</b><ul>${p.intended_use.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
          <div><b>Out of scope</b><ul>${p.out_of_scope_use.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
        <b>Risk assessment</b><div class="table-wrap" style="margin:8px 0 14px"><table><thead><tr><th>Risk</th><th>Likelihood</th><th>Impact</th><th>Control (a later stage)</th></tr></thead><tbody>
          ${p.risk.assessment.map((r) => `<tr><td>${esc(r.risk)}</td><td>${esc(r.likelihood)}</td><td>${esc(r.impact)}</td><td>${esc(r.control)}</td></tr>`).join("")}</tbody></table></div>
        <b>Success criteria</b><ul>${p.success_criteria.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <p><b>Rollback plan.</b> ${esc(p.rollback_plan)}</p>
        <details class="disclose"><summary>Model card</summary><div class="md">${DOMPurify.sanitize(marked.parse(memo.proposal.model_card))}</div></details>
        <details class="disclose"><summary>Raw proposal YAML</summary><div><pre class="yaml">${esc(memo.proposal.raw)}</pre></div></details>`);
    }
    const lc = S.lifecycle, roles = S.policy.approvals.proposal;
    let html;
    if (stageIs("baseline", "proposal_rejected", "rolled_back", "offline_failed", "shadow_failed")) {
      html = `<p class="muted" style="margin-top:-4px">Submitting records the proposal and model card hashes in the audit log.</p>
        ${acting()}<button class="btn primary" data-act="submitProposal">${I.send}Submit to the governance board</button>`;
    } else if (stageIs("proposal_submitted")) {
      html = `${acting(roles)}
        <div class="seg" id="s1-choice" style="margin-bottom:12px"><button class="on" data-act="choice" data-v="approve">Approve</button><button data-act="choice" data-v="reject">Reject</button></div>
        <label class="field">Rationale <span class="hint">recorded in the audit log</span><textarea class="input" id="s1-comment" placeholder="e.g. Medium risk accepted; proceed to offline evaluation under policy 1.0."></textarea></label>
        <button class="btn primary" data-act="decide">${I.shield}Record decision</button>`;
    } else {
      html = `<div class="notice good">${I.check}<div><b>Decided.</b> Approver: ${esc(lc.proposal_approver || "–")}<br><span class="small">Current stage: ${esc(titleCase(lc.stage))}</span></div></div>`;
    }
    region("s1-act", html);
  },
};

PAGES.s2 = {
  render: () => `${head({ n: 2, title: "Offline evaluation", lead: "Both versions sit the same exam: real banking questions plus red-team attacks, graded by an independent judge against pre-agreed thresholds." })}
    ${how(EX.s2)}
    <section class="card"><div class="card-title">${I.play}Run the evaluation</div><div id="s2-act"></div><div id="s2-job" style="margin-top:12px"></div></section>
    <div id="s2-res"></div>`,
  async refresh() {
    const ev = S.policy.evaluation, prof = ev.profiles[ev.profile];
    let act;
    if (stageIs("proposal_approved", "offline_failed")) {
      act = `<p class="muted" style="margin-top:-4px">Profile <code>${ev.profile}</code>: ${prof.per_slice} examples per ${prof.slice_by} + red-team, judged by <code>${esc(S.models["nova-judge"])}</code>. Takes about 15 s.</p>
        ${acting()}<button class="btn primary" data-act="runEval">${I.play}Run offline evaluation (v1 and v2)</button>`;
    } else if (curIndex() < 2 || stageIs("proposal_submitted", "proposal_rejected")) {
      act = disabledNote("The proposal must be <b>approved</b> first (Stage 1).");
    } else if (stageIs("offline_evaluating")) {
      act = `<div class="notice info">${I.pulse}<div><b>Evaluation running…</b></div></div>`;
    } else {
      act = `<div class="notice good">${I.check}<div><b>Evaluation complete.</b> Results below.</div></div>`;
    }
    region("s2-act", act);
    await jobsRegion("s2-job", "offline_eval");
    const { eval: r, experiment_id } = await api("/api/offline");
    if (!r) { region("s2-res", ""); return; }
    const sig = r.ts + (memo.s2metric || "correctness");
    if (memo.s2sig === sig) return;
    memo.s2sig = sig;
    const ch = r.challenger, cp = r.champion, run = (id) => `http://localhost:5000/#/experiments/${experiment_id}/runs/${id}`;
    const op = ["latency_p50_ms", "latency_p95_ms", "avg_total_tokens", "cost_per_1k_requests_usd"];
    const opFmt = { latency_p50_ms: ms, latency_p95_ms: ms, avg_total_tokens: (v) => Math.round(v), cost_per_1k_requests_usd: (v) => usd(v, 3) };
    const live = (ch.live_results || [])[0];
    const metric = memo.s2metric || "correctness";
    region("s2-res", `
      ${gateBanner(r.passed, "Offline gate", `${r.checks.filter((c) => c.passed).length} of ${r.checks.length} checks passed · dataset ${esc(ch.dataset_version)} · profile ${esc(ch.profile)} · <a href="${run(cp.run_id)}" target="_blank" rel="noopener">v1 run ↗</a> · <a href="${run(ch.run_id)}" target="_blank" rel="noopener">v2 run ↗</a>`)}
      <div class="grid g4">${op.map((k) => `<div class="card stat"><div class="label">${titleCase(k.replace("_ms", "").replace("_usd", ""))}</div>
        <div class="value" style="font-size:20px">${opFmt[k](ch.overall[k])}</div><div class="foot">v1: ${opFmt[k](cp.overall[k])}</div></div>`).join("")}</div>
      <div class="grid" style="grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)">
        <section class="card"><div class="card-title">${I.chart}Quality & safety metrics<span class="sub">${ch.simulated_examples ?? 0} simulated + ${ch.live_examples ?? 0} live examples per version</span></div>${metricBars(cp.overall, ch.overall, S.policy.evaluation.thresholds)}</section>
        <section class="card"><div class="card-title">${I.flask}Live sample<span class="sub">real Groq calls</span></div>
          ${live ? `<div class="muted small">Customer</div><div style="margin:4px 0 10px"><b>${esc(live.input)}</b></div>
            <div class="muted small">v2 answer (real)</div><div class="answer" style="margin-top:4px;max-height:260px;overflow:auto">${mdSafe(live.output)}</div>
            <div class="answer-meta">${S.policy.evaluation.live_metrics.map((m) => `<span class="pill real">${titleCase(m)} ${f2(live[m])} · real judge</span>`).join("")}<span>${ms(live.latency_ms)}</span></div>`
            : `<div class="empty">No live sample in this run (simulation off: every example was real).</div>`}</section>
      </div>
      <section class="card"><div class="card-title">${I.chart}Per-${esc(S.policy.evaluation.profiles[S.policy.evaluation.profile].slice_by)} slices
          <span class="sub">sorted by v2 − v1; a regression in one slice can't hide behind the average</span></div>
        <div class="row between" style="margin-bottom:10px"><div class="legend" style="margin:0"><span><i style="background:var(--v1)"></i>v1</span><span><i style="background:var(--v2)"></i>v2</span><span class="muted">labels in red = v2 worse than v1</span></div>
          <div class="seg">${["correctness", "policy_compliance", "helpfulness"].map((m) => `<button class="${m === metric ? "on" : ""}" data-act="s2metric" data-v="${m}">${titleCase(m)}</button>`).join("")}</div></div>
        ${sliceDumbbell(cp.slices, ch.slices, metric)}</section>
      <section class="card"><div class="card-title">${I.shield}Gate checks<span class="sub">thresholds from governance/policy.yaml</span></div>${checksTable(r.checks)}</section>`);
  },
};

PAGES.s3 = {
  render: () => `${head({ n: 3, title: "Register the challenger", lead: "The passing candidate gets an official registry identity, linked to every piece of evidence that justified it." })}
    ${how(EX.s3)}
    <div class="grid g2">
      <section class="card"><div class="card-title">${I.tag}Register</div><div id="s3-act"></div></section>
      <section class="card flat"><div class="card-title">${I.info}Why aliases, not stages?</div>
        <p class="muted" style="margin-top:-6px">MLflow deprecated the fixed <i>Staging / Production / Archived</i> stages in 2.9. <b>Aliases</b> are named, movable pointers (<code>@champion</code>, <code>@challenger</code>, <code>@retired</code>). Moving one is a single atomic, auditable operation, a model can hold any number of roles, and deployments resolve <code>models:/nova-assist@champion</code> instead of a hard-coded version.</p></section>
    </div>
    <section class="card"><div class="card-title">${I.tag}Model Registry · <code>nova-assist</code></div><div id="s3-reg"></div></section>`,
  async refresh() {
    let act;
    if (stageIs("offline_passed")) act = `${acting()}<button class="btn primary" data-act="register">${I.tag}Register v2 as nova-assist@challenger</button>`;
    else if (stageIs("offline_failed")) act = `<div class="notice bad">${I.x}<div><b>The offline gate failed.</b> v2 cannot be registered.</div></div>`;
    else if (curIndex() < 2) act = disabledNote("Requires a <b>passed</b> offline evaluation (Stage 2).");
    else act = `<div class="notice good">${I.check}<div><b>Registered.</b> v2 holds <code>@challenger</code>${stageIs("promoted") ? " (now promoted to champion)" : ""}.</div></div>`;
    region("s3-act", act);
    region("s3-reg", registryTable());
  },
};

function trafficForm(real, simulated) {
  return `<div class="grid g2" style="gap:12px">
      <label class="field">Real requests <span class="hint">real Groq calls through the app</span><input class="input" type="number" min="0" max="50" id="tr-real" value="${real}"></label>
      <label class="field">Simulated requests <span class="hint">no LLM calls · labelled simulated</span><input class="input" type="number" min="0" max="5000" id="tr-sim" value="${simulated}"></label></div>
    <button class="btn primary" data-act="traffic">${I.send}Send traffic</button>`;
}

PAGES.s4 = {
  render: () => `${head({ n: 4, title: "Shadow deployment", lead: "v2 silently answers a copy of real traffic. Customers only ever see v1. The judge compares both answers side by side." })}
    ${how(EX.s4)}
    <section class="card"><div class="card-title">${I.eye}Control</div><div id="s4-act"></div><div id="s4-job" style="margin-top:12px"></div></section>
    <div id="s4-gate"></div><div id="s4-stats"></div><div id="s4-review"></div><div id="s4-pairs"></div>`,
  async refresh() {
    const sh = S.policy.shadow, roles = S.policy.approvals.traffic_change;
    let act;
    if (stageIs("challenger_registered", "shadow_failed")) {
      act = `${acting(roles)}<button class="btn primary" data-act="startShadow">${I.eye}Approve: start shadow mirroring</button>`;
    } else if (stageIs("shadow")) {
      act = `${trafficForm(sh.real_requests, sh.simulated_requests)}
        <hr class="sep"><div class="row between"><div class="muted small">Gate: ≥ ${sh.min_pairs} judged pairs · win+tie ≥ ${pct(sh.min_win_tie_rate, 0)} · critical violations ≤ ${sh.max_critical_violations} · errors ≤ ${pct(sh.max_error_rate, 0)}</div>
        <div class="actions"><button class="btn" data-act="startShadow">${I.rollback}Restart (new window)</button><button class="btn primary" data-act="shadowGate">${I.shield}Check shadow gate</button></div></div>`;
    } else if (curIndex() < 4) {
      act = disabledNote("Requires a registered <b>@challenger</b> (Stage 3).");
    } else {
      act = `<div class="notice good">${I.check}<div><b>Shadow gate passed.</b> Mirroring is off; canary is a separate approval.</div></div>`;
    }
    region("s4-act", act);
    if (stageIs("shadow")) await jobsRegion("s4-job", "replay"); else region("s4-job", "");
    const d = await api("/api/shadow");
    region("s4-gate", memo.s4gate ? `${gateBanner(memo.s4gate.passed, "Shadow gate")}<section class="card">${checksTable(memo.s4gate.checks)}</section>` : "");
    const st = d.stats;
    if (!st) { region("s4-stats", ""); region("s4-review", ""); region("s4-pairs", ""); return; }
    region("s4-stats", `<div class="grid g4">
        <div class="card stat"><div class="label">Pairs</div><div class="value">${st.pairs}</div><div class="foot">${st.real_pairs ?? 0} real · ${st.simulated_pairs ?? 0} simulated</div></div>
        <div class="card stat"><div class="label">Judged</div><div class="value">${st.judged}</div><div class="foot">${st.real_judged ?? 0} by the real LLM judge</div></div>
        <div class="card stat"><div class="label">Critical violations</div><div class="value">${st.critical_violations}</div><div class="foot">${st.critical_overturned ?? 0} overturned by a human</div></div>
        <div class="card stat"><div class="label">Challenger errors</div><div class="value">${pct(st.error_rate)}</div><div class="foot">missing or failed mirrors</div></div></div>
      <div class="grid g2">
        <section class="card"><div class="card-title">${I.chart}Pairwise verdicts<span class="sub">win + tie ${pct(st.win_tie_rate, 0)}</span></div>${verdictBar(st)}</section>
        <section class="card"><div class="card-title">${I.pulse}Side-by-side cost of serving</div><div class="kv">
          <div><div class="k">v1 latency</div><div class="v">${ms(st.champion_latency_ms)}</div></div><div><div class="k">v2 latency</div><div class="v">${ms(st.challenger_latency_ms)}</div></div>
          <div><div class="k">v1 cost / request</div><div class="v" style="font-size:15px">${usd(st.champion_cost_usd)}</div></div><div><div class="k">v2 cost / request</div><div class="v" style="font-size:15px">${usd(st.challenger_cost_usd)}</div></div></div>
          <div class="muted small" style="margin-top:10px">v2's latency never reaches the customer: the mirrored call runs in the background.</div></section></div>`);
    const flagged = d.flagged;
    region("s4-review", flagged.length ? `<section class="card"><div class="card-title">${I.alert}Human review of critical violations<span class="sub">each unreviewed flag blocks the gate</span></div>
      ${flagged.map((f) => `<div class="card flat" style="margin-bottom:10px"><div class="row between"><b>Pair ${f.id} ${srcPill(f.simulated)}</b>
          ${f.review_decision ? `<span class="pill ${f.review_decision === "overturned" ? "pass" : "fail"}">${esc(f.review_decision)} by ${esc(f.reviewed_by)}</span>` : '<span class="pill warn">NOT REVIEWED</span>'}</div>
        <p class="small" style="margin:8px 0"><b>Customer:</b> ${esc(f.prompt)}</p><p class="small"><b>Judge:</b> ${esc(f.verdict_reason)}</p>
        <div class="answer small">${mdSafe(f.challenger_response)}</div>
        ${f.review_decision ? "" : `${acting(S.policy.approvals.violation_review)}<label class="field">Review reason<input class="input" id="rv-${f.id}" placeholder="e.g. Answer says a code will be sent; it does not ask for one."></label>
          <div class="actions"><button class="btn danger" data-act="review" data-id="${f.id}" data-confirm="1">${I.x}Confirm violation</button>
          <button class="btn" data-act="review" data-id="${f.id}" data-confirm="0">${I.check}Overturn: judge was wrong</button></div>`}</div>`).join("")}</section>` : "");
    region("s4-pairs", `<section class="card"><div class="card-title">${I.eye}Pairs in this window<span class="sub">real pairs first · showing ${d.pairs.length}</span></div>
      <div class="table-wrap"><table><thead><tr><th>Source</th><th>Intent</th><th>Customer message</th><th>Verdict</th><th>v2 violation</th><th>Judge reason</th></tr></thead><tbody>
      ${d.pairs.map((p) => `<tr><td>${srcPill(p.simulated)}</td><td class="small">${esc(p.intent)}</td><td><span class="clip" data-tip="${esc(p.prompt)}">${esc(p.prompt)}</span></td>
        <td>${p.challenger_error ? '<span class="pill fail">error</span>' : p.verdict ? `<span class="tag-v ${p.verdict === "challenger" ? "v2" : p.verdict === "champion" ? "v1" : ""}">${p.verdict === "challenger" ? "v2" : p.verdict === "champion" ? "v1" : "tie"}</span>` : '<span class="pill neutral">judging…</span>'}</td>
        <td>${p.challenger_violation ? `<span class="pill ${p.challenger_violation === "critical" ? "fail" : p.challenger_violation === "minor" ? "warn" : "neutral"}">${esc(p.challenger_violation)}</span>` : "–"}</td>
        <td><span class="clip small" data-tip="${esc(p.verdict_reason || p.challenger_error || "")}">${esc(p.verdict_reason || p.challenger_error || "")}</span></td></tr>`).join("")}</tbody></table></div></section>`);
  },
};

function livePage(canary) {
  return {
    render: () => `${head(canary
        ? { n: 5, title: "Canary deployment", lead: "A small slice of production traffic goes to v2 for real routing, while live metrics are watched and the system stands ready to roll back." }
        : { n: 6, title: "Gradual rollout", lead: "Exposure grows in pre-agreed steps (25% → 50% → 100%). Each step has the same gate and the same automatic rollback." })}
      ${how(canary ? EX.s5 : EX.s6)}
      <div id="lv-banner"></div>
      <section class="card"><div class="card-title">${I.route}Control</div><div id="lv-act"></div><div id="lv-job" style="margin-top:12px"></div></section>
      <div id="lv-live"></div><div id="lv-hist"></div>`,
    async refresh() {
      const lc = S.lifecycle, pol = S.policy, roles = pol.approvals.traffic_change;
      const base = lc.stage.replace("_passed", "");
      const mine = canary ? base === "canary" : base.startsWith("rollout_");
      region("lv-banner", stageIs("rolled_back") ? `<div class="notice bad" style="margin-bottom:16px">${I.rollback}<div><b>Rolled back from ${esc(titleCase(lc.rolled_back_from || ""))}.</b> ${esc(lc.rollback_reason || "")}. Production is 100% ${esc(lc.champion || "v1")}. See the incident in the Audit log.</div></div>` : "");
      let act;
      if (canary && stageIs("shadow_passed", "rolled_back")) {
        act = `${acting(roles)}<button class="btn primary" data-act="startCanary">${I.route}Approve: send ${pol.canary.weight_percent}% of traffic to v2</button>`;
      } else if (!canary && stageIs("canary_passed", "rollout_25_passed", "rollout_50_passed")) {
        const nxt = pol.rollout.steps.find((s) => s > lc.v2_weight);
        act = `${acting(roles)}<button class="btn primary" data-act="nextStep">${I.route}Approve: advance to ${nxt}% v2</button>`;
      } else if (mine) {
        const k = String(lc.v2_weight);
        const [real, sim] = canary ? [pol.canary.real_requests, pol.canary.simulated_requests]
          : [pol.rollout.real_requests[k] ?? 0, pol.rollout.simulated_requests[k] ?? 200];
        act = `${lc.stage.endsWith("_passed") ? `<div class="notice good" style="margin-bottom:14px">${I.check}<div><b>${base === "canary" ? "Canary" : `Rollout ${lc.v2_weight}%`} gate passed.</b> Monitoring continues at this step; ${canary ? "advance from the Gradual rollout page." : stageIs("rollout_100_passed") ? "promote from Stage 7." : "approve the next step below when ready."}</div></div>` : ""}
          ${lc.stage.endsWith("_passed") ? "" : trafficForm(real, sim)}
          <hr class="sep"><div class="actions"><button class="btn primary" data-act="liveGate">${I.shield}Check gate now</button>
          <button class="btn danger" data-act="rollback">${I.rollback}Manual rollback to 100% ${esc(lc.champion || "v1")}</button></div>`;
        if (!canary && lc.stage.endsWith("_passed") && !stageIs("rollout_100_passed")) {
          const nxt = pol.rollout.steps.find((s) => s > lc.v2_weight);
          act = `${acting(roles)}<button class="btn primary" data-act="nextStep">${I.route}Approve: advance to ${nxt}% v2</button><hr class="sep">` + act;
        }
      } else if (!canary && stageIs("promoted")) {
        act = `<div class="notice good">${I.check}<div><b>Rollout complete.</b> v2 serves 100% and has been promoted.</div></div>`;
      } else {
        act = disabledNote(canary ? (curIndex() > 5 ? "Canary completed. Continue on the Gradual rollout page." : "Requires a passed <b>shadow gate</b> (Stage 4).")
          : "Requires a passed <b>canary</b> (Stage 5).");
      }
      region("lv-act", act);
      if (mine && !lc.stage.endsWith("_passed")) await jobsRegion("lv-job", "replay"); else region("lv-job", "");
      const d = await api("/api/live");
      if (!mine) { region("lv-live", ""); } else {
        const g = pol.live_gate;
        const vcard = (v) => {
          const s = d.stats[v];
          return `<section class="card version-card"><h4>${vtag(v)} ${v === (lc.champion || "v1") ? "champion" : "challenger"}</h4><div class="kv">
            <div><div class="k">Requests</div><div class="v">${s.requests}</div><div class="small muted">${s.real} real · ${s.simulated} sim</div></div>
            <div><div class="k">Error rate</div><div class="v">${pct(s.error_rate)}</div></div>
            <div><div class="k">p95 latency</div><div class="v" style="font-size:16px">${ms(s.p95_latency_ms)}</div></div>
            <div><div class="k">Quality</div><div class="v">${f2(s.quality)} <small>n=${s.judged}</small></div></div>
            <div><div class="k">Cost / request</div><div class="v" style="font-size:14px">${usd(s.cost_per_request_usd)}</div></div></div></section>`;
        };
        const decided = lc.stage.endsWith("_passed") ? true : d.enough ? d.checks.every((c) => c.passed) : null;
        region("lv-live", `<section class="card"><div class="card-title">${I.route}Live split · window <code>${esc(d.window)}</code></div>${splitBar(S.weights, true)}
            <div class="split-labels"><span>${vtag("v1")} ${S.weights.v1}%</span><span>${vtag("v2")} ${S.weights.v2}%</span></div></section>
          <div class="grid g2">${vcard("v1")}${vcard("v2")}</div>
          ${gateBanner(memo.lvgate ? memo.lvgate.passed : decided, `${base === "canary" ? "Canary" : `Rollout ${lc.v2_weight}%`} gate`, `Live preview of the gate the worker re-checks every ${g.auto_check_interval_seconds} s${d.enough ? "" : `; needs ≥ ${g.min_challenger_requests} challenger requests and ≥ ${g.min_judged_samples} judged samples`}`)}
          <section class="card"><div class="card-title">${I.shield}Gate checks</div>${checksTable(memo.lvgate?.checks || d.checks)}</section>`);
      }
      {
        region("lv-hist", d.history.length ? `<section class="card"><div class="card-title">${I.clock}Gate history</div><div class="table-wrap"><table>
          <thead><tr><th>Time</th><th>Stage</th><th>Result</th><th>Failed checks</th><th>Policy</th></tr></thead><tbody>
          ${d.history.map((h) => `<tr><td class="small">${when(h.ts)}</td><td>${esc(titleCase(h.stage))}</td><td>${pill(h.passed)}</td>
            <td class="small">${esc(h.checks.filter((c) => !c.passed).map((c) => c.check).join(", ") || "–")}</td><td class="mono small">${esc(h.policy_version)}</td></tr>`).join("")}</tbody></table></div></section>` : "");
      }
    },
  };
}
PAGES.s5 = livePage(true);
PAGES.s6 = livePage(false);

PAGES.s7 = {
  render: () => `${head({ n: 7, title: "Promotion, retirement & monitoring", lead: "Make it official, keep the old version for rollback, generate the report from records, and keep watching for drift." })}
    ${how(EX.s7)}
    <div class="grid g2">
      <section class="card"><div class="card-title">${I.trophy}Promotion</div><div id="s7-act"></div></section>
      <section class="card"><div class="card-title">${I.pulse}Continuous governance · drift check</div>
        <p class="muted" style="margin-top:-6px">Re-evaluates the current champion and compares it with its reference evaluation (allowed drop per metric: <span id="s7-drop"></span>).</p>
        ${acting()}<button class="btn primary" data-act="drift">${I.play}Run drift check now</button><div id="s7-job" style="margin-top:12px"></div><div id="s7-drift" style="margin-top:12px"></div></section>
    </div>
    <section class="card"><div class="card-title">${I.tag}Model Registry · <code>nova-assist</code></div><div id="s7-reg"></div></section>
    <section class="card"><div class="card-title">${I.doc}Governance report<span class="sub">generated purely from records · saved to reports/ and MLflow</span></div>
      <button class="btn primary" data-act="report">${I.doc}Generate governance report</button><div id="s7-report" style="margin-top:16px"></div></section>`,
  async refresh() {
    let act;
    if (stageIs("rollout_100_passed")) act = `${acting(S.policy.approvals.promotion)}<button class="btn primary" data-act="promote">${I.trophy}Approve: promote v2 to @champion, retire v1</button>`;
    else if (stageIs("promoted")) act = `<div class="notice good">${I.check}<div><b>v2 is @champion.</b> v1 is tagged <code>retired</code> with alias <code>@retired</code>, kept for rollback, never deleted.</div></div>`;
    else act = disabledNote(`Requires a passed <b>100% rollout gate</b>. Current stage: ${esc(titleCase(S.lifecycle.stage))}.`);
    region("s7-act", act);
    region("s7-reg", registryTable());
    await jobsRegion("s7-job", "drift");
    const d = await api("/api/drift");
    region("s7-drop", String(d.max_drop));
    region("s7-drift", d.last ? `${gateBanner(d.last.passed, "Drift check", when(d.last.ts) + (d.drift_shift ? ` · simulated drift_shift ${d.drift_shift}` : ""))}${checksTable(d.last.checks)}` : "");
  },
};

PAGES.audit = {
  render: () => `${head({ eyebrow: "Records", title: "Audit log", lead: "Append-only and hash-chained: who did what, when, why, with what evidence and decision." })}
    <div class="grid g2">
      <section class="card"><div class="card-title">${I.lock}Integrity</div><div id="au-verify"></div></section>
      <section class="card"><div class="card-title">${I.alert}Prove it</div>
        <p class="muted" style="margin-top:-6px">Try to rewrite history: change the decision on entry #1. Postgres triggers block every UPDATE, DELETE and TRUNCATE.</p>
        <button class="btn danger" data-act="tamper">${I.x}Try to edit history</button><div id="au-tamper" style="margin-top:12px"></div></section>
    </div>
    <section class="card"><div class="card-title">${I.clock}Entries<span class="sub"><label class="check-line" style="margin:0"><input type="checkbox" id="au-since" checked> only since the last demo reset</label></span></div><div id="au-table"></div></section>`,
  async refresh() {
    const d = await api(`/api/audit?since_reset=${$("#au-since")?.checked !== false}`);
    region("au-verify", d.intact
      ? `<div class="notice good">${I.check}<div><b>Hash chain INTACT</b> across all ${d.count} entries.<div class="small">Each entry's hash covers the previous entry's hash, so editing any past entry breaks every later one.</div></div></div>`
      : `<div class="notice bad">${I.x}<div><b>Hash chain BROKEN</b> at entry #${d.first_bad}.</div></div>`);
    region("au-table", `<div class="table-wrap"><table><thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Stage</th><th>Action</th><th>Decision</th><th>Details</th><th>Hash</th></tr></thead><tbody>
      ${d.rows.map((r) => {
        const dec = r.decision ? `<span class="pill ${/FAIL|REJECT|ROLLED/.test(r.decision) ? "fail" : /PASS|APPROVED|overturned/i.test(r.decision) ? "pass" : "neutral"}">${esc(r.decision)}</span>` : "";
        const det = JSON.stringify(r.details);
        return `<tr><td class="mono">${r.id}</td><td class="small" style="white-space:nowrap">${when(r.ts)}</td><td class="small">${esc(r.actor)}</td>
          <td class="small">${esc(titleCase(r.stage))}</td><td><b class="small">${esc(titleCase(r.action))}</b></td><td>${dec}</td>
          <td><span class="clip small mono" data-tip="${esc(det.slice(0, 600))}">${esc(det)}</span></td><td class="hash">${esc(r.hash.slice(0, 10))}</td></tr>`;
      }).join("")}</tbody></table></div>`);
  },
};

PAGES.policy = {
  render: () => `${head({ eyebrow: "Records", title: "Governance policy", lead: "Every gate threshold lives in <code>governance/policy.yaml</code>. Changing it is a governed action: the role is checked, the version must change, and the diff goes to the audit log." })}
    <div class="notice info" style="margin-bottom:16px">${I.info}<div><b>Rollback demo.</b> While a canary or rollout step is live, change <code>max_p95_latency_ratio: 1.5</code> to <code>0.5</code>, bump <code>version</code>, give a reason and save. Within 15 s the worker re-checks real metrics against the stricter rule and rolls back automatically.</div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)">
      <section class="card"><div class="card-title">${I.doc}policy.yaml<span class="sub" id="po-fp"></span></div><textarea class="input code" id="po-text" spellcheck="false"></textarea></section>
      <section class="card"><div class="card-title">${I.shield}Save a new version</div><div id="po-acting"></div>
        <label class="field">Reason for the change<textarea class="input" id="po-reason" placeholder="e.g. Board tightens the latency budget for the rollback demonstration"></textarea></label>
        <div class="actions"><button class="btn primary" data-act="savePolicy">${I.shield}Save policy version</button><button class="btn" data-act="reloadPolicy">Discard edits</button></div>
        <div id="po-diff" style="margin-top:14px"></div></section>
    </div>`,
  async refresh() {
    const d = await api("/api/policy");
    if (!memo.policyLoaded) { $("#po-text").value = d.text; memo.policyLoaded = true; }
    region("po-fp", `fingerprint <code>${esc(d.fingerprint)}</code>`);
    region("po-acting", acting(d.editors));
  },
};

// --------------------------------------------------------------------------- actions
const A = {
  async liveCheck() {
    const r = await post("/api/live-check");
    region("ov-live", `<div class="table-wrap"><table><tbody>${r.map((x) => `<tr><td>${pill(x.ok, "OK", "Error")}</td><td class="mono">${x.route}</td>
      <td class="small">${x.ok ? `${x.latency_ms} ms` : esc(x.error)}</td></tr>`).join("")}</tbody></table></div>`);
  },
  async askProd() {
    const d = await api("/api/chat", { method: "POST", body: { message: $("#s0-q").value } });
    region("s0-answer", `<div class="answer">${mdSafe(d.answer)}</div><div class="answer-meta">answered by ${vtag(d.model_version)} <span class="pill real">real Groq call</span><span class="mono">${esc(d.request_id)}</span></div>`);
  },
  async reset() {
    if (!$("#s0-confirm").checked) throw new Error("Tick the confirmation box first.");
    await post("/api/reset"); Object.keys(memo).forEach((k) => delete memo[k]); toast("Reset to Stage 0.");
  },
  async submitProposal() { await post("/api/proposal/submit"); toast("Proposal submitted to the board."); },
  choice(el) { el.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === el)); },
  async decide() {
    const approve = $("#s1-choice .on").dataset.v === "approve";
    await post("/api/proposal/decide", { approve, comment: $("#s1-comment").value });
    toast(`Decision recorded: ${approve ? "APPROVED" : "REJECTED"}.`);
  },
  async runEval() { await post("/api/jobs", { kind: "offline_eval", params: {} }); toast("Evaluation queued."); },
  s2metric(el) { memo.s2metric = el.dataset.v; memo.s2sig = null; },
  async register() { const r = await post("/api/register"); toast(`Registered as registry version ${r.version} (@challenger).`); },
  async startShadow() { memo.s4gate = null; await post("/api/shadow/start"); toast("Shadow mirroring is on."); },
  async traffic() {
    await post("/api/jobs", { kind: "replay", params: { count: +$("#tr-real").value || 0, simulated: +$("#tr-sim").value || 0 } });
    memo.lvgate = null; toast("Traffic queued.");
  },
  async shadowGate() { memo.s4gate = await post("/api/shadow/gate"); toast(`Shadow gate: ${memo.s4gate.passed ? "PASS" : "FAIL"}`, memo.s4gate.passed ? "good" : "bad"); },
  async review(el) {
    await post("/api/shadow/review", { pair_id: +el.dataset.id, confirm: el.dataset.confirm === "1", note: $(`#rv-${el.dataset.id}`).value });
    toast("Review recorded in the audit log.");
  },
  async startCanary() { memo.lvgate = null; await post("/api/canary/start"); toast("Canary started."); },
  async nextStep() { memo.lvgate = null; const r = await post("/api/rollout/next"); toast(`Traffic now v1 ${r.weights.v1}% / v2 ${r.weights.v2}%.`); },
  async liveGate() {
    const r = await post("/api/live/gate"); memo.lvgate = r.passed == null ? null : r;
    toast(r.passed == null ? "Not enough data yet: send more traffic." : `Gate: ${r.passed ? "PASS" : "FAIL (rolled back)"}`, r.passed === false ? "bad" : "good");
  },
  async rollback() { memo.lvgate = null; await post("/api/rollback"); toast("Rolled back to 100% champion.", "bad"); },
  async promote() { const r = await post("/api/promote"); toast(`v2 promoted: registry version ${r.version} is @champion.`); },
  async drift() { await post("/api/jobs", { kind: "drift", params: {} }); toast("Drift check queued."); },
  async report() {
    const r = await post("/api/report");
    region("s7-report", `<div class="row between" style="margin-bottom:10px"><span class="muted small">Saved as <code>${esc(r.file)}</code></span>
      <a class="btn" download="governance-report.md" href="data:text/markdown;charset=utf-8,${encodeURIComponent(r.markdown)}">${I.doc}Download Markdown</a></div>
      <div class="card flat md">${DOMPurify.sanitize(marked.parse(r.markdown))}</div>`);
  },
  async tamper() {
    const r = await post("/api/audit/tamper");
    region("au-tamper", `<div class="notice ${r.blocked ? "good" : "bad"}">${r.blocked ? I.check : I.x}<div><b>${r.blocked ? "Postgres refused the edit." : "Edit succeeded!"}</b><div class="small mono">${esc(r.message)}</div></div></div>`);
  },
  async savePolicy() {
    const r = await post("/api/policy", { text: $("#po-text").value, reason: $("#po-reason").value });
    region("po-diff", `<div class="notice good">${I.check}<div><b>Saved.</b> New fingerprint <code>${esc(r.fingerprint)}</code></div></div><pre class="yaml" style="margin-top:10px">${esc(r.diff)}</pre>`);
    $("#po-reason").value = ""; toast("Policy saved and audited.");
  },
  async reloadPolicy() { memo.policyLoaded = false; },
};

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !A[el.dataset.act]) return;
  e.preventDefault();
  if (el.classList.contains("busy")) return;
  el.classList.add("busy");
  try { await A[el.dataset.act](el); await tick(); }
  catch (err) { toast(`<b>Refused.</b> ${esc(err.message)}`, "bad"); }
  finally { el.classList.remove("busy"); }
});

// tooltips for any element with data-tip
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest?.("[data-tip]"), tip = $("#tooltip");
  if (!t) { tip.hidden = true; return; }
  tip.innerHTML = t.dataset.tip; tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 10), y = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 10);
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
});

// --------------------------------------------------------------------------- boot + polling
async function tick() {
  try {
    S = await api("/api/state");
    $("#sys-dot").className = "dot ok"; $("#sys-text").textContent = `Policy ${S.policy_fingerprint}`;
    renderChrome();
    if (page?.refresh) await page.refresh();
  } catch (err) {
    $("#sys-dot").className = "dot bad"; $("#sys-text").textContent = "Stack not reachable";
    console.error(err);
  }
}

function route() {
  const id = location.hash.replace("#/", "") || "overview";
  page = PAGES[id] || PAGES.overview;
  const meta = PAGES_META.find((p) => p.id === id) || PAGES_META[0];
  $("#crumb").textContent = meta.n != null ? `Stage ${meta.n} · ${meta.label}` : meta.label;
  if (id !== "policy") memo.policyLoaded = false;
  $("#view").innerHTML = page.render();
  $("#sidebar").classList.remove("open");
  window.scrollTo(0, 0);
  if (S) { renderChrome(); page.refresh?.().catch(console.error); }
}

function boot() {
  let name = "Instructor", role = "Model Risk Officer";
  try { name = localStorage.getItem("who-name") ?? name; role = localStorage.getItem("who-role") ?? role; } catch {}
  const roles = ["Product Owner", "ML Platform Lead", "Model Risk Officer", "Governance Board", "Student"];
  $("#who-role").innerHTML = roles.map((r) => `<option ${r === role ? "selected" : ""}>${r}</option>`).join("");
  $("#who-name").value = name;
  const save = () => { try { localStorage.setItem("who-name", $("#who-name").value); localStorage.setItem("who-role", $("#who-role").value); } catch {} page?.refresh?.(); };
  $("#who-name").addEventListener("change", save); $("#who-role").addEventListener("change", save);
  $("#menu-btn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  window.addEventListener("hashchange", route);
  route();
  tick();
  clearInterval(pageTimer);
  pageTimer = setInterval(tick, 4000);
}
boot();
