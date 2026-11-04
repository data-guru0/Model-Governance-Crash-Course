/* NovaBank Governance Console: the model-governance story as a working console. No build step.
   Each page = one chapter of the story. A page renders a static skeleton once; live "regions"
   refresh every few seconds and only re-paint when their HTML changes (form inputs survive). */
"use strict";

// --------------------------------------------------------------------------- utilities
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f2 = (v) => (v == null ? "–" : Number(v).toFixed(2));
const f3 = (v) => (v == null ? "–" : Number(v).toFixed(3));
const pct = (v, d = 1) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);
const ms = (v) => (v == null ? "–" : `${Math.round(v).toLocaleString()} ms`);
const usd = (v, d = 6) => (v == null ? "–" : `$${Number(v).toFixed(d)}`);
const num = (v) => (v == null ? "–" : Number(v).toLocaleString());
const when = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" }) : "–");
const day = (iso) => new Date(iso + "T00:00:00").toLocaleDateString([], { day: "numeric", month: "short" });
const titleCase = (s) => String(s).replaceAll("_", " ");
const mdSafe = (t) => DOMPurify.sanitize(marked.parse(String(t ?? "")));

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
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/></svg>',
};

const pill = (ok, yes = "PASS", no = "FAIL") =>
  ok == null ? `<span class="pill neutral">${I.clock}pending</span>`
    : ok ? `<span class="pill pass">${I.check}${yes}</span>` : `<span class="pill fail">${I.x}${no}</span>`;
const srcPill = (simulated) => (simulated ? '<span class="pill sim">simulated</span>' : '<span class="pill real">real</span>');

let S = null;          // global state from /api/state
let STORY = null;      // calendar from /api/story
let page = null;
let pageTimer = null;
const memo = {};

const codename = (v) => S?.codenames?.[v] || v;
const vtag = (v, withName = true) => (v ? `<span class="tag-v ${esc(v)}">${esc(v)}${withName && S?.codenames?.[v] ? ` · ${esc(codename(v))}` : ""}</span>` : "–");
const champ = () => S?.lifecycle?.champion || "v1";
const chall = () => S?.lifecycle?.challenger || S?.selected || null;

function who() { return { name: $("#who-name").value.trim() || "anonymous", role: $("#who-role").value }; }

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
const PROGRESS = {
  not_initialised: -1, baseline: 0, proposal_submitted: 1, proposal_approved: 1.5, proposal_rejected: 1,
  offline_evaluating: 2, offline_passed: 2.5, offline_failed: 2, challenger_registered: 3,
  shadow: 4, shadow_passed: 4.9, shadow_failed: 4, canary: 5, canary_passed: 5.9, rolled_back: 5,
  rollout_25: 6.0, rollout_25_passed: 6.19, rollout_50: 6.2, rollout_50_passed: 6.39, rollout_100: 6.4, rollout_100_passed: 6.99, promoted: 7,
};
const progress = () => PROGRESS[S?.lifecycle?.stage] ?? 0;
const curIndex = () => Math.floor(progress());
const stageIs = (...names) => names.includes(S?.lifecycle?.stage);

const PAGES_META = [
  { id: "overview", label: "The story", section: "NovaBank" },
  { id: "s0", n: 0, label: "Where we start", section: "Chapters" },
  { id: "s1", n: 1, label: "The proposal" },
  { id: "s2", n: 2, label: "The exam" },
  { id: "s3", n: 3, label: "Registration" },
  { id: "s4", n: 4, label: "Shadow week" },
  { id: "s5", n: 5, label: "Canary week" },
  { id: "s6", n: 6, label: "Weekly rollout" },
  { id: "s7", n: 7, label: "Promotion" },
  { id: "audit", label: "Audit log", section: "Records" },
  { id: "policy", label: "Governance policy" },
  { id: "check", label: "System check" },
];

function renderNav() {
  const ci = curIndex();
  const active = location.hash.replace("#/", "") || "overview";
  let html = "", inRail = false;
  for (const p of PAGES_META) {
    if (p.section) {
      if (inRail) { html += "</div>"; inRail = false; }
      html += `<div class="nav-section">${p.section}</div>`;
      if (p.section === "Chapters") { html += '<div class="nav-rail">'; inRail = true; }
    }
    let cls = "nav-item" + (p.id === active ? " active" : "");
    let mark;
    if (p.n != null) {
      const done = p.n < ci || (p.n === 7 && stageIs("promoted"));
      cls += done ? " done" : p.n === ci ? " current" : "";
      mark = `<span class="step">${done ? I.check : p.n}</span>`;
    } else {
      mark = `<span class="step">${{ overview: I.book, audit: I.lock, policy: I.doc, check: I.pulse }[p.id]}</span>`;
    }
    html += `<a class="${cls}" href="#/${p.id}">${mark}<span>${p.label}</span></a>`;
    if (p.id === "s7" && inRail) { html += "</div>"; inRail = false; }
  }
  region("nav", html);
}

function splitBar(w, big = false) {
  const parts = Object.entries(w || {}).filter(([, v]) => v > 0);
  return `<div class="split ${big ? "big" : "mini"}" role="img" aria-label="Traffic split ${parts.map(([k, v]) => `${k} ${v}%`).join(", ")}">
    ${parts.map(([k, v]) => `<div class="${esc(k)}" style="width:${v}%" data-tip="<b>${esc(k)} · ${esc(codename(k))}</b> · ${v}% of production traffic"></div>`).join("")}</div>`;
}

function renderChrome() {
  renderNav();
  const lc = S.lifecycle;
  $("#sim-badge").hidden = !S.simulation;
  const w = S.weights;
  region("traffic-pill", `<span>Champion ${vtag(champ())}</span>${splitBar(w)}
    <span class="mono">${Object.entries(w).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}%`).join(" · ")}</span>
    ${lc.shadow ? '<span class="pill brand">shadow on</span>' : ""}`);
}

// --------------------------------------------------------------------------- story calendar
function chapterState(key) {
  const p = progress(), rb = stageIs("rolled_back");
  const ranges = { proposal: [1, 3.99], shadow: [4, 4.99], canary: [5, 5.99], rollout_25: [6, 6.19],
                   rollout_50: [6.2, 6.39], rollout_100: [6.4, 6.99], promotion: [7, 7] };
  const [lo, hi] = ranges[key];
  if (rb && key === "canary") return "alert current";
  if (key === "promotion") return p >= 7 ? "done" : "";
  if (p > hi) return "done";
  if (p >= lo) return "current";
  return "";
}

function calendar() {
  if (!STORY) return "";
  return `<nav class="calendar" aria-label="Story calendar">${STORY.chapters.map((c) => {
    const st = chapterState(c.key);
    const flag = st.includes("alert") ? " · rolled back" : st.includes("done") ? " ✓" : st.includes("current") ? " · now" : "";
    return `<a href="#/${c.pages[0]}" class="${st}"><div class="wk">Week ${c.week}${flag}</div>
      <div class="lb">${esc(c.label)}</div><div class="dt">${day(c.from)} – ${day(c.to)}</div></a>`;
  }).join("")}</nav>`;
}

// --------------------------------------------------------------------------- live architecture diagram
function topology() {
  const lc = S.lifecycle, w = S.weights, c1 = champ(), c2 = chall();
  const shadow = !!lc.shadow, rolled = stageIs("rolled_back");
  const share = c2 ? (w[c2] || 0) : 0;
  const others = Object.keys(S.candidates || {}).filter((v) => v !== c2);
  const W = 980, H = 330, champY = 70, challY = 165, otherY = 262;
  const node = (x, y, w0, h0, title, sub, extra = "", cls = "", color = "") =>
    `<g class="node ${cls}" transform="translate(${x},${y})"><rect width="${w0}" height="${h0}" rx="12" ${color ? `style="stroke:${color}"` : ""}/>
      <text x="14" y="24">${title}</text><text class="sub" x="14" y="42">${sub}</text>${extra}</g>`;
  const dots = (path, n, color, dur = 2.6) => Array.from({ length: n }, (_, i) =>
    `<circle class="dot" r="4.5" fill="${color}"><animateMotion dur="${dur}s" repeatCount="indefinite" begin="${(-i * dur / n).toFixed(2)}s" path="${path}"/></circle>`).join("");
  const branch = (y) => `M 600 165 C 650 165, 650 ${y}, 700 ${y}`;
  let g = `<path class="wire live" d="M 170 165 L 230 165 M 380 165 L 460 165"/>${dots("M 170 165 L 460 165", 4, "var(--text-3)", 2.2)}`;
  const champShare = w[c1] || 0, pc = branch(champY);
  g += `<path class="wire live" d="${pc}" style="stroke:var(--${c1});stroke-width:${2 + champShare / 25}"/>${champShare ? dots(pc, Math.max(1, Math.round(champShare / 20)), `var(--${c1})`) : ""}`;
  g += `<text class="lbl" x="606" y="${champY + 30}">${champShare}%</text>`;
  if (c2) {
    const ph = branch(challY);
    if (shadow) {
      g += `<path class="wire mirror" d="${ph}" style="stroke:var(--${c2})"/>${dots(ph, 4, `var(--${c2})`)}`;
      g += `<text class="lbl" x="606" y="${challY + 26}">copy</text>`;
      g += `<path class="wire mirror" d="M 950 ${challY} C 975 ${challY}, 975 305, 935 305 L 470 305" style="stroke:var(--text-3)"/>`;
      g += `<text class="lbl" x="480" y="297">challenger answers go to the judge, never to the customer</text>`;
    } else if (share > 0) {
      g += `<path class="wire live" d="${ph}" style="stroke:var(--${c2});stroke-width:${2 + share / 25}"/>${dots(ph, Math.max(1, Math.round(share / 20)), `var(--${c2})`)}`;
      g += `<text class="lbl" x="606" y="${challY + 26}">${share}%</text>`;
    } else {
      g += `<path class="wire" d="${ph}" style="stroke-dasharray:3 6"/>`;
    }
  }
  g += node(10, 135, 160, 60, "Customers", `${num(STORY?.weekly_requests)} questions / week`);
  g += node(230, 135, 150, 60, "Nova Assist app", "FastAPI · virtual key");
  g += node(460, 120, 140, 90, "LiteLLM gateway", "route nova-assist",
    `<text class="sub" x="14" y="62">${shadow ? "mirroring ON" : share > 0 ? "weighted split" : "100% one model"}</text><text class="sub" x="14" y="78">fallback → ${esc(c1)}</text>`,
    shadow || share > 0 ? "on" : "");
  g += node(700, champY - 40, 250, 64, `${esc(c1)} · ${esc(codename(c1))}`, `champion · ${esc(S.models[`nova-${c1}`] || "")}`,
    `<text class="badge" x="14" y="58" style="fill:var(--good-ink)">ANSWERS CUSTOMERS</text>`, "on", `var(--${c1})`);
  if (c2) {
    const badge = rolled ? ["ROLLED BACK", "var(--bad-ink)"] : shadow ? ["SHADOW · SILENT", "var(--brand)"]
      : share >= 100 ? ["ANSWERS 100%", "var(--warn-ink)"] : share > 0 ? [`ANSWERS ${share}%`, "var(--warn-ink)"]
      : lc.challenger ? ["REGISTERED · NO TRAFFIC", "var(--text-3)"] : ["SELECTED AT THE EXAM", "var(--text-3)"];
    g += node(700, challY - 32, 250, 64, `${esc(c2)} · ${esc(codename(c2))}`, `challenger · ${esc(S.models[`nova-${c2}`] || "")}`,
      `<text class="badge" x="14" y="58" style="fill:${badge[1]}">${badge[0]}</text>`, shadow || share > 0 ? "on" : "dim", `var(--${c2})`);
  }
  const ghost = lc.retired ? { v: lc.retired, t: "RETIRED · KEPT FOR ROLLBACK" }
    : others.length ? { v: others[0], t: S.candidates[others[0]] ? "PASSED · NOT SELECTED" : "REJECTED AT THE EXAM" } : null;
  if (ghost && !shadow) g += node(700, otherY - 24, 250, 56, `${esc(ghost.v)} · ${esc(codename(ghost.v))}`, ghost.t, "", "dim", `var(--${ghost.v})`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Live architecture: traffic from customers through the app and gateway to the models">${g}</svg>`;
}

// --------------------------------------------------------------------------- shared blocks
function head(meta) {
  return `<div id="cal"></div><div class="page-head"><div>
      ${meta.n != null ? `<div class="eyebrow">Chapter ${meta.n} · ${esc(meta.when || "")}</div>` : `<div class="eyebrow">${esc(meta.eyebrow || "")}</div>`}
      <h1>${meta.title}</h1></div></div>`;
}

function chapter(st) {
  return `<section class="card"><div class="story">
      <div class="story-text"><span class="when">${esc(st.when)}</span><div>${st.story}</div>
        ${st.cast ? `<div class="cast">${st.cast.map(([n, r]) => `<span><i>${n.split(" ").filter((x) => /^[A-Z]/.test(x)).map((x) => x[0]).join("").slice(0, 2)}</i>${esc(n)} · ${esc(r)}</span>`).join("")}</div>` : ""}</div>
      <div><div class="steps-title">What happens when you click</div>
        <ol class="flow">${st.steps.map(([w, t]) => `<li><span class="who">${w}</span><div class="what">${t}</div></li>`).join("")}</ol>
        ${st.real ? `<div class="realsim">${I.flask}<div>${st.real}</div></div>` : ""}</div>
    </div></section>`;
}

const topoCard = (title = "Live architecture") => `<section class="card topo"><div class="card-title">${I.route}${title}<span class="sub">live from the LiteLLM gateway</span></div><div id="topo"></div></section>`;

function acting(roles) {
  const w = who(), ok = !roles || roles.includes(w.role);
  return `<div class="acting">${I.user}Acting as <b>${esc(w.name)}</b> · ${esc(w.role)}
    ${roles ? `· allowed: ${roles.map((r) => `<span class="pill ${r === w.role ? "pass" : "neutral"}">${esc(r)}</span>`).join(" ")}` : ""}
    ${roles && !ok ? '<span class="pill warn">switch role in the top bar</span>' : ""}</div>`;
}

function gateBanner(passed, title, sub = "") {
  const cls = passed == null ? "wait" : passed ? "pass" : "fail";
  const icon = passed == null ? I.clock : passed ? I.check : I.x;
  const word = passed == null ? "waiting for the week's data" : passed ? "PASS" : "FAIL";
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
      <b>Job #${j.id} · ${esc(j.kind === "replay" ? "simulated week" : titleCase(j.kind))}</b> <span class="pill ${cls}">${j.status}</span>
      <div class="small">${esc(j.progress || "")} ${j.error ? `<br>${esc(j.error)}` : ""}</div>
      <div class="small muted">requested by ${esc(j.actor)} · ${when(j.created_at)}</div></div></div>`);
  return rows;
}

const disabledNote = (text) => `<div class="notice">${I.lock}<div>${text}</div></div>`;

// --------------------------------------------------------------------------- charts (inline SVG)
function metricBars(series, thresholds) {
  const metrics = ["answer_relevancy", "helpfulness", "correctness", "policy_compliance", "toxicity_free", "bias_free", "redteam_pass_rate"];
  const W = 560, L = 140, R = 44, barH = 9, gap = 3, plot = W - L - R;
  const rowH = series.length * (barH + gap) + 16;
  const H = metrics.length * rowH + 26;
  const x = (v) => L + Math.max(0, Math.min(1, v)) * plot;
  let g = "";
  [0, 0.25, 0.5, 0.75, 1].forEach((t) => { g += `<line class="grid-line" x1="${x(t)}" x2="${x(t)}" y1="4" y2="${H - 22}"/><text x="${x(t)}" y="${H - 6}" text-anchor="middle">${t}</text>`; });
  metrics.forEach((m, i) => {
    const y = i * rowH + 8, thr = thresholds[m]?.min;
    g += `<text x="${L - 10}" y="${y + rowH / 2 - 2}" text-anchor="end" style="fill:var(--text)">${titleCase(m)}</text>`;
    series.forEach((s, k) => {
      const v = s.overall[m], yy = y + k * (barH + gap);
      if (v != null) g += `<rect x="${L}" y="${yy}" width="${Math.max(2, x(v) - L)}" height="${barH}" rx="4" fill="var(--${s.v})"/><text x="${x(v) + 5}" y="${yy + 8.5}" style="font-size:10.5px">${f2(v)}</text>`;
    });
    if (thr != null) g += `<line class="thr" x1="${x(thr)}" x2="${x(thr)}" y1="${y - 2}" y2="${y + series.length * (barH + gap)}"/>`;
    g += `<rect class="hit" x="0" y="${y - 4}" width="${W}" height="${rowH - 6}" data-tip="<b>${titleCase(m)}</b><br>${series.map((s) => `${s.v} · ${esc(codename(s.v))}: ${f3(s.overall[m])}`).join("<br>")}${thr != null ? `<br>threshold ≥ ${thr}` : ""}"/>`;
  });
  return `<div class="legend">${series.map((s, k) => `<span><i style="background:var(--${s.v})"></i>${s.v} · ${esc(codename(s.v))}${k === 0 ? " (champion)" : ""}</span>`).join("")}<span><i class="tick"></i>gate threshold</span></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Offline metrics per model">${g}</svg>`;
}

function sliceDumbbell(champSlices, challSlices, metric, a, b) {
  const rows = Object.keys(challSlices).map((s) => ({ s, a: champSlices[s]?.[metric], b: challSlices[s]?.[metric], n: challSlices[s]?.n }))
    .filter((r) => r.a != null && r.b != null).sort((p, q) => (p.b - p.a) - (q.b - q.a));
  if (!rows.length) return `<div class="empty">${I.chart}<div>No slices</div></div>`;
  const W = 1060, L = 230, R = 30, rowH = 24, plot = W - L - R;
  const lo = Math.max(0, Math.floor(Math.min(...rows.flatMap((r) => [r.a, r.b])) * 10) / 10);
  const H = rows.length * rowH + 28;
  const x = (v) => L + ((v - lo) / (1 - lo)) * plot;
  let g = "";
  for (let t = lo; t <= 1.0001; t += 0.1) g += `<line class="grid-line" x1="${x(t)}" x2="${x(t)}" y1="2" y2="${H - 22}"/><text x="${x(t)}" y="${H - 6}" text-anchor="middle">${t.toFixed(1)}</text>`;
  rows.forEach((r, i) => {
    const y = i * rowH + 12, worse = r.b < r.a;
    g += `<text x="${L - 12}" y="${y + 4}" text-anchor="end" style="fill:${worse ? "var(--bad-ink)" : "var(--text-2)"}">${esc(titleCase(r.s))}</text>
      <line x1="${x(r.a)}" x2="${x(r.b)}" y1="${y}" y2="${y}" stroke="var(--border-strong)" stroke-width="2"/>
      <circle cx="${x(r.a)}" cy="${y}" r="5" fill="var(--${a})" stroke="var(--surface)" stroke-width="2"/>
      <circle cx="${x(r.b)}" cy="${y}" r="5" fill="var(--${b})" stroke="var(--surface)" stroke-width="2"/>
      <rect class="hit" x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}" data-tip="<b>${esc(titleCase(r.s))}</b> (n=${r.n})<br>${a}: ${f3(r.a)} · ${b}: ${f3(r.b)}<br>Δ ${(r.b - r.a >= 0 ? "+" : "") + (r.b - r.a).toFixed(3)}"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Per-slice ${metric}">${g}</svg>`;
}

function verdictBar(st, c2) {
  const total = (st.challenger_wins || 0) + (st.ties || 0) + (st.champion_wins || 0);
  if (!total) return `<div class="empty">${I.eye}<div>No judged pairs yet</div></div>`;
  const w = (n) => (n / total) * 100;
  return `<div class="split big">
      <div class="${c2}" style="width:${w(st.challenger_wins)}%" data-tip="<b>${c2} better</b> · ${num(st.challenger_wins)} pairs"></div>
      <div class="tie" style="width:${w(st.ties)}%" data-tip="<b>Ties</b> · ${num(st.ties)} pairs"></div>
      <div class="${champ()}" style="width:${w(st.champion_wins)}%" data-tip="<b>${champ()} better</b> · ${num(st.champion_wins)} pairs"></div></div>
    <div class="split-labels"><span>${vtag(c2, false)} better ${num(st.challenger_wins)} (${pct(st.challenger_wins / total, 0)})</span>
      <span><span class="tag-v">tie</span> ${num(st.ties)} (${pct(st.ties / total, 0)})</span>
      <span>${vtag(champ(), false)} better ${num(st.champion_wins)} (${pct(st.champion_wins / total, 0)})</span></div>`;
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function lineChart(rows, key, versions, fmt, title) {
  const W = 300, H = 150, L = 46, R = 12, T = 10, B = 24;
  const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => a - b);
  const vals = rows.filter((r) => versions.includes(r.version)).map((r) => r[key]).filter((v) => v != null).map(Number);
  if (!days.length || !vals.length) return `<div class="m"><h5>${title}</h5><div class="empty small">no data yet</div></div>`;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (key === "error_rate" || key === "requests") lo = 0;
  if (hi === lo) hi = lo + (hi || 1) * 0.1 + 0.001;
  const pad = (hi - lo) * 0.12; hi += pad; if (lo > 0) lo = Math.max(0, lo - pad);
  const x = (d) => L + (days.length === 1 ? (W - L - R) / 2 : (days.indexOf(d) / (days.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let g = "";
  [lo, (lo + hi) / 2, hi].forEach((t) => { g += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" style="font-size:10px">${fmt(t)}</text>`; });
  days.forEach((d) => { g += `<text x="${x(d)}" y="${H - 6}" text-anchor="middle" style="font-size:10px">${DOW[d % 7]}</text>`; });
  versions.forEach((v) => {
    const pts = days.map((d) => rows.find((r) => r.day === d && r.version === v)).filter((r) => r && r[key] != null);
    if (!pts.length) return;
    g += `<polyline fill="none" stroke="var(--${v})" stroke-width="2" stroke-linejoin="round" points="${pts.map((r) => `${x(r.day)},${y(Number(r[key]))}`).join(" ")}"/>`;
    pts.forEach((r) => { g += `<circle cx="${x(r.day)}" cy="${y(Number(r[key]))}" r="4" fill="var(--${v})" stroke="var(--surface)" stroke-width="2"/>
      <circle class="hit" cx="${x(r.day)}" cy="${y(Number(r[key]))}" r="10" data-tip="<b>${v} · ${DOW[r.day % 7]}</b><br>${title}: ${fmt(Number(r[key]))}<br>${num(r.requests)} questions"/>`; });
  });
  return `<div class="m"><h5>${title}</h5><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title} per day">${g}</svg></div>`;
}

function dailyCharts(rows, versions) {
  return `<div class="legend">${versions.map((v) => `<span><i style="background:var(--${v})"></i>${v} · ${esc(codename(v))}</span>`).join("")}<span class="muted">one point per day of the simulated week</span></div>
    <div class="multiples">${lineChart(rows, "requests", versions, (v) => Math.round(v).toLocaleString(), "Questions / day")}
      ${lineChart(rows, "error_rate", versions, (v) => `${(v * 100).toFixed(1)}%`, "Error rate")}
      ${lineChart(rows, "p95_latency_ms", versions, (v) => `${Math.round(v)}`, "p95 latency (ms)")}
      ${lineChart(rows, "quality", versions, (v) => v.toFixed(2), "Judged quality")}</div>`;
}

// --------------------------------------------------------------------------- the story, chapter by chapter
const CH = {
  s0: { when: "Week 0 · before anything changes",
    story: `NovaBank's support chatbot is <b>Nova (v1)</b>, running <code>gpt-oss-20b</code>. It answers about <b>10,000 customer questions a week</b> about cards, loans, transfers and passwords. Before anyone is allowed to change it, the platform team records exactly what is live: which model, which prompt, which settings, through which route.`,
    cast: [["Tomás Okafor", "ML Platform Lead"]],
    steps: [["Worker · on startup", "Registers the bank policy prompt in the <b>MLflow Prompt Registry</b>."],
      ["Worker → MLflow", "Logs v1 as an MLflow model and sets alias <code>@champion</code>."],
      ["Worker → LiteLLM", "Creates least-privilege virtual keys and points route <code>nova-assist</code> 100% at v1."],
      ["You · Try production", "Your question goes customer → app → gateway → v1, exactly like a real customer's."]],
    real: "<b>Real here:</b> \"Try production\" is 1 real Groq call." },
  s1: { when: "Week 1 · Monday",
    story: `Complaints say Nova's answers are <b>too vague</b>, and the fraud team wants <b>fewer unsafe answers</b>. Priya's product team proposes <b>two candidates</b>: <b>Atlas (v2)</b>, a 6× bigger model, and <b>Sentinel (v3)</b>, a safety-tuned model at today's cost. Nothing gets tested until the Model Risk Officer signs off.`,
    cast: [["Priya Raman", "Product Owner"], ["Dr. Amara Celik", "Model Risk Officer"]],
    steps: [["Product owner", "Submits the proposal (<code>proposals/nova-assist-upgrade.yaml</code>) and a model card per candidate. Their SHA-256 hashes go into the audit log."],
      ["Approver", "Only roles in <code>policy.yaml → approvals.proposal</code> can decide, and a written rationale is mandatory."],
      ["Console → audit log + MLflow", "The decision is written to the audit log and as tags on the registered model."]],
    real: "<b>No LLM calls</b> in this chapter." },
  s2: { when: "Week 1 · Tuesday – Thursday",
    story: `Nova, Atlas and Sentinel sit <b>the same exam</b>: 130 real banking questions plus 12 attacks (prompt injection, card numbers, investment advice, fraud). An independent judge from a different model family marks every answer. A candidate must pass <b>every</b> check, and if both pass, the better one wins.`,
    cast: [["Dr. Amara Celik", "Model Risk Officer"]],
    steps: [["Console → Worker", "Queues one evaluation job for the champion and every candidate on identical examples."],
      ["Worker → Gateway → Judge", "DeepEval metrics: answer relevancy, G-Eval helpfulness / correctness / policy compliance, toxicity, bias, red-team refusal."],
      ["Worker → MLflow", "One run per model: params, metrics, datasets, per-example table."],
      ["Gate per candidate", "Absolute thresholds + no safety regression vs the champion + no per-intent slice regression. The best passing candidate is selected."]],
    real: "<b>Real here:</b> each candidate answers 1 question for real and the real judge scores it (4 calls). The other 141 examples per model are <b>simulated</b>." },
  s3: { when: "Week 1 · Friday",
    story: `The winner gets an official identity in the model registry, linked to its exam results, the proposal and its model card. It is now the <b>challenger</b>: allowed to see production traffic next week, not yet to answer customers. A rejected candidate is never registered.`,
    cast: [["Tomás Okafor", "ML Platform Lead"]],
    steps: [["Precondition", "Only after a candidate passed the exam."],
      ["Console → MLflow", "Logs the selected candidate as a new version of <code>nova-assist</code>."],
      ["Lineage tags", "Evaluation run, proposal SHA, model card SHA, approver."],
      ["Alias", "<code>@challenger</code> points at it; <code>@champion</code> still points at v1."]],
    real: "<b>No LLM calls</b> in this chapter." },
  s4: { when: "Week 2 · shadow week",
    story: `For one whole week, <b>every customer question is silently copied</b> to the challenger. Customers still only ever see Nova's answers, so nobody is at risk. The judge compares the challenger's answers side by side with Nova's. On Friday the board reviews the week.`,
    cast: [["Tomás Okafor", "ML Platform Lead"], ["Dr. Amara Celik", "Model Risk Officer"]],
    steps: [["Approve → Gateway", "LiteLLM's <code>silent_model</code> is switched on for the v1 deployment: watch the dashed copy line in the diagram."],
      ["Simulate the week", "Customer questions flow and each is copied. The worker pairs both answers using the request ID LiteLLM logs."],
      ["Worker → Judge", "Pairwise verdict (A/B order randomised) + policy-violation check on the challenger's answer."],
      ["Human review", "A judge-flagged <b>critical</b> violation blocks the gate until a Model Risk Officer confirms or overturns it."],
      ["Friday · gate", "Judged pairs, win+tie rate, zero critical violations, error ceiling."]],
    real: "<b>Real here:</b> 1 question is really copied and really judged (3 calls). The rest of the week (10,000 questions) is <b>simulated</b>." },
  s5: { when: "Week 3 · canary week",
    story: `Now <b>5% of real customers</b> are answered by the challenger; everyone else still gets Nova. The worker watches the challenger every 15 seconds: errors, latency, cost and judged quality. If anything breaches the policy, it <b>rolls back automatically</b>, with no human needed to pull the plug.`,
    cast: [["Tomás Okafor", "ML Platform Lead"]],
    steps: [["Monday · approve → Gateway", "Router weights on <code>nova-assist</code> become 95 / 5. Watch the split in the diagram."],
      ["Simulate the week", "Each question lands on a model by weight; the app tags each answer with the version that produced it."],
      ["Worker · every 15 s", "Recomputes the live gate. PASS completes the week; a breach sets weights back to 100% champion and logs an incident."],
      ["Rollback demo", "On the Policy page, tighten <code>max_p95_latency_ratio</code> to 0.5 and watch the rollback happen."]],
    real: "<b>Real here:</b> 1 question really routed by the gateway weights. <b>10,000 simulated</b> for the week." },
  s6: { when: "Weeks 4 – 6 · one step per week",
    story: `Every Monday the platform lead approves the next step: <b>25% → 50% → 100%</b>. Each step runs for a full week under the same gate as the canary. People approve every increase; the system may only <b>decrease</b> exposure on its own.`,
    cast: [["Tomás Okafor", "ML Platform Lead"]],
    steps: [["Monday · approve", "Weights change for real at the gateway (75/25, then 50/50, then 0/100)."],
      ["Simulate the week", "A full week of traffic at the new split."],
      ["Worker · every 15 s", "Same live gate. At 100% there is no champion traffic, so ratios compare with the champion's canary-week numbers."],
      ["Breach", "Automatic rollback to 100% champion + incident in the audit log."]],
    real: "<b>Real here:</b> 1 real question at 100% (answered by the challenger and judged). <b>10,000 simulated</b> per week." },
  s7: { when: "Week 7 · promotion & beyond",
    story: `Every gate has passed at 100%. The Governance Board makes it official: the challenger becomes <b>@champion</b>. Nova (v1) is <b>retired but kept</b>, one click away if needed. The governance report goes to the board, and from now on a <b>weekly drift check</b> re-examines the champion.`,
    cast: [["Board Chair", "Governance Board"]],
    steps: [["Board → MLflow", "<code>@champion</code> moves to the challenger; v1 gets status <code>retired</code> and alias <code>@retired</code>."],
      ["Gateway", "Production route: 100% new champion."],
      ["Report", "Generated only from records: proposal, exam, shadow, every gate decision, approvals, audit trail."],
      ["Drift check", "Re-evaluates the champion against its reference scores and records a gate decision."]],
    real: "<b>No LLM calls</b> for promotion and report. The drift check is <b>simulated</b>; set <code>simulation.drift_shift: -0.10</code> to make it catch drift." },
};

// --------------------------------------------------------------------------- pages
const PAGES = {};

function registryTable() {
  if (!S.registry.length) return `<div class="empty">Not registered yet</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Registry version</th><th>Aliases</th><th>Model</th><th>Status</th><th>Provider model</th><th>Evaluation run</th></tr></thead><tbody>
    ${S.registry.slice().reverse().map((v) => `<tr><td><b>v${v.version}</b></td>
      <td>${v.aliases.map((a) => `<span class="pill ${a === "champion" ? "pass" : a === "challenger" ? "brand" : "neutral"}">@${esc(a)}</span>`).join(" ") || "–"}</td>
      <td>${vtag(v.tags.nova_version)}</td><td>${esc(v.tags.status || "–")}</td><td class="mono">${esc(v.tags.provider_model)}</td>
      <td class="mono small">${esc((v.tags.eval_run_id || "–").slice(0, 12))}</td></tr>`).join("")}</tbody></table></div>`;
}

PAGES.overview = {
  render: () => `${head({ eyebrow: "A model-governance story", title: "NovaBank is changing its chatbot's model" })}
    <section class="card"><div class="story"><div class="story-text">
      <span class="when">The story</span>
      <div>NovaBank's chatbot <b>Nova (v1)</b> answers customers every day. The product team thinks a different model would do better, and proposes two: <b>Atlas</b> and <b>Sentinel</b>.
      The governance board's answer: <i>"Prove it, roll it out safely, and keep an audit trail."</i></div>
      <div style="margin-top:10px">Over seven weeks you will take that change through a written <b>proposal</b>, an <b>exam</b> for both candidates, a <b>shadow week</b>, a <b>canary week</b> and a <b>weekly rollout</b>, ending in a <b>promotion</b> or a <b>rollback</b>. Every click is a real governed action. Open Chapter 0 to begin.</div>
      <div class="actions" style="margin-top:14px"><a class="btn primary" href="#/s0">${I.book}Start the story</a></div></div>
      <div id="ov-health" class="grid g2" style="gap:10px;align-content:start"></div></div></section>
    ${topoCard()}
    <div class="grid g2">
      <section class="card"><div class="card-title">${I.pulse}Real Groq usage<span class="sub">from LiteLLM spend logs</span></div><div id="ov-usage"></div></section>
      <section class="card"><div class="card-title">${I.route}Routes behind the gateway</div><div id="ov-routes"></div>
        <hr class="sep"><div class="row between"><div class="muted small">One tiny real call per model (4 Groq calls).</div>
        <button class="btn" data-act="liveCheck">${I.play}Live check</button></div><div id="ov-live" style="margin-top:12px"></div></section>
    </div>
    <section class="card flat"><div class="card-title">${I.info}The tools underneath</div>
      <div class="grid g3">
        <a class="card" href="http://localhost:5000" target="_blank" rel="noopener"><b>MLflow</b><div class="muted small">Runs, Model Registry, Prompt Registry · :5000</div></a>
        <a class="card" href="http://localhost:4000/ui" target="_blank" rel="noopener"><b>LiteLLM admin</b><div class="muted small">Routes, keys, spend logs · user <code>admin</code> · :4000</div></a>
        <a class="card" href="http://localhost:8000/docs" target="_blank" rel="noopener"><b>Nova Assist API</b><div class="muted small">The production app's Swagger UI · :8000</div></a>
      </div></section>`,
  async refresh() {
    const [h, u] = await Promise.all([api("/api/health"), api("/api/usage")]);
    const tile = (k, label) => `<div class="card stat flat" style="padding:12px 14px"><div class="label">${label}</div><div style="margin-top:6px">${pill(h[k], "Healthy", "Down")}</div></div>`;
    region("ov-health", tile("gateway", "LiteLLM gateway") + tile("mlflow", "MLflow") + tile("app", "Nova Assist app") + tile("postgres", "Postgres"));
    region("ov-usage", u.length ? `<div class="table-wrap"><table><thead><tr><th>Route</th><th class="num">Calls</th><th class="num">Tokens</th></tr></thead><tbody>
      ${u.map((r) => `<tr><td class="mono">${esc(r.model_group)}</td><td class="num">${r.calls}</td><td class="num">${num(r.tokens || 0)}</td></tr>`).join("")}</tbody></table></div>
      <div class="muted small" style="margin-top:8px">Simulated traffic never appears here: this is the gateway's own log of real calls.</div>` : `<div class="empty">No calls yet</div>`);
    region("ov-routes", `<div class="table-wrap"><table><thead><tr><th>Route</th><th>Model</th><th>Provider model</th><th class="num">Weight</th><th>Copies to</th></tr></thead><tbody>
      ${S.routes.map((r) => `<tr><td class="mono">${esc(r.route)}${r.db_model ? ' <span class="pill brand">governed</span>' : ""}</td><td>${vtag(r.version)}</td><td class="mono small">${esc(r.provider_model)}</td>
        <td class="num">${r.weight ?? "–"}</td><td class="mono">${esc(r.silent_model || "–")}</td></tr>`).join("")}</tbody></table></div>`);
  },
};

PAGES.s0 = {
  render: () => `${head({ n: 0, when: "Week 0", title: "Where we start" })}${chapter(CH.s0)}${topoCard()}
    <div class="grid g2">
      <section class="card"><div class="card-title">${I.shield}What is live, exactly</div><div id="s0-prod"></div></section>
      <section class="card"><div class="card-title">${I.send}Try production<span class="sub">1 real Groq call</span></div>
        <label class="field">Ask Nova Assist as a customer<input class="input" id="s0-q" value="How do I activate my new debit card?"></label>
        <button class="btn primary" data-act="askProd">${I.send}Send to the production app</button><div id="s0-answer" style="margin-top:14px"></div></section>
    </div>
    <section class="card"><div class="card-title">${I.tag}Model Registry · <code>nova-assist</code><span class="sub"><a href="http://localhost:5000/#/models/nova-assist" target="_blank" rel="noopener">open in MLflow ↗</a></span></div><div id="s0-reg"></div></section>
    <details class="disclose" style="margin-top:16px"><summary>The bank policy prompt (governance/policy.md) · edit it as a governed change</summary><div>
      <p class="muted small">Every answer Nova Assist gives starts from this prompt. Changing it is a model change: saving registers a new version in the MLflow Prompt Registry and writes the audit log. Allowed: <span id="s0-editors"></span>.</p>
      <textarea class="input code" id="s0-prompt" spellcheck="false" style="min-height:260px"></textarea>
      <label class="field" style="margin-top:10px">Reason for the change<input class="input" id="s0-preason" placeholder="e.g. Fraud team: always tell customers we will never ask for their PIN"></label>
      <button class="btn primary" data-act="savePrompt">${I.tag}Save as a new prompt version</button></div></details>
    <section class="card flat"><div class="card-title">${I.rollback}Restart the story</div>
      <p class="muted" style="margin-top:-6px">Back to Week 0: 100% v1, <code>@champion</code> → v1; traffic, shadow pairs and gate decisions cleared. The audit log is append-only, so the reset itself is recorded there.</p>
      <label class="check-line"><input type="checkbox" id="s0-confirm"> I understand this restarts the lesson</label>
      <button class="btn danger" data-act="reset">${I.rollback}Reset to Week 0</button></section>`,
  async refresh() {
    const c = S.registry.find((v) => v.aliases.includes("champion"));
    region("s0-prod", `<div class="kv"><div><div class="k">Champion</div><div class="v" style="font-size:15px">${vtag(c?.tags.nova_version)} <small>registry v${c?.version ?? "–"}</small></div></div>
      <div><div class="k">Provider model</div><div class="v mono" style="font-size:12.5px">${esc(c?.tags.provider_model)}</div></div>
      <div><div class="k">Prompt</div><div class="v mono" style="font-size:12.5px">${esc(S.prompt.uri)}</div></div>
      <div><div class="k">Gateway route</div><div class="v mono" style="font-size:12.5px">nova-assist → ${esc(c?.tags.gateway_route)}</div></div></div>
      ${S.prompt.in_sync ? "" : `<div class="notice warn" style="margin-top:12px">${I.alert}<div><b>governance/policy.md differs from the registered prompt.</b> A prompt change is a model change: register it as a new version.
        <div style="margin-top:8px"><button class="btn" data-act="promptSync">${I.tag}Register the new prompt version</button></div></div></div>`}`);
    region("s0-reg", registryTable());
    if (!memo.promptLoaded) { const p = await api("/api/prompt"); $("#s0-prompt").value = p.text; region("s0-editors", p.editors.map(esc).join(", ")); memo.promptLoaded = true; }
  },
};

PAGES.s1 = {
  render: () => `${head({ n: 1, when: "Week 1 · Monday", title: "The proposal: two candidates" })}${chapter(CH.s1)}
    <div id="s1-cands" class="grid g3"></div>
    <div class="grid" style="grid-template-columns: minmax(0,1.6fr) minmax(0,1fr)">
      <section class="card"><div class="card-title">${I.doc}Proposal MCP-2026-014</div><div id="s1-doc"><div class="empty">Loading…</div></div></section>
      <section class="card"><div class="card-title">${I.shield}Board decision</div><div id="s1-act"></div></section>
    </div>`,
  async refresh() {
    if (!memo.proposal) {
      memo.proposal = await api("/api/proposal");
      const p = memo.proposal.proposal, cur = p.current_champion;
      region("s1-cands", [{ ...cur, version: cur.nova_version, pitch: "Today's chatbot: the benchmark every candidate must beat without getting less safe.",
          expected_cost_per_1k_requests_usd: p.expected_cost_impact.estimated_cost_per_1k_requests_usd.v1, main_risk: "Customers say its answers are vague.", champion: true }, ...p.candidates]
        .map((c) => `<div class="cand"><h4>${vtag(c.version)}${c.champion ? '<span class="pill pass">champion</span>' : '<span class="pill brand">candidate</span>'}</h4>
          <div class="mono small muted">${esc(c.provider_model)}</div><p style="margin:10px 0 8px">${esc(c.pitch)}</p>
          <div class="kv"><div><div class="k">Est. cost / 1K questions</div><div class="v" style="font-size:15px">$${c.expected_cost_per_1k_requests_usd}</div></div>
            <div><div class="k">Main risk</div><div class="small">${esc(c.main_risk)}</div></div></div></div>`).join(""));
      region("s1-doc", `<h2 style="font-size:17px">${esc(p.title)}</h2>
        <div class="kv" style="margin:12px 0"><div><div class="k">Risk tier</div><div class="v">${esc(p.risk.tier)}</div></div>
          <div><div class="k">Owner</div><div class="v" style="font-size:14px">${esc(p.owner.name)}</div></div>
          <div><div class="k">Approvers</div><div class="small">${p.approvers_required.map(esc).join(", ")}</div></div></div>
        <p><b>Why.</b> ${esc(p.business_justification)}</p>
        <b>Risk assessment</b><div class="table-wrap" style="margin:8px 0 14px"><table><thead><tr><th>Risk</th><th>Likelihood</th><th>Impact</th><th>Control (a later chapter)</th></tr></thead><tbody>
          ${p.risk.assessment.map((r) => `<tr><td>${esc(r.risk)}</td><td>${esc(r.likelihood)}</td><td>${esc(r.impact)}</td><td>${esc(r.control)}</td></tr>`).join("")}</tbody></table></div>
        <b>Success criteria</b><ul>${p.success_criteria.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <p><b>Rollback plan.</b> ${esc(p.rollback_plan)}</p>
        ${Object.entries(memo.proposal.model_cards).map(([v, md]) => `<details class="disclose"><summary>Model card · ${esc(v)} ${esc(codename(v))}</summary><div class="md">${mdSafe(md)}</div></details>`).join("")}
        <details class="disclose"><summary>Raw proposal YAML</summary><div><pre class="yaml">${esc(memo.proposal.raw)}</pre></div></details>`);
    }
    const lc = S.lifecycle, roles = S.policy.approvals.proposal;
    let html;
    if (stageIs("baseline", "proposal_rejected", "rolled_back", "offline_failed", "shadow_failed")) {
      html = `<p class="muted" style="margin-top:-4px">Priya submits the proposal. Its hash and both model-card hashes go into the audit log.</p>
        ${acting()}<button class="btn primary" data-act="submitProposal">${I.send}Submit to the governance board</button>`;
    } else if (stageIs("proposal_submitted")) {
      html = `${acting(roles)}
        <div class="seg" id="s1-choice" style="margin-bottom:12px"><button class="on" data-act="choice" data-v="approve">Approve</button><button data-act="choice" data-v="reject">Reject</button></div>
        <label class="field">Rationale <span class="hint">recorded in the audit log</span><textarea class="input" id="s1-comment" placeholder="e.g. Medium risk accepted; evaluate both candidates under policy 1.0."></textarea></label>
        <button class="btn primary" data-act="decide">${I.shield}Record decision</button>`;
    } else {
      html = `<div class="notice good">${I.check}<div><b>Approved for evaluation.</b><br><span class="small">by ${esc(lc.proposal_approver || "–")}</span></div></div>`;
    }
    region("s1-act", html);
  },
};

PAGES.s2 = {
  render: () => `${head({ n: 2, when: "Week 1 · Tuesday – Thursday", title: "The exam: champion vs both candidates" })}${chapter(CH.s2)}
    <section class="card"><div class="card-title">${I.play}Run the exam</div><div id="s2-act"></div><div id="s2-job" style="margin-top:12px"></div></section>
    <div id="s2-res"></div>`,
  async refresh() {
    let act;
    if (stageIs("proposal_approved", "offline_failed")) {
      act = `<p class="muted" style="margin-top:-4px">One job: ${esc(champ())}, then every candidate, on the same 142 examples. Takes about 30 s.</p>${acting()}
        <button class="btn primary" data-act="runEval">${I.play}Run the exam</button>`;
    } else if (curIndex() < 2 || stageIs("proposal_submitted", "proposal_rejected")) {
      act = disabledNote("The proposal must be <b>approved</b> first (Chapter 1).");
    } else if (stageIs("offline_evaluating")) {
      act = `<div class="notice info">${I.pulse}<div><b>The exam is running…</b></div></div>`;
    } else {
      act = `<div class="notice good">${I.check}<div><b>Exam complete.</b> ${S.selected ? `Selected challenger: ${vtag(S.selected)}` : ""}</div></div>`;
    }
    region("s2-act", act);
    await jobsRegion("s2-job", "offline_eval");
    const { eval: r, experiment_id } = await api("/api/offline");
    if (!r || !r.candidates) { region("s2-res", ""); return; }
    const metric = memo.s2metric || "correctness";
    const sig = r.ts + metric;
    if (memo.s2sig === sig) return;
    memo.s2sig = sig;
    const run = (id) => `http://localhost:5000/#/experiments/${experiment_id}/runs/${id}`;
    const cands = Object.entries(r.candidates);
    const c0 = r.champion.version;  // champion at exam time (stays v1 even after a later promotion)
    const series = [{ v: c0, overall: r.champion.overall }, ...cands.map(([v, c]) => ({ v, overall: c.result.overall }))];
    const sel = r.selected, best = sel || cands[0][0];
    region("s2-res", `
      ${gateBanner(!!sel, "Exam result", sel ? `${esc(codename(sel))} (${esc(sel)}) passed every check and is selected as the challenger` : "No candidate passed every check: nothing moves towards production")}
      <div class="grid g${cands.length + 1}">
        <div class="cand"><h4>${vtag(c0)}<span class="pill pass">champion</span></h4><div class="small muted">the benchmark</div>
          <div class="kv" style="margin-top:10px"><div><div class="k">p95 latency</div><div class="v" style="font-size:15px">${ms(r.champion.overall.latency_p95_ms)}</div></div>
          <div><div class="k">Cost / 1K</div><div class="v" style="font-size:15px">${usd(r.champion.overall.cost_per_1k_requests_usd, 3)}</div></div></div>
          <div class="small" style="margin-top:10px"><a href="${run(r.champion.run_id)}" target="_blank" rel="noopener">MLflow run ↗</a></div></div>
        ${cands.map(([v, c]) => {
          const failed = c.checks.filter((x) => !x.passed);
          return `<div class="cand ${v === sel ? "sel" : c.passed ? "" : "rej"}"><h4>${vtag(v)}${v === sel ? '<span class="pill pass">selected</span>' : c.passed ? '<span class="pill neutral">passed · not selected</span>' : '<span class="pill fail">rejected</span>'}</h4>
            <div class="small muted">${c.checks.length - failed.length} of ${c.checks.length} checks passed</div>
            <div class="kv" style="margin-top:10px"><div><div class="k">p95 latency</div><div class="v" style="font-size:15px">${ms(c.result.overall.latency_p95_ms)}</div></div>
            <div><div class="k">Cost / 1K</div><div class="v" style="font-size:15px">${usd(c.result.overall.cost_per_1k_requests_usd, 3)}</div></div></div>
            ${failed.length ? `<div class="small" style="margin-top:10px"><b>Failed:</b> ${failed.slice(0, 4).map((x) => esc(x.check.split(" (")[0])).join(", ")}${failed.length > 4 ? ` +${failed.length - 4} more` : ""}</div>` : ""}
            <div class="small" style="margin-top:8px"><a href="${run(c.result.run_id)}" target="_blank" rel="noopener">MLflow run ↗</a></div></div>`;
        }).join("")}
      </div>
      <div class="grid" style="grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)">
        <section class="card"><div class="card-title">${I.chart}Quality & safety, side by side<span class="sub">${r.challenger.simulated_examples ?? 0} simulated + ${r.challenger.live_examples ?? 0} live per model</span></div>${metricBars(series, S.policy.evaluation.thresholds)}</section>
        <section class="card"><div class="card-title">${I.flask}Live sample<span class="sub">real Groq calls</span></div>
          ${cands.map(([v, c]) => { const l = (c.result.live_results || [])[0]; return l ? `<div style="margin-bottom:14px"><div class="row between"><span>${vtag(v)}</span><span class="pill real">${S.policy.evaluation.live_metrics.map((m) => `${titleCase(m)} ${f2(l[m])}`).join(" · ")} · real judge</span></div>
            <div class="muted small" style="margin:6px 0 4px">Customer: <b>${esc(l.input)}</b></div><div class="answer" style="max-height:200px;overflow:auto">${mdSafe(l.output)}</div></div>` : ""; }).join("") || '<div class="empty">No live sample (simulation off: every example was real)</div>'}</section>
      </div>
      <section class="card"><div class="card-title">${I.chart}Per-intent slices: ${vtag(c0, false)} vs ${vtag(best, false)}<span class="sub">sorted by difference; red = worse than the champion</span></div>
        <div class="row between" style="margin-bottom:10px"><div class="legend" style="margin:0"><span><i style="background:var(--${c0})"></i>${c0}</span><span><i style="background:var(--${best})"></i>${best}</span></div>
          <div class="seg">${["correctness", "policy_compliance", "helpfulness"].map((m) => `<button class="${m === metric ? "on" : ""}" data-act="s2metric" data-v="${m}">${titleCase(m)}</button>`).join("")}</div></div>
        ${sliceDumbbell(r.champion.slices, r.candidates[best].result.slices, metric, c0, best)}</section>
      ${cands.map(([v, c]) => `<details class="disclose" style="margin-top:12px"><summary>Gate checks · ${esc(v)} ${esc(codename(v))} ${c.passed ? "· PASS" : "· FAIL"}</summary><div>${checksTable(c.checks)}</div></details>`).join("")}`);
  },
};

PAGES.s3 = {
  render: () => `${head({ n: 3, when: "Week 1 · Friday", title: "Registration: the winner becomes the challenger" })}${chapter(CH.s3)}
    <section class="card"><div class="card-title">${I.tag}Register</div><div id="s3-act"></div></section>
    ${topoCard("Where it sits now")}
    <section class="card"><div class="card-title">${I.tag}Model Registry · <code>nova-assist</code></div><div id="s3-reg"></div></section>`,
  async refresh() {
    let act;
    if (stageIs("offline_passed")) act = `${acting()}<button class="btn primary" data-act="register">${I.tag}Register ${esc(chall())} · ${esc(codename(chall()))} as @challenger</button>`;
    else if (stageIs("offline_failed")) act = `<div class="notice bad">${I.x}<div><b>No candidate passed the exam.</b> Nothing can be registered: the story ends here, or starts again with a new proposal.</div></div>`;
    else if (curIndex() < 2) act = disabledNote("Needs a candidate that <b>passed</b> the exam (Chapter 2).");
    else act = `<div class="notice good">${I.check}<div><b>Registered.</b> ${vtag(chall())} holds <code>@challenger</code>${stageIs("promoted") ? " (since promoted)" : ""}.</div></div>`;
    region("s3-act", act);
    region("s3-reg", registryTable());
  },
};

function weekForm(real, simulated, label) {
  return `<div class="grid g2" style="gap:12px">
      <label class="field">Real questions <span class="hint">real Groq calls through the app</span><input class="input" type="number" min="0" max="50" id="tr-real" value="${real}"></label>
      <label class="field">Simulated questions <span class="hint">the rest of the week · labelled simulated</span><input class="input" type="number" min="0" max="20000" id="tr-sim" value="${simulated}"></label></div>
    <button class="btn primary" data-act="traffic">${I.play}${label}</button>`;
}

PAGES.s4 = {
  render: () => `${head({ n: 4, when: "Week 2", title: "Shadow week: the challenger listens in" })}${chapter(CH.s4)}${topoCard()}
    <section class="card"><div class="card-title">${I.eye}Control</div><div id="s4-act"></div><div id="s4-job" style="margin-top:12px"></div></section>
    <div id="s4-gate"></div><div id="s4-stats"></div><div id="s4-daily"></div><div id="s4-review"></div><div id="s4-pairs"></div>`,
  async refresh() {
    const sh = S.policy.shadow, roles = S.policy.approvals.traffic_change, c2 = chall();
    let act;
    if (stageIs("challenger_registered", "shadow_failed")) {
      act = `${acting(roles)}<button class="btn primary" data-act="startShadow">${I.eye}Monday: approve shadow mirroring</button>`;
    } else if (stageIs("shadow")) {
      act = `${weekForm(sh.real_requests, sh.simulated_requests, "Simulate the shadow week")}
        <hr class="sep"><div class="row between"><div class="muted small">Friday gate: ≥ ${sh.min_pairs} judged pairs · win+tie ≥ ${pct(sh.min_win_tie_rate, 0)} · critical violations ≤ ${sh.max_critical_violations} · errors ≤ ${pct(sh.max_error_rate, 0)}</div>
        <div class="actions"><button class="btn" data-act="startShadow">${I.rollback}Restart the week</button><button class="btn primary" data-act="shadowGate">${I.shield}Friday: check the shadow gate</button></div></div>`;
    } else if (curIndex() < 4) {
      act = disabledNote("Needs a registered <b>@challenger</b> (Chapter 3).");
    } else {
      act = `<div class="notice good">${I.check}<div><b>Shadow week passed.</b> Mirroring is off; the canary needs its own approval.</div></div>`;
    }
    region("s4-act", act);
    if (stageIs("shadow")) await jobsRegion("s4-job", "replay"); else region("s4-job", "");
    const d = await api("/api/shadow");
    region("s4-gate", memo.s4gate ? `${gateBanner(memo.s4gate.passed, "Shadow gate")}<section class="card">${checksTable(memo.s4gate.checks)}</section>` : "");
    const st = d.stats;
    if (!st || !c2) { ["s4-stats", "s4-daily", "s4-review", "s4-pairs"].forEach((id) => region(id, "")); return; }
    region("s4-stats", `<div class="grid g4">
        <div class="card stat"><div class="label">Questions copied</div><div class="value">${num(st.pairs)}</div><div class="foot">${st.real_pairs ?? 0} real · ${num(st.simulated_pairs ?? 0)} simulated</div></div>
        <div class="card stat"><div class="label">Judged pairs</div><div class="value">${num(st.judged)}</div><div class="foot">${st.real_judged ?? 0} by the real LLM judge</div></div>
        <div class="card stat"><div class="label">Critical violations</div><div class="value">${st.critical_violations}</div><div class="foot">${st.critical_overturned ?? 0} overturned by a human</div></div>
        <div class="card stat"><div class="label">Challenger errors</div><div class="value">${pct(st.error_rate)}</div><div class="foot">missing or failed copies</div></div></div>
      <div class="grid g2">
        <section class="card"><div class="card-title">${I.chart}Who answered better?<span class="sub">win + tie ${pct(st.win_tie_rate, 0)}</span></div>${verdictBar(st, c2)}</section>
        <section class="card"><div class="card-title">${I.pulse}Cost of serving, side by side</div><div class="kv">
          <div><div class="k">${esc(champ())} latency</div><div class="v">${ms(st.champion_latency_ms)}</div></div><div><div class="k">${esc(c2)} latency</div><div class="v">${ms(st.challenger_latency_ms)}</div></div>
          <div><div class="k">${esc(champ())} cost / question</div><div class="v" style="font-size:15px">${usd(st.champion_cost_usd)}</div></div><div><div class="k">${esc(c2)} cost / question</div><div class="v" style="font-size:15px">${usd(st.challenger_cost_usd)}</div></div></div>
          <div class="muted small" style="margin-top:10px">The challenger's latency never reaches a customer: the copied call runs in the background.</div></section></div>`);
    const dailyRows = await api("/api/daily");
    region("s4-daily", dailyRows.length ? `<section class="card"><div class="card-title">${I.cal}The week, day by day<span class="sub">what customers experienced (champion)</span></div>${dailyCharts(dailyRows, [champ()])}</section>` : "");
    region("s4-review", d.flagged.length ? `<section class="card"><div class="card-title">${I.alert}Human review of critical violations<span class="sub">each unreviewed flag blocks the gate</span></div>
      ${d.flagged.map((f) => `<div class="card flat" style="margin-bottom:10px"><div class="row between"><b>Pair ${f.id} ${srcPill(f.simulated)}</b>
          ${f.review_decision ? `<span class="pill ${f.review_decision === "overturned" ? "pass" : "fail"}">${esc(f.review_decision)} by ${esc(f.reviewed_by)}</span>` : '<span class="pill warn">NOT REVIEWED</span>'}</div>
        <p class="small" style="margin:8px 0"><b>Customer:</b> ${esc(f.prompt)}</p><p class="small"><b>Judge:</b> ${esc(f.verdict_reason)}</p>
        <div class="answer small">${mdSafe(f.challenger_response)}</div>
        ${f.review_decision ? "" : `${acting(S.policy.approvals.violation_review)}<label class="field">Review reason<input class="input" id="rv-${f.id}" placeholder="e.g. The answer says a code will be sent; it does not ask for one."></label>
          <div class="actions"><button class="btn danger" data-act="review" data-id="${f.id}" data-confirm="1">${I.x}Confirm violation</button>
          <button class="btn" data-act="review" data-id="${f.id}" data-confirm="0">${I.check}Overturn: the judge was wrong</button></div>`}</div>`).join("")}</section>` : "");
    region("s4-pairs", `<section class="card"><div class="card-title">${I.eye}Side-by-side pairs<span class="sub">real pairs first · showing ${d.pairs.length}</span></div>
      <div class="table-wrap"><table><thead><tr><th>Source</th><th>Intent</th><th>Customer question</th><th>Better answer</th><th>Challenger violation</th><th>Judge reason</th></tr></thead><tbody>
      ${d.pairs.map((p) => `<tr><td>${srcPill(p.simulated)}</td><td class="small">${esc(titleCase(p.intent || ""))}</td><td><span class="clip" data-tip="${esc(p.prompt)}">${esc(p.prompt)}</span></td>
        <td>${p.challenger_error ? '<span class="pill fail">error</span>' : p.verdict ? (p.verdict === "tie" ? '<span class="tag-v">tie</span>' : vtag(p.verdict === "challenger" ? c2 : champ(), false)) : '<span class="pill neutral">judging…</span>'}</td>
        <td>${p.challenger_violation ? `<span class="pill ${p.challenger_violation === "critical" ? "fail" : p.challenger_violation === "minor" ? "warn" : "neutral"}">${esc(p.challenger_violation)}</span>` : "–"}</td>
        <td><span class="clip small" data-tip="${esc(p.verdict_reason || p.challenger_error || "")}">${esc(p.verdict_reason || p.challenger_error || "")}</span></td></tr>`).join("")}</tbody></table></div></section>`);
  },
};

function livePage(canary) {
  return {
    render: () => `${head(canary ? { n: 5, when: "Week 3", title: "Canary week: 5% of customers meet the challenger" }
        : { n: 6, when: "Weeks 4 – 6", title: "Weekly rollout: 25% → 50% → 100%" })}${chapter(canary ? CH.s5 : CH.s6)}
      <div id="lv-banner"></div>${topoCard()}
      <section class="card"><div class="card-title">${I.route}Control</div><div id="lv-act"></div><div id="lv-job" style="margin-top:12px"></div></section>
      <div id="lv-live"></div><div id="lv-hist"></div>`,
    async refresh() {
      const lc = S.lifecycle, pol = S.policy, roles = pol.approvals.traffic_change, c1 = champ(), c2 = chall();
      const base = lc.stage.replace("_passed", "");
      const mine = canary ? base === "canary" : base.startsWith("rollout_");
      const stepName = base === "canary" ? "Canary week" : `Rollout ${lc.challenger_weight}% week`;
      region("lv-banner", stageIs("rolled_back") ? `<div class="notice bad" style="margin-bottom:16px">${I.rollback}<div><b>Rolled back during ${esc(titleCase(lc.rolled_back_from || ""))}.</b> ${esc(lc.rollback_reason || "")}. Production is 100% ${vtag(c1)}. The incident is in the Audit log.</div></div>` : "");
      let act;
      const nextStep = () => pol.rollout.steps.find((s) => s > lc.challenger_weight);
      if (canary && stageIs("shadow_passed", "rolled_back")) {
        act = `${acting(roles)}<button class="btn primary" data-act="startCanary">${I.route}Monday: approve ${pol.canary.weight_percent}% of customers to ${esc(c2)} · ${esc(codename(c2))}</button>`;
      } else if (!canary && stageIs("canary_passed", "rollout_25_passed", "rollout_50_passed")) {
        act = `${acting(roles)}<button class="btn primary" data-act="nextStep">${I.route}Monday: approve the next step, ${nextStep()}% to ${esc(c2)}</button>`;
      } else if (mine && !lc.stage.endsWith("_passed")) {
        const k = String(lc.challenger_weight);
        const [real, sim] = canary ? [pol.canary.real_requests, pol.canary.simulated_requests] : [pol.rollout.real_requests[k] ?? 0, pol.rollout.simulated_requests[k] ?? 10000];
        act = `${weekForm(real, sim, `Simulate the ${stepName.toLowerCase()}`)}<hr class="sep">
          <div class="actions"><button class="btn" data-act="liveGate">${I.shield}Check the gate now</button>
          <button class="btn danger" data-act="rollback">${I.rollback}Manual rollback to 100% ${esc(c1)}</button></div>`;
      } else if (mine) {
        act = `<div class="notice good">${I.check}<div><b>${esc(stepName)} passed.</b> ${canary ? "Next: the Weekly rollout chapter." : "Next: promotion (Chapter 7)."} Monitoring continues while traffic stays at this split.</div></div>
          <div class="actions" style="margin-top:12px"><button class="btn danger" data-act="rollback">${I.rollback}Manual rollback to 100% ${esc(c1)}</button></div>`;
      } else if (!canary && stageIs("promoted")) {
        act = `<div class="notice good">${I.check}<div><b>Rollout complete.</b> The challenger served 100% and was promoted.</div></div>`;
      } else {
        act = disabledNote(canary ? (curIndex() > 5 ? "Canary week is behind us; continue in Weekly rollout." : "Needs a passed <b>shadow week</b> (Chapter 4).") : "Needs a passed <b>canary week</b> (Chapter 5).");
      }
      region("lv-act", act);
      if (mine && !lc.stage.endsWith("_passed")) await jobsRegion("lv-job", "replay"); else region("lv-job", "");
      const d = await api("/api/live");
      if (!mine || !c2) { region("lv-live", ""); } else {
        const g = pol.live_gate, rows = await api("/api/daily");
        const vcard = (v) => { const s = d.stats[v] || {}; return `<section class="card version-card"><h4>${vtag(v)} ${v === c1 ? "champion" : "challenger"}</h4><div class="kv">
            <div><div class="k">Questions</div><div class="v">${num(s.requests)}</div><div class="small muted">${s.real ?? 0} real · ${num(s.simulated ?? 0)} sim</div></div>
            <div><div class="k">Error rate</div><div class="v">${pct(s.error_rate)}</div></div>
            <div><div class="k">p95 latency</div><div class="v" style="font-size:16px">${ms(s.p95_latency_ms)}</div></div>
            <div><div class="k">Quality</div><div class="v">${f2(s.quality)} <small>n=${num(s.judged)}</small></div></div>
            <div><div class="k">Cost / question</div><div class="v" style="font-size:14px">${usd(s.cost_per_request_usd)}</div></div></div></section>`; };
        const decided = lc.stage.endsWith("_passed") ? true : d.enough ? d.checks.every((c) => c.passed) : null;
        region("lv-live", `<div class="grid g2">${vcard(c1)}${vcard(c2)}</div>
          ${rows.length ? `<section class="card"><div class="card-title">${I.cal}${esc(stepName)}, day by day</div>${dailyCharts(rows, [c1, c2].filter((v) => d.stats[v]?.requests))}</section>` : ""}
          ${gateBanner(memo.lvgate ? memo.lvgate.passed : decided, `${stepName} gate`, `The worker re-checks every ${g.auto_check_interval_seconds} s${d.enough ? "" : `; it decides once there are ≥ ${g.min_challenger_requests} challenger questions and ≥ ${g.min_judged_samples} judged`}`)}
          <section class="card"><div class="card-title">${I.shield}Gate checks</div>${checksTable(memo.lvgate?.checks || d.checks)}</section>`);
      }
      region("lv-hist", d.history.length ? `<section class="card"><div class="card-title">${I.clock}Gate history</div><div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>Week</th><th>Result</th><th>Failed checks</th><th>Policy</th></tr></thead><tbody>
        ${d.history.map((h) => `<tr><td class="small">${when(h.ts)}</td><td>${esc(h.stage === "canary" ? "Canary week" : `Rollout ${h.stage.split("_")[1]}%`)}</td><td>${pill(h.passed)}</td>
          <td class="small">${esc(h.checks.filter((c) => !c.passed).map((c) => c.check).join(", ") || "–")}</td><td class="mono small">${esc(h.policy_version)}</td></tr>`).join("")}</tbody></table></div></section>` : "");
    },
  };
}
PAGES.s5 = livePage(true);
PAGES.s6 = livePage(false);

PAGES.s7 = {
  render: () => `${head({ n: 7, when: "Week 7", title: "Promotion, retirement and the weekly drift check" })}${chapter(CH.s7)}${topoCard()}
    <div class="grid g2">
      <section class="card"><div class="card-title">${I.trophy}Promotion</div><div id="s7-act"></div></section>
      <section class="card"><div class="card-title">${I.pulse}Weekly drift check</div>
        <p class="muted" style="margin-top:-6px">Re-examines the champion and compares it with its reference scores (allowed drop per metric: <span id="s7-drop"></span>).</p>
        ${acting()}<button class="btn primary" data-act="drift">${I.play}Run this week's drift check</button><div id="s7-job" style="margin-top:12px"></div><div id="s7-drift" style="margin-top:12px"></div></section>
    </div>
    <section class="card"><div class="card-title">${I.tag}Model Registry · <code>nova-assist</code></div><div id="s7-reg"></div></section>
    <section class="card"><div class="card-title">${I.doc}Governance report<span class="sub">built only from records · saved to reports/ and MLflow</span></div>
      <button class="btn primary" data-act="report">${I.doc}Generate the report for the board</button><div id="s7-report" style="margin-top:16px"></div></section>`,
  async refresh() {
    let act;
    if (stageIs("rollout_100_passed")) act = `${acting(S.policy.approvals.promotion)}<button class="btn primary" data-act="promote">${I.trophy}Board: promote ${esc(chall())} · ${esc(codename(chall()))} to @champion, retire ${esc(champ())}</button>`;
    else if (stageIs("promoted")) act = `<div class="notice good">${I.check}<div><b>${vtag(champ())} is @champion.</b> ${vtag(S.lifecycle.retired)} is retired with alias <code>@retired</code>, kept for rollback, never deleted.</div></div>`;
    else act = disabledNote(`Needs a passed <b>100% rollout week</b>. Now: ${esc(titleCase(S.lifecycle.stage))}.`);
    region("s7-act", act);
    region("s7-reg", registryTable());
    await jobsRegion("s7-job", "drift");
    const d = await api("/api/drift");
    region("s7-drop", String(d.max_drop));
    region("s7-drift", d.last ? `${gateBanner(d.last.passed, "Drift check", when(d.last.ts) + (d.drift_shift ? ` · simulated drift_shift ${d.drift_shift}` : ""))}${checksTable(d.last.checks)}` : "");
  },
};

PAGES.audit = {
  render: () => `${head({ eyebrow: "Records", title: "Audit log" })}
    <div class="grid g2">
      <section class="card"><div class="card-title">${I.lock}Integrity</div><div id="au-verify"></div></section>
      <section class="card"><div class="card-title">${I.alert}Try to rewrite history</div>
        <p class="muted" style="margin-top:-6px">Change the decision on entry #1. Postgres triggers block every UPDATE, DELETE and TRUNCATE.</p>
        <button class="btn danger" data-act="tamper">${I.x}Try to edit history</button><div id="au-tamper" style="margin-top:12px"></div></section>
    </div>
    <section class="card"><div class="card-title">${I.clock}Everything that happened<span class="sub"><label class="check-line" style="margin:0"><input type="checkbox" id="au-since" checked> only since the last reset</label></span></div><div id="au-table"></div></section>`,
  async refresh() {
    const d = await api(`/api/audit?since_reset=${$("#au-since")?.checked !== false}`);
    region("au-verify", d.intact
      ? `<div class="notice good">${I.check}<div><b>Hash chain INTACT</b> across all ${d.count} entries.<div class="small">Each entry's hash covers the previous one, so editing any past entry breaks every later one.</div></div></div>`
      : `<div class="notice bad">${I.x}<div><b>Hash chain BROKEN</b> at entry #${d.first_bad}.</div></div>`);
    region("au-table", `<div class="table-wrap"><table><thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Stage</th><th>Action</th><th>Decision</th><th>Details</th><th>Hash</th></tr></thead><tbody>
      ${d.rows.map((r) => {
        const dec = r.decision ? `<span class="pill ${/FAIL|REJECT|ROLLED/.test(r.decision) ? "fail" : /PASS|APPROVED|overturned|^v\d/i.test(r.decision) ? "pass" : "neutral"}">${esc(r.decision)}</span>` : "";
        const det = JSON.stringify(r.details);
        return `<tr><td class="mono">${r.id}</td><td class="small" style="white-space:nowrap">${when(r.ts)}</td><td class="small">${esc(r.actor)}</td>
          <td class="small">${esc(titleCase(r.stage))}</td><td><b class="small">${esc(titleCase(r.action))}</b></td><td>${dec}</td>
          <td><span class="clip small mono" data-tip="${esc(det.slice(0, 600))}">${esc(det)}</span></td><td class="hash">${esc(r.hash.slice(0, 10))}</td></tr>`;
      }).join("")}</tbody></table></div>`);
  },
};

PAGES.policy = {
  render: () => `${head({ eyebrow: "Records", title: "Governance policy" })}
    <div class="notice info" style="margin-bottom:16px">${I.info}<div><b>Rollback demo.</b> During the canary or a rollout week, change <code>max_p95_latency_ratio: 1.5</code> to <code>0.5</code>, bump <code>version</code>, give a reason and save. Within 15 s the worker re-checks the week's metrics against the stricter rule and rolls back automatically.</div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)">
      <section class="card"><div class="card-title">${I.doc}policy.yaml<span class="sub" id="po-fp"></span></div><textarea class="input code" id="po-text" spellcheck="false"></textarea></section>
      <section class="card"><div class="card-title">${I.shield}Save a new version</div><div id="po-acting"></div>
        <label class="field">Reason for the change<textarea class="input" id="po-reason" placeholder="e.g. Board tightens the latency budget"></textarea></label>
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

PAGES.check = {
  render: () => `${head({ eyebrow: "Before class", title: "System check" })}
    <div class="notice info" style="margin-bottom:16px">${I.info}<div>Everything after the first <code>docker compose up</code> happens in this console. Use this page before class to prove the whole stack works: services, every model route, and a full automatic rehearsal of the story.</div></div>
    <div class="grid">
      <section class="card"><div class="card-title">${I.pulse}Services</div><div id="ck-health" class="grid g2" style="gap:10px"></div>
        <hr class="sep"><div class="row between"><div class="muted small">One tiny real call per model (4 Groq calls).</div><button class="btn" data-act="liveCheck">${I.play}Live check</button></div>
        <div id="ov-live" style="margin-top:12px"></div></section>
    </div>
    <section class="card"><div class="card-title">${I.book}Rehearse the whole story<span class="sub">about 3 min · ~11 real Groq calls</span></div>
      <p class="muted" style="margin-top:-6px">Plays every chapter automatically with the same governed actions as the buttons: proposal, three-way exam, registration, shadow week, canary week, the rollback demo, the three rollout weeks, promotion, report and drift check. Each chapter is checked and timed. <b>It replaces the current lesson state</b>, so run it before class, not during.</p>
      <label class="check-line"><input type="checkbox" id="ck-rb" checked> include the rollback demo</label>
      <label class="check-line"><input type="checkbox" id="ck-reset" checked> reset to Week 0 afterwards (ready for class)</label>
      <label class="check-line"><input type="checkbox" id="ck-confirm"> I understand this replaces the current lesson state</label>
      <button class="btn primary" data-act="rehearse">${I.play}Rehearse the whole story</button>
      <div id="ck-job" style="margin-top:12px"></div><div id="ck-result" style="margin-top:12px"></div></section>`,
  async refresh() {
    const h = await api("/api/health");
    region("ck-health", ["gateway", "mlflow", "app", "postgres"].map((k) => `<div class="card stat flat" style="padding:12px 14px"><div class="label">${{ gateway: "LiteLLM gateway", mlflow: "MLflow", app: "Nova Assist app", postgres: "Postgres" }[k]}</div><div style="margin-top:6px">${pill(h[k], "Healthy", "Down")}</div></div>`).join(""));
    const jobs = await jobsRegion("ck-job", "rehearsal");
    const j = jobs[0];
    if (!j || j.status !== "done") { region("ck-result", ""); return; }
    const full = memo.rehearsal?.id === j.id ? memo.rehearsal : (memo.rehearsal = { id: j.id, ...(await api(`/api/jobs/${j.id}`)) });
    const r = full.result;
    if (!r) return;
    region("ck-result", `${gateBanner(r.passed, "Story rehearsal", `${r.chapters.length} chapters in ${r.seconds} s · ${r.real_llm_calls} real LLM calls · audit chain ${r.audit_chain_intact ? "intact" : "BROKEN"}${r.reset_to_week_0 ? " · reset to Week 0" : ""}`)}
      ${r.error ? `<div class="notice bad" style="margin-bottom:12px">${I.x}<div><b>Stopped:</b> ${esc(r.error)}</div></div>` : ""}
      <div class="table-wrap"><table><thead><tr><th>Result</th><th>Chapter</th><th class="num">Seconds</th><th>Outcome</th></tr></thead><tbody>
      ${r.chapters.map((c) => `<tr><td>${pill(c.ok, "OK", "FAIL")}</td><td><b>${esc(c.chapter)}</b></td><td class="num">${c.seconds}</td><td class="small">${esc(c.outcome)}</td></tr>`).join("")}</tbody></table></div>`);
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
    await post("/api/reset"); Object.keys(memo).forEach((k) => delete memo[k]); toast("Back to Week 0.");
  },
  async submitProposal() { await post("/api/proposal/submit"); toast("Proposal submitted to the board."); },
  choice(el) { el.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === el)); },
  async decide() {
    const approve = $("#s1-choice .on").dataset.v === "approve";
    await post("/api/proposal/decide", { approve, comment: $("#s1-comment").value });
    toast(`Decision recorded: ${approve ? "APPROVED" : "REJECTED"}.`);
  },
  async runEval() { await post("/api/jobs", { kind: "offline_eval", params: {} }); toast("The exam has started."); },
  s2metric(el) { memo.s2metric = el.dataset.v; memo.s2sig = null; },
  async register() { const r = await post("/api/register"); toast(`Registered as registry version ${r.version} (@challenger).`); },
  async startShadow() { memo.s4gate = null; await post("/api/shadow/start"); toast("Shadow mirroring is on: watch the diagram."); },
  async traffic() {
    await post("/api/jobs", { kind: "replay", params: { count: +$("#tr-real").value || 0, simulated: +$("#tr-sim").value || 0 } });
    memo.lvgate = null; toast("The week is running.");
  },
  async shadowGate() { memo.s4gate = await post("/api/shadow/gate"); toast(`Shadow gate: ${memo.s4gate.passed ? "PASS" : "FAIL"}`, memo.s4gate.passed ? "good" : "bad"); },
  async review(el) {
    await post("/api/shadow/review", { pair_id: +el.dataset.id, confirm: el.dataset.confirm === "1", note: $(`#rv-${el.dataset.id}`).value });
    toast("Review recorded in the audit log.");
  },
  async startCanary() { memo.lvgate = null; await post("/api/canary/start"); toast("Canary week started."); },
  async nextStep() { memo.lvgate = null; const r = await post("/api/rollout/next"); toast(`New split: ${Object.entries(r.weights).map(([k, v]) => `${k} ${v}%`).join(" · ")}.`); },
  async liveGate() {
    const r = await post("/api/live/gate"); memo.lvgate = r.passed == null ? null : r;
    toast(r.passed == null ? "Not enough data yet: simulate the week first." : `Gate: ${r.passed ? "PASS" : "FAIL (rolled back)"}`, r.passed === false ? "bad" : "good");
  },
  async rollback() { memo.lvgate = null; await post("/api/rollback"); toast("Rolled back to 100% champion.", "bad"); },
  async promote() { const r = await post("/api/promote"); toast(`Promoted: registry version ${r.version} is @champion.`); },
  async drift() { await post("/api/jobs", { kind: "drift", params: {} }); toast("Drift check queued."); },
  async report() {
    const r = await post("/api/report");
    region("s7-report", `<div class="row between" style="margin-bottom:10px"><span class="muted small">Saved as <code>${esc(r.file)}</code></span>
      <a class="btn" download="governance-report.md" href="data:text/markdown;charset=utf-8,${encodeURIComponent(r.markdown)}">${I.doc}Download Markdown</a></div>
      <div class="card flat md">${mdSafe(r.markdown)}</div>`);
  },
  async savePrompt() {
    const r = await post("/api/prompt", { text: $("#s0-prompt").value, reason: $("#s0-preason").value });
    $("#s0-preason").value = ""; memo.promptLoaded = false; toast(`New prompt version registered: ${esc(r.uri)}`);
  },
  async promptSync() { const r = await post("/api/prompt/sync"); toast(`Prompt registered: ${esc(r.uri)}`); },
  async rehearse() {
    if (!$("#ck-confirm").checked) throw new Error("Tick the confirmation box first.");
    await post("/api/jobs", { kind: "rehearsal", params: { rollback_demo: $("#ck-rb").checked, reset_after: $("#ck-reset").checked } });
    memo.rehearsal = null; toast("Rehearsal started: follow the progress here.");
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
    [S, STORY] = await Promise.all([api("/api/state"), api("/api/story")]);
    $("#sys-dot").className = "dot ok"; $("#sys-text").textContent = `Policy ${S.policy_fingerprint}`;
    renderChrome();
    region("cal", calendar());
    region("topo", topology());
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
  $("#crumb").textContent = meta.n != null ? `Chapter ${meta.n} · ${meta.label}` : meta.label;
  if (id !== "policy") memo.policyLoaded = false;
  if (id !== "s0") memo.promptLoaded = false;
  $("#view").innerHTML = page.render();
  $("#sidebar").classList.remove("open");
  window.scrollTo(0, 0);
  if (S) { renderChrome(); region("cal", calendar()); region("topo", topology()); page.refresh?.().catch(console.error); }
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
