/*
 * Auralis Pulse Mock Studio
 *
 * Sync notes: this file mirrors the render templates in src/main.js. When you
 * change the structure of a session card, the right panel, the settings view, or
 * any overlay in the real app, mirror that change here so screenshots stay accurate.
 *
 * Stylesheet is shared (../src/style.css), so visual changes propagate automatically;
 * only DOM structure changes need a manual sync here.
 *
 * Last sync: v1.3.5
 */

// ============================================================================
// SAMPLE DATA
// ============================================================================

const SAMPLE_TIER = "MAX 20X";
const SAMPLE_VERSION = "1.3.5";

// Fictional demo data. Generic dev-task session names that any Claude Code user
// would recognize. No real project paths, no internal agent names.
const SAMPLE_SESSIONS = [
  { session_id: "s1", name: "auth-refactor",       pid: 14821, cwd: "C:\\dev\\webapp",      duration_mins: 292, last_activity_mins: 2 },
  { session_id: "s2", name: "release-notes",       pid: 18203, cwd: "C:\\dev\\webapp",      duration_mins: 48,  last_activity_mins: 7 },
  { session_id: "s3", name: "billing-flow-debug",  pid: 22091, cwd: "C:\\dev\\api",         duration_mins: 153, last_activity_mins: 1 },
  { session_id: "s4", name: "perf-investigation",  pid: 9421,  cwd: "C:\\dev\\api",         duration_mins: 725, last_activity_mins: 65 },
  { session_id: "s5", name: "checkout-redesign",   pid: 12483, cwd: "C:\\dev\\storefront",  duration_mins: 82,  last_activity_mins: 12 },
];

// Note: max_tokens = MODEL's max context (Opus 1M, Sonnet 200K). pct = used/max.
// Alert tier is independent: it compares used_tokens against the assigned preset's thresholds.
// So a session at 35% of model max can still be in T1 alert if the preset's warning is set lower.
// That dual-axis view (model fill vs preset alert) is the core Pulse mental model.
const SAMPLE_CONTEXTS = {
  s1: { used_tokens: 114000, max_tokens: 1000000, pct: 11.4, model: "opus-4-7",   compaction_count: 4, turn_count: 142 },
  s2: { used_tokens: 64000,  max_tokens: 1000000, pct: 6.4,  model: "opus-4-7",   compaction_count: 2, turn_count: 28 },
  s3: { used_tokens: 350000, max_tokens: 1000000, pct: 35.0, model: "opus-4-7",   compaction_count: 9, turn_count: 88 },
  s4: { used_tokens: 180000, max_tokens: 1000000, pct: 18.0, model: "opus-4-7",   compaction_count: 3, turn_count: 64 },
  s5: { used_tokens: 95000,  max_tokens: 200000,  pct: 47.5, model: "sonnet-4-5", compaction_count: 1, turn_count: 19 },
};

// Pin auth-refactor (the active flagship session)
const SAMPLE_PINS = new Set(["s1"]);

// Preset assignments by session_id (others fall back to default)
const SAMPLE_PRESET_ASSIGNMENTS = {
  s1: "p4", // Soul - long-lived flagship session, no auto-fire
  s2: "p2", // Worker - quick task
  s3: "p3", // Architect - heavy debug session in alert state
  s4: "p3", // Architect - long-running ghost
  s5: "p2", // Worker - sonnet redesign
};

const SAMPLE_AUTOCOMPACT = { s2: true, s5: true }; // others default off

const SAMPLE_PRESETS = [
  {
    id: "p1", name: "Default", isDefault: true, builtin: true, limitTokens: 250000,
    thresholds: [
      { tokens: 175000, commandId: null, notify: true },
      { tokens: 212500, commandId: null, notify: true },
      { tokens: 237500, commandId: "compact", notify: true },
    ],
  },
  {
    id: "p2", name: "Worker", isDefault: false, builtin: true, limitTokens: 250000,
    thresholds: [
      { tokens: 175000, commandId: null, notify: true },
      { tokens: 212500, commandId: "code-review", notify: true },
      { tokens: 237500, commandId: "compact", notify: true },
    ],
  },
  {
    id: "p3", name: "Architect", isDefault: false, builtin: true, limitTokens: 450000,
    thresholds: [
      { tokens: 315000, commandId: null, notify: true },
      { tokens: 382500, commandId: "code-review", notify: true },
      { tokens: 427500, commandId: "compact", notify: true },
    ],
  },
  {
    id: "p4", name: "Soul", isDefault: false, builtin: true, limitTokens: 450000,
    thresholds: [
      { tokens: 315000, commandId: null, notify: true },
      { tokens: 382500, commandId: null, notify: true },
      { tokens: 427500, commandId: null, notify: false },
    ],
  },
];

// Realistic dev commands any developer could set up. No internal Auralis vocab.
const SAMPLE_COMMANDS = [
  { id: "compact", name: "Compact", text: "/compact", confirm: true, builtin: true },
  { id: "run-tests", name: "Run tests", text: "Run the test suite for the changed files. Surface failures with line numbers.", confirm: false, builtin: false },
  { id: "code-review", name: "Code review", text: "Review the current diff. Flag bugs, missed edge cases, weak naming. One paragraph per file.", confirm: false, builtin: false },
  { id: "tighten-types", name: "Tighten types", text: "Tighten the TypeScript types on the changed files. No `any`. No silent casts. Explain any unavoidable widening.", confirm: false, builtin: false },
];

const SAMPLE_USAGE = (() => {
  const now = Date.now();
  return {
    five_hour: { utilization: 29, resets_at: new Date(now + 8 * 60 * 1000).toISOString() },
    seven_day: { utilization: 41, resets_at: new Date(now + (2 * 24 + 11) * 3600 * 1000).toISOString() },
    seven_day_sonnet: { utilization: 3, resets_at: new Date(now + (2 * 24 + 11) * 3600 * 1000).toISOString() },
    extra_usage: { used_credits: 0, monthly_limit: 4250 },
  };
})();

// ============================================================================
// MOCK STATE
// ============================================================================

const mockState = {
  theme: "cyberpunk",
  view: "main",                 // main | settings
  settingsTab: "appearance",    // appearance | behavior | alerts | commands | about
  overlay: "none",              // none | preset-modal | send-popover
  overlaySession: "s3",         // session whose overlay is shown (s3 has alert tier so it pairs well)
  size: 1,
  filter: "all",
  sort: "default",
  metric: "weekly",             // 5h / weekly / sonnet (lights one button)
  alwaysOnTop: true,
  autoHide: true,
  autostart: false,
};

// ============================================================================
// HELPERS (mirrored from src/main.js)
// ============================================================================

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDuration(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function formatTokens(t) {
  if (t >= 1000000) return `${(t / 1000000).toFixed(1)}M`;
  if (t >= 1000) return `${(t / 1000).toFixed(0)}k`;
  return `${t}`;
}

function formatTokenDisplay(tokens) {
  if (tokens >= 1000000) {
    const m = tokens / 1000000;
    const mStr = m % 1 === 0 ? String(m) : m.toFixed(2).replace(/\.?0+$/, "");
    return mStr + "M";
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    const kStr = k % 1 === 0 ? String(k) : k.toFixed(1).replace(/\.?0+$/, "");
    return kStr + "K";
  }
  return String(tokens);
}

function formatTimeLeft(resetAt) {
  if (!resetAt) return "";
  const reset = new Date(resetAt);
  const diff = reset - new Date();
  if (diff <= 0) return "resetting...";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days[reset.getDay()];
  const time = reset.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = `${day} ${time}`;
  if (h > 24) return `resets in ${Math.floor(h / 24)}d ${h % 24}h (${dateStr})`;
  if (h > 0) return `resets in ${h}h ${m}m (${dateStr})`;
  return `resets in ${m}m`;
}

function getColor(pct) {
  if (pct >= 90) return "red";
  if (pct >= 75) return "orange";
  if (pct >= 50) return "yellow";
  return "green";
}

function refineStatus(session, ctx) {
  const pct = ctx ? ctx.pct : 0;
  if (session.last_activity_mins <= 5) return "active";
  if (session.last_activity_mins <= 15 || pct >= 15) return "idle";
  return "ghost";
}

function truncatePath(cwd, maxLen) {
  if (!cwd || cwd.length <= maxLen) return cwd || "";
  const parts = cwd.replace(/\//g, "\\").split("\\").filter(Boolean);
  if (parts.length <= 2) return cwd.slice(0, maxLen) + "...";
  return parts[0] + "\\....\\" + parts[parts.length - 1];
}

function projectNameFromCwd(cwd) {
  if (!cwd) return "(unknown)";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function resolvePreset(sessionId) {
  const assignedId = SAMPLE_PRESET_ASSIGNMENTS[sessionId];
  if (assignedId) {
    const p = SAMPLE_PRESETS.find(x => x.id === assignedId);
    if (p) return p;
  }
  return SAMPLE_PRESETS.find(p => p.isDefault) || SAMPLE_PRESETS[0];
}

function getAlertState(ctx, preset) {
  if (!ctx || !preset || !preset.thresholds || preset.thresholds.length < 3) return null;
  const tokens = ctx.used_tokens || 0;
  if (tokens >= preset.thresholds[2].tokens) return "t3";
  if (tokens >= preset.thresholds[1].tokens) return "t2";
  if (tokens >= preset.thresholds[0].tokens) return "t1";
  return null;
}

// ============================================================================
// RENDER: shared bar
// ============================================================================

function renderBar(label, pct, subText, valuePrefix = "") {
  const color = getColor(pct);
  return `
    <div class="bar-item">
      <div class="bar-header">
        <span class="bar-label">${label}</span>
        <span class="bar-value ${color}">${valuePrefix}${pct}%</span>
      </div>
      <div class="bar-bg">
        <div class="bar-fill ${color}" style="width: ${Math.max(pct, 1)}%"></div>
      </div>
      ${subText ? `<div class="bar-sub">${subText}</div>` : ""}
    </div>
  `;
}

// ============================================================================
// RENDER: session card
// ============================================================================

function renderStatusBadge(status) {
  if (status === "active") return "";
  const label = status === "idle" ? "IDLE" : "GHOST";
  return ` <span class="status-badge status-${status}">${label}</span>`;
}

function renderAlertIcon(tier) {
  if (!tier) return "";
  const tierNames = { t1: "warning", t2: "pre-critical", t3: "critical" };
  return ` <span class="alert-icon alert-icon-${tier}" title="${tierNames[tier]}">&#9888;</span>`;
}

const PIN_SVG = `<svg class="pin-icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M16 4h-1V3a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v1H8a1 1 0 0 0-1 1v3.586a1 1 0 0 0 .293.707L9 11v3H6a1 1 0 0 0 0 2h5v5a1 1 0 0 0 2 0v-5h5a1 1 0 0 0 0-2h-3v-3l1.707-1.707A1 1 0 0 0 17 7.586V5a1 1 0 0 0-1-1z"/></svg>`;

function renderSession(session, ctx, index) {
  const pct = ctx ? Math.round(ctx.pct) : 0;
  const model = ctx ? ctx.model : "...";
  const used = ctx ? formatTokens(ctx.used_tokens) : "...";
  const max = ctx ? formatTokens(ctx.max_tokens) : "...";
  const status = refineStatus(session, ctx);
  const shortCwd = truncatePath(session.cwd, 30);

  const preset = ctx ? resolvePreset(session.session_id) : null;
  const alertTier = getAlertState(ctx, preset);

  const infoLeft = `${model}, ${formatDuration(session.duration_mins)}, ${used} / ${max}`;
  const infoRight = `PID ${session.pid}`;
  const numberPrefix = index ? `<span class="session-number">#${index}</span> ` : "";
  const barLabel = numberPrefix + escapeHtml(session.name) + renderAlertIcon(alertTier) + renderStatusBadge(status);

  const compactCount = ctx && ctx.compaction_count > 0 ? ctx.compaction_count : 0;
  const compactLabel = compactCount === 1 ? "compaction" : "compactions";
  const compactTooltip = compactCount > 0 ? `Number of /compact runs in this session (${compactCount})` : "";
  const compactPrefix = compactCount > 0
    ? `<span class="compact-indicator" title="${compactTooltip}">${compactCount} ${compactLabel} &middot; </span>`
    : "";

  const safeName = escapeHtml(session.name || "session");
  const pinned = SAMPLE_PINS.has(session.session_id);

  let actions = "";
  if (ctx && preset) {
    const presetName = escapeHtml(preset.name || "preset");
    actions += `<button class="action-preset-chip" data-mock-app-action="open-preset" data-session-id="${session.session_id}" title="Alert preset: ${presetName}"><span class="preset-chip-label">${presetName}</span><span class="preset-chip-caret">&#x25BE;</span></button>`;
  }
  actions += `<button class="action-icon-btn pin-btn${pinned ? " pinned" : ""}" data-mock-app-action="toggle-pin" data-session-id="${session.session_id}" title="${pinned ? "Unpin" : "Pin to top"}">${PIN_SVG}</button>`;
  actions += `<button class="action-icon-btn" data-mock-app-action="open-send" data-session-id="${session.session_id}" title="Send command">&#x22EF;</button>`;
  if (status !== "active") {
    actions += `<button class="action-icon-btn dismiss-icon-btn" title="Dismiss session">&#x2715;</button>`;
  }

  const alertClass = alertTier ? ` alert-${alertTier}` : "";

  return `
    <div class="session-card ${status}${alertClass} fade-in">
      ${renderBar(barLabel, pct, "", compactPrefix)}
      <div class="session-info-row">
        <span class="session-info-left">${infoLeft}</span>
        <span class="session-info-right">${infoRight}</span>
      </div>
      <div class="session-footer">
        <span class="session-path" title="${escapeHtml(session.cwd)}">${escapeHtml(shortCwd)}</span>
        <div class="session-actions">${actions}</div>
      </div>
    </div>
  `;
}

// ============================================================================
// RENDER: left panel (sessions)
// ============================================================================

function renderSessionControls(sessions) {
  const total = sessions.length;
  const statusCounts = { active: 0, idle: 0, ghost: 0 };
  for (const s of sessions) {
    const st = refineStatus(s, SAMPLE_CONTEXTS[s.session_id]);
    if (statusCounts[st] !== undefined) statusCounts[st]++;
  }
  const filterOpts = [`<option value="all" selected>All (${total})</option>`];
  filterOpts.push(`<optgroup label="Status">`);
  for (const st of ["active", "idle", "ghost"]) {
    if (statusCounts[st] > 0) {
      filterOpts.push(`<option value="status:${st}">${st[0].toUpperCase() + st.slice(1)} (${statusCounts[st]})</option>`);
    }
  }
  filterOpts.push(`</optgroup>`);
  const sortOpts = [
    ["default", "Default"],
    ["context", "By context %"],
    ["duration", "By duration"],
    ["activity", "By last activity"],
    ["alphabetical", "Alphabetical"],
  ].map(([v, l]) => `<option value="${v}"${v === "default" ? " selected" : ""}>${l}</option>`).join("");
  return `
    <div class="sessions-controls">
      <select class="session-select" title="Filter">${filterOpts.join("")}</select>
      <select class="session-select" title="Sort">${sortOpts}</select>
    </div>
  `;
}

function renderLeftPanel() {
  const sessions = SAMPLE_SESSIONS;
  const total = sessions.length;

  const pinned = sessions.filter(s => SAMPLE_PINS.has(s.session_id));
  const unpinned = sessions.filter(s => !SAMPLE_PINS.has(s.session_id));

  let html = `
    <div class="sessions-header">
      <span class="section-label">SESSIONS (${total})</span>
      ${renderSessionControls(sessions)}
    </div>
  `;

  let n = 0;
  for (const s of pinned) {
    n += 1;
    html += renderSession(s, SAMPLE_CONTEXTS[s.session_id], n);
  }
  if (pinned.length > 0 && unpinned.length > 0) {
    html += `<div class="pinned-divider"></div>`;
  }
  for (const s of unpinned) {
    n += 1;
    html += renderSession(s, SAMPLE_CONTEXTS[s.session_id], n);
  }

  return html;
}

// ============================================================================
// RENDER: right panel (usage)
// ============================================================================

function renderExtraUsage(extra) {
  if (!extra) return "";
  const used = ((extra.used_credits || 0) / 100).toFixed(2);
  const limit = ((extra.monthly_limit || 0) / 100).toFixed(2);
  return `
    <div class="extra-inline">
      <span class="extra-label">EXTRA USAGE</span>
      <span class="extra-value">${used} <span class="extra-sep">/</span> ${limit}</span>
    </div>
  `;
}

function metricBtn(id, label) {
  const active = mockState.metric === id ? "active" : "";
  return `<button class="metric-btn ${active}" data-mock-app-action="metric" data-value="${id}">${label}</button>`;
}

function renderRightPanel() {
  const u = SAMPLE_USAGE;
  let html = `<div class="section-label">USAGE</div>`;
  html += renderBar("Session (5h)", Math.round(u.five_hour.utilization), formatTimeLeft(u.five_hour.resets_at));
  html += renderBar("Weekly", Math.round(u.seven_day.utilization), formatTimeLeft(u.seven_day.resets_at));
  html += renderBar("Sonnet (weekly)", Math.round(u.seven_day_sonnet.utilization), formatTimeLeft(u.seven_day_sonnet.resets_at));
  html += renderExtraUsage(u.extra_usage);
  html += `
    <div class="settings-row">
      ${metricBtn("session", "5H")}
      ${metricBtn("weekly", "WEEK")}
      ${metricBtn("sonnet", "SONNET")}
    </div>
    <div class="usage-age">Updated 0m ago</div>
  `;
  return html;
}

// ============================================================================
// RENDER: header
// ============================================================================

function renderHeader() {
  return `
    <div class="header">
      <div class="header-left">
        <div class="header-title-row">
          <h1>AURALIS PULSE</h1>
          <span class="tier-label">${SAMPLE_TIER}</span>
        </div>
        <span class="header-subtitle">COMPANION FOR CLAUDE CODE &middot; v${SAMPLE_VERSION}</span>
      </div>
      <div class="header-right">
        <button class="header-icon-btn" data-mock-app-action="open-settings" title="Settings">&#x2699;</button>
        <button class="refresh-icon-btn" title="Refresh all">&#x21bb;</button>
      </div>
    </div>
  `;
}

function renderMainView() {
  return `
    ${renderHeader()}
    <div class="split-container">
      <div class="panel-left">${renderLeftPanel()}</div>
      <div class="panel-right">${renderRightPanel()}</div>
    </div>
  `;
}

// Public helper for cover.html: render the main view as a full HTML string,
// composed of #mock-app > #mock-app-main exactly like the live mock.
// Stateless: doesn't mutate mockState. The state object passed in is local.
window.renderMockMainViewHTML = function(state) {
  // Save and override globals temporarily
  const saved = {};
  for (const k of ["theme", "view", "metric", "filter", "sort"]) {
    saved[k] = mockState[k];
    if (k in state) mockState[k] = state[k];
  }
  try {
    const html = `
      <div id="mock-app" data-theme="${mockState.theme}" style="height:520px; width:810px; display:flex; flex-direction:column; background: var(--bg-primary); border: 1px solid var(--border-outer); overflow:hidden;">
        <div style="display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden;">
          ${renderMainView()}
        </div>
      </div>
    `;
    return html;
  } finally {
    Object.assign(mockState, saved);
  }
};

// ============================================================================
// RENDER: settings view
// ============================================================================

function renderToggle(key, checked) {
  return `
    <label class="toggle" data-mock-app-action="toggle" data-key="${key}">
      <input type="checkbox" ${checked ? "checked" : ""} />
      <span class="toggle-slider"></span>
    </label>
  `;
}

function renderThemeOption(id, label) {
  const checked = mockState.theme === id ? "checked" : "";
  return `
    <label class="theme-option" data-mock-app-action="theme" data-value="${id}">
      <input type="radio" name="theme-mock" value="${id}" ${checked}>
      <span class="theme-option-label">${label}</span>
    </label>
  `;
}

function renderAppearanceTab() {
  return `
    <div class="settings-group">
      <div class="settings-group-label">THEME</div>
      <div class="settings-card">
        <div class="settings-item theme-picker">
          <div class="theme-options">
            ${renderThemeOption("cyberpunk", "Cyber")}
            ${renderThemeOption("glass", "Glass")}
            ${renderThemeOption("light", "Light")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderBehaviorTab() {
  return `
    <div class="settings-group">
      <div class="settings-group-label">WINDOW BEHAVIOR</div>
      <div class="settings-card">
        <div class="settings-item">
          <span class="settings-item-label">Always on top</span>
          ${renderToggle("alwaysOnTop", mockState.alwaysOnTop)}
        </div>
        <div class="settings-item">
          <span class="settings-item-label">Auto-hide on blur</span>
          ${renderToggle("autoHide", mockState.autoHide)}
        </div>
        <div class="settings-item">
          <span class="settings-item-label">Start with Windows</span>
          ${renderToggle("autostart", mockState.autostart)}
        </div>
      </div>
    </div>
    <div class="settings-group">
      <div class="settings-group-label">TRAY ICON METRIC</div>
      <div class="settings-card">
        <div class="settings-item">
          <div class="settings-row" style="padding:0; border:none; background:none;">
            ${metricBtn("session", "5H")}
            ${metricBtn("weekly", "WEEK")}
            ${metricBtn("sonnet", "SONNET")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPresetRow(preset) {
  const leftIcon = preset.isDefault
    ? `<span class="preset-default-star" title="Default preset">&#9733;</span>`
    : `<button class="preset-default-btn" title="Set as default">&#9734;</button>`;
  const limitDisplay = formatTokenDisplay(preset.limitTokens);
  const pcts = preset.thresholds.map(t => Math.round((t.tokens / preset.limitTokens) * 100));
  const thresholdSummary = `${pcts[0]}/${pcts[1]}/${pcts[2]}%`;
  const builtinTag = preset.builtin ? ` <span class="tag-builtin">built-in</span>` : "";
  const deleteBtn = preset.isDefault ? "" : `<button class="action-icon-btn dismiss-icon-btn" title="Delete">&#x2715;</button>`;
  return `
    <div class="settings-item preset-row">
      ${leftIcon}
      <div class="preset-info">
        <div class="preset-name-row">
          <span class="preset-name">${escapeHtml(preset.name)}</span>${builtinTag}
        </div>
        <div class="preset-summary">${limitDisplay} &middot; ${thresholdSummary}</div>
      </div>
      <div class="preset-actions">
        <button class="action-icon-btn" title="Edit">&#9998;</button>
        ${deleteBtn}
      </div>
    </div>
  `;
}

function renderAlertsTab() {
  const rows = SAMPLE_PRESETS.map(renderPresetRow).join("");
  return `
    <div class="settings-group">
      <div class="settings-group-label">ALERT PRESETS</div>
      <div class="settings-card">
        ${rows}
        <div class="settings-item settings-item-action">
          <button class="btn btn-secondary">+ New preset</button>
        </div>
      </div>
      <div class="settings-group-hint">&#9733; = default preset (applies to sessions without specific assignment)</div>
    </div>
  `;
}

function renderCommandRow(cmd) {
  const previewOneLine = cmd.text.split("\n")[0].slice(0, 60) + (cmd.text.length > 60 ? "..." : "");
  const builtinTag = cmd.builtin ? ` <span class="tag-builtin">built-in</span>` : "";
  const confirmTag = cmd.confirm ? ` <span class="tag-confirm">confirm</span>` : "";
  const deleteBtn = cmd.builtin ? "" : `<button class="action-icon-btn dismiss-icon-btn" title="Delete">&#x2715;</button>`;
  return `
    <div class="settings-item cmd-row">
      <div class="cmd-info">
        <div class="cmd-name-row">
          <span class="cmd-name">${escapeHtml(cmd.name)}</span>${builtinTag}${confirmTag}
        </div>
        <div class="cmd-preview">${escapeHtml(previewOneLine)}</div>
      </div>
      <div class="cmd-actions">
        <button class="action-icon-btn" title="Edit">&#9998;</button>
        ${deleteBtn}
      </div>
    </div>
  `;
}

function renderCommandsTab() {
  const rows = SAMPLE_COMMANDS.map(renderCommandRow).join("");
  return `
    <div class="settings-group">
      <div class="settings-group-label">CUSTOM COMMANDS</div>
      <div class="settings-card">
        ${rows}
        <div class="settings-item settings-item-action">
          <button class="btn btn-secondary">+ New command</button>
        </div>
      </div>
    </div>
  `;
}

function renderAboutTab() {
  return `
    <div class="settings-group">
      <div class="settings-group-label">ABOUT</div>
      <div class="settings-card">
        <div class="settings-about">
          Auralis Pulse v${SAMPLE_VERSION}<br>
          <a href="https://github.com/antonpme/auralis-pulse" target="_blank">github.com/antonpme/auralis-pulse</a>
        </div>
      </div>
    </div>
  `;
}

function renderSettingsView() {
  const tabs = [
    ["appearance", "Appearance"],
    ["behavior", "Behavior"],
    ["alerts", "Alerts"],
    ["commands", "Commands"],
    ["about", "About"],
  ];
  let content = "";
  switch (mockState.settingsTab) {
    case "appearance": content = renderAppearanceTab(); break;
    case "behavior": content = renderBehaviorTab(); break;
    case "alerts": content = renderAlertsTab(); break;
    case "commands": content = renderCommandsTab(); break;
    case "about": content = renderAboutTab(); break;
    default: content = renderAppearanceTab();
  }
  return `
    <div class="settings-header">
      <button class="settings-back-btn" data-mock-app-action="back-from-settings">&larr; BACK</button>
      <span class="settings-title">SETTINGS</span>
      <span></span>
    </div>
    <div class="settings-tabs">
      ${tabs.map(([id, label]) =>
        `<button class="settings-tab ${mockState.settingsTab === id ? "active" : ""}" data-mock-app-action="settings-tab" data-value="${id}">${label}</button>`
      ).join("")}
    </div>
    <div class="settings-view">
      ${content}
    </div>
  `;
}

// ============================================================================
// RENDER: overlays (preset modal, send popover)
// ============================================================================

function renderPresetPickerBody(sessionId, sessionName) {
  const current = resolvePreset(sessionId);
  const assignedId = SAMPLE_PRESET_ASSIGNMENTS[sessionId] || "";

  const presetOptions = SAMPLE_PRESETS.map(p => {
    const defaultTag = p.isDefault ? " (default)" : "";
    const selected = (assignedId === p.id) || (!assignedId && p.isDefault);
    return `<option value="${escapeHtml(p.id)}"${selected ? " selected" : ""}>${escapeHtml(p.name)}${defaultTag}</option>`;
  }).join("");

  let thresholdRows = "";
  if (current) {
    const tierLabels = ["Warning", "Pre-crit", "Critical"];
    thresholdRows = current.thresholds.map((t, i) => {
      const pct = current.limitTokens > 0 ? Math.round((t.tokens / current.limitTokens) * 100) : 0;
      const cmd = t.commandId ? SAMPLE_COMMANDS.find(c => c.id === t.commandId) : null;
      const cmdLine = cmd ? `<div class="popover-cmd-line">&rarr; ${escapeHtml(cmd.name)}</div>` : "";
      const notifyDot = t.notify ? `<span class="popover-notify-dot" title="System notification"></span>` : "";
      return `
        <div class="popover-threshold">
          <span class="popover-tier">${tierLabels[i]}</span>
          <span class="popover-value">${formatTokenDisplay(t.tokens)} &middot; ${pct}%</span>
          ${notifyDot}
        </div>
        ${cmdLine}
      `;
    }).join("");
  }

  const acChecked = !!SAMPLE_AUTOCOMPACT[sessionId];

  return `
    <div class="popover-field">
      <label class="popover-label">Preset</label>
      <select class="field-input popover-preset-select">
        ${presetOptions}
      </select>
    </div>
    ${current ? `
      <div class="popover-summary">
        <div class="popover-subtitle">Using ${escapeHtml(current.name)} &middot; ${formatTokenDisplay(current.limitTokens)} limit</div>
        ${thresholdRows}
      </div>
    ` : `<div class="popover-empty">No presets configured</div>`}
    <div class="popover-field popover-safety">
      <label class="popover-checkbox">
        <input type="checkbox" ${acChecked ? "checked" : ""} />
        <span>Allow auto-compact on this session</span>
      </label>
      <div class="popover-hint">Off by default. When off, /compact auto-fire is blocked even if configured in preset. Other commands (Code review, Run tests, etc.) still fire normally.</div>
    </div>
  `;
}

function renderSendMenuBody(sessionName) {
  const items = SAMPLE_COMMANDS.map(c => {
    const previewOneLine = c.text.split("\n")[0].slice(0, 60) + (c.text.length > 60 ? "..." : "");
    const confirmTag = c.confirm ? ` <span class="tag-confirm">confirm</span>` : "";
    return `
      <button class="popover-send-item">
        <div class="popover-send-name">${escapeHtml(c.name)}${confirmTag}</div>
        <div class="popover-send-preview">${escapeHtml(previewOneLine)}</div>
      </button>
    `;
  }).join("");
  return `
    <div class="popover-header">
      <span class="popover-title">Send &middot; ${escapeHtml(sessionName)}</span>
    </div>
    <div class="popover-send-list">
      ${items}
    </div>
  `;
}

function renderOverlay() {
  if (mockState.overlay === "none") return "";

  const session = SAMPLE_SESSIONS.find(s => s.session_id === mockState.overlaySession) || SAMPLE_SESSIONS[0];

  if (mockState.overlay === "preset-modal") {
    return `
      <div class="modal-backdrop" data-mock-app-action="close-overlay">
        <div class="modal-card" data-mock-app-action="stop-propagation">
          <div class="modal-header">
            <span class="modal-title">Alerts &middot; ${escapeHtml(session.name)}</span>
            <button class="modal-close" data-mock-app-action="close-overlay" title="Close">&#x2715;</button>
          </div>
          <div class="modal-body">${renderPresetPickerBody(session.session_id, session.name)}</div>
          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm">Manage presets</button>
            <button class="btn btn-primary" data-mock-app-action="close-overlay">Done</button>
          </div>
        </div>
      </div>
    `;
  }

  if (mockState.overlay === "send-popover") {
    // Anchor visually near where the send icon would be on session #3 (third card from top of stack).
    // Approximate: right edge ~12px from frame, top ~270px (third card, action row).
    return `
      <div class="popover" style="top: 200px; right: 256px; max-height: 280px;">
        <div class="popover-body">${renderSendMenuBody(session.name)}</div>
      </div>
    `;
  }

  return "";
}

// ============================================================================
// MAIN RENDER + EVENT WIRING
// ============================================================================

const mockApp = document.getElementById("mock-app");
const mockMain = document.getElementById("mock-app-main");
const mockOverlays = document.getElementById("mock-app-overlays");
const studioFrame = document.getElementById("studio-frame");
const frameMeta = document.getElementById("frame-meta");
const settingsTabControls = document.getElementById("settings-tab-controls");

function applyTheme(name) {
  document.documentElement.setAttribute("data-theme", name);
  document.body.setAttribute("data-theme", name);
}

function applySize() {
  const s = mockState.size;
  studioFrame.style.transform = `scale(${s})`;
  // After scaling, update meta line
  frameMeta.textContent = s === 1
    ? "810 x 520 (native)"
    : `810 x 520 (scaled ${s}x for high-res capture)`;
  // Adjust stage padding to account for scaled-up frame consuming more space
  const stage = document.querySelector(".studio-stage");
  if (stage) {
    const extra = (s - 1) * 520;
    stage.style.paddingBottom = `${40 + extra}px`;
  }
}

function render() {
  applyTheme(mockState.theme);
  if (mockState.view === "settings") {
    mockMain.innerHTML = renderSettingsView();
    settingsTabControls.style.display = "flex";
  } else {
    mockMain.innerHTML = renderMainView();
    settingsTabControls.style.display = "none";
  }
  mockOverlays.innerHTML = renderOverlay();
  applySize();
}

// Sync the studio bar's "active" highlight on a control group to match mockState
function syncStudioBarHighlights() {
  const map = {
    theme: mockState.theme,
    view: mockState.view,
    "settings-tab": mockState.settingsTab,
    overlay: mockState.overlay,
    size: String(mockState.size),
  };
  for (const action of Object.keys(map)) {
    const btns = document.querySelectorAll(`[data-mock-action="${action}"]`);
    btns.forEach(b => {
      b.classList.toggle("active", b.dataset.value === map[action]);
    });
  }
}

// ---- Studio bar (top controls) ----
document.getElementById("studio-controls").addEventListener("click", e => {
  const btn = e.target.closest("[data-mock-action]");
  if (!btn) return;
  const action = btn.dataset.mockAction;
  const value = btn.dataset.value;

  if (action === "theme") mockState.theme = value;
  if (action === "view") mockState.view = value;
  if (action === "settings-tab") mockState.settingsTab = value;
  if (action === "overlay") mockState.overlay = value;
  if (action === "size") mockState.size = parseFloat(value);

  render();
  syncStudioBarHighlights();
});

// ---- Mock app (clicks inside the simulated window) ----
// All interactive elements inside the mock carry `data-mock-app-action`.
// This handler mirrors what the real app would do, but writes to mockState.
mockApp.addEventListener("click", e => {
  const target = e.target.closest("[data-mock-app-action]");
  if (!target) return;
  const action = target.dataset.mockAppAction;

  if (action === "stop-propagation") {
    // Modal card: don't close when clicking inside it
    e.stopPropagation();
    return;
  }

  if (action === "open-settings") {
    mockState.view = "settings";
  } else if (action === "back-from-settings") {
    mockState.view = "main";
  } else if (action === "settings-tab") {
    mockState.settingsTab = target.dataset.value;
  } else if (action === "theme") {
    mockState.theme = target.dataset.value;
  } else if (action === "metric") {
    mockState.metric = target.dataset.value;
  } else if (action === "toggle") {
    const key = target.dataset.key;
    if (key in mockState) mockState[key] = !mockState[key];
  } else if (action === "open-preset") {
    mockState.overlay = "preset-modal";
    mockState.overlaySession = target.dataset.sessionId;
  } else if (action === "open-send") {
    mockState.overlay = "send-popover";
    mockState.overlaySession = target.dataset.sessionId;
  } else if (action === "toggle-pin") {
    const sid = target.dataset.sessionId;
    if (SAMPLE_PINS.has(sid)) SAMPLE_PINS.delete(sid);
    else SAMPLE_PINS.add(sid);
  } else if (action === "close-overlay") {
    mockState.overlay = "none";
  }

  render();
  syncStudioBarHighlights();
});

// URL params let cover.html (or any external page) embed the mock in a specific
// state without manual clicks. Supported: theme, view, settingsTab, overlay, size, clean.
const params = new URLSearchParams(window.location.search);
if (params.has("theme")) mockState.theme = params.get("theme");
if (params.has("view")) mockState.view = params.get("view");
if (params.has("settingsTab")) mockState.settingsTab = params.get("settingsTab");
if (params.has("overlay")) mockState.overlay = params.get("overlay");
if (params.has("size")) mockState.size = parseFloat(params.get("size"));
if (params.has("clean")) document.body.classList.add("clean");

// Studio mount: only render the live studio if the studio DOM is on the page.
// cover.html / external pages skip this and call renderMockMainViewHTML() themselves.
if (mockApp && mockMain && mockOverlays) {
  render();
  syncStudioBarHighlights();
}
