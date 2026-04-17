const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const app = document.getElementById("app");
let currentMetric = localStorage.getItem("pulse-tray-metric") || "weekly";
let currentView = "main"; // "main" | "settings"
let renderLock = false;
let lastGhostCount = 0;

// ---- v1.3 STATE (tabs, modal, popover, toast) ----
let activeSettingsTab = "appearance"; // "appearance" | "behavior" | "alerts" | "commands" | "about"
let activeModal = null; // null | { type: string, data: object }
let activePopover = null; // null | { type: string, sessionId?: string, anchorRect: DOMRect }
let toasts = []; // { id, type, message, duration, cancellable, onComplete, onCancel, timer, cancelled }
let toastCounter = 0;
let firedThresholds = {}; // { [sessionId]: { t1: bool, t2: bool, t3: bool } } - hysteresis

// ---- SETTINGS STATE ----

const validThemes = ["cyberpunk", "glass", "light"];
const savedTheme = localStorage.getItem("pulse-theme");

// Load custom commands (seed with built-in Compact if empty)
function loadCustomCommands() {
  try {
    const stored = localStorage.getItem("pulse-custom-commands");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return [
    { id: "compact", name: "Compact", text: "/compact", confirm: false, builtin: true },
  ];
}

function saveCustomCommands() {
  localStorage.setItem("pulse-custom-commands", JSON.stringify(settings.customCommands));
}

// Parse token input strings (accepts "250K", "450000", "1.5M", "250,000", etc.)
function parseTokenInput(str) {
  if (str == null) return null;
  const cleaned = String(str).trim().toUpperCase().replace(/[\s,]/g, '');
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d+(?:\.\d+)?)(K|M)?$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;
  if (match[2] === 'K') return Math.round(num * 1000);
  if (match[2] === 'M') return Math.round(num * 1000000);
  return Math.round(num);
}

function formatTokenDisplay(tokens) {
  if (tokens >= 1000000) {
    const m = tokens / 1000000;
    const mStr = m % 1 === 0 ? String(m) : m.toFixed(2).replace(/\.?0+$/, '');
    return mStr + 'M';
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    const kStr = k % 1 === 0 ? String(k) : k.toFixed(1).replace(/\.?0+$/, '');
    return kStr + 'K';
  }
  return String(tokens);
}

// Load alert presets (seed with 4 built-ins if localStorage empty)
function loadPresets() {
  try {
    const stored = localStorage.getItem("pulse-presets");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return [
    {
      id: "preset-default",
      name: "Default",
      limitTokens: 250000,
      thresholds: [
        { tokens: 175000, commandId: null, notify: true },
        { tokens: 212500, commandId: null, notify: true },
        { tokens: 237500, commandId: "compact", notify: true },
      ],
      isDefault: true,
      builtin: true,
    },
    {
      id: "preset-worker",
      name: "Worker",
      limitTokens: 250000,
      thresholds: [
        { tokens: 175000, commandId: null, notify: true },
        { tokens: 212500, commandId: null, notify: true },
        { tokens: 237500, commandId: "compact", notify: true },
      ],
      isDefault: false,
      builtin: true,
    },
    {
      id: "preset-architect",
      name: "Architect",
      limitTokens: 450000,
      thresholds: [
        { tokens: 337500, commandId: null, notify: true },
        { tokens: 382500, commandId: null, notify: true },
        { tokens: 414000, commandId: "compact", notify: true },
      ],
      isDefault: false,
      builtin: true,
    },
    {
      id: "preset-soul",
      name: "Soul",
      limitTokens: 450000,
      thresholds: [
        { tokens: 360000, commandId: null, notify: true },
        { tokens: 396000, commandId: null, notify: true },
        { tokens: 427500, commandId: null, notify: true },
      ],
      isDefault: false,
      builtin: true,
    },
  ];
}

function savePresets() {
  localStorage.setItem("pulse-presets", JSON.stringify(settings.presets));
}

// Load per-session preset assignments (keyed by session_id)
function loadSessionPresets() {
  try {
    const stored = localStorage.getItem("pulse-session-presets");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return {};
}

function saveSessionPresets() {
  localStorage.setItem("pulse-session-presets", JSON.stringify(settings.sessionPresets));
}

// Pinned sessions (Set of session_id). Pinned sessions render at top, unaffected by filter.
function loadSessionPins() {
  try {
    const stored = localStorage.getItem("pulse-session-pins");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch (_) {}
  return new Set();
}

function saveSessionPins() {
  localStorage.setItem("pulse-session-pins", JSON.stringify(Array.from(settings.sessionPins)));
}

function togglePin(sessionId) {
  if (!settings.sessionPins) settings.sessionPins = new Set();
  if (settings.sessionPins.has(sessionId)) {
    settings.sessionPins.delete(sessionId);
    showToast({ type: "info", message: "Unpinned", duration: 1200 });
  } else {
    settings.sessionPins.add(sessionId);
    showToast({ type: "info", message: "Pinned to top", duration: 1200 });
  }
  saveSessionPins();
  render();
}

// Per-session auto-compact allowlist (keyed by session_id). Default empty = auto-compact OFF for all.
function loadSessionAutoCompact() {
  try {
    const stored = localStorage.getItem("pulse-session-auto-compact");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return {};
}

function saveSessionAutoCompact() {
  localStorage.setItem("pulse-session-auto-compact", JSON.stringify(settings.sessionAutoCompact));
}

// Detect /compact command (built-in or custom with exact matching text)
function isCompactCommand(cmd) {
  if (!cmd) return false;
  if (cmd.id === "compact") return true;
  const t = (cmd.text || "").trim().toLowerCase();
  return t === "/compact";
}

// Resolve the effective preset for a given session (assigned or default)
function resolvePreset(sessionId) {
  if (!settings.presets || settings.presets.length === 0) return null;
  const assignedId = settings.sessionPresets && settings.sessionPresets[sessionId];
  if (assignedId) {
    const found = settings.presets.find(p => p.id === assignedId);
    if (found) return found;
  }
  return settings.presets.find(p => p.isDefault) || settings.presets[0] || null;
}

const settings = {
  theme: (savedTheme && validThemes.includes(savedTheme)) ? savedTheme : "cyberpunk",
  alwaysOnTop: localStorage.getItem("pulse-always-on-top") !== "false",
  autoHide: localStorage.getItem("pulse-auto-hide") !== "false",
  filter: localStorage.getItem("pulse-filter") || "all",
  sort: localStorage.getItem("pulse-sort") || "default",
  customCommands: loadCustomCommands(),
  presets: loadPresets(),
  sessionPresets: loadSessionPresets(),
  sessionAutoCompact: loadSessionAutoCompact(),
  sessionPins: loadSessionPins(),
};

const THEME_SIZES = {
  cyberpunk: { w: 810, h: 520 },
  glass: { w: 810, h: 520 },
  light: { w: 810, h: 520 },
};

function applyTheme(name) {
  settings.theme = name;
  document.documentElement.setAttribute("data-theme", name);
  localStorage.setItem("pulse-theme", name);
  // All themes now share same window size (810x520) - no resize needed.
}

function saveSetting(key, value) {
  settings[key] = value;
  localStorage.setItem(`pulse-${key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`, String(value));
}

// Apply saved theme on load
applyTheme(settings.theme);

// Sync backend state on load
(async () => {
  try { await invoke("set_always_on_top", { enabled: settings.alwaysOnTop }); } catch (_) {}
  try { await invoke("set_auto_hide", { enabled: settings.autoHide }); } catch (_) {}
  try { await invoke("set_tray_metric", { metric: currentMetric }); } catch (_) {}
})();

// ---- UTILITIES ----

function getColor(pct) {
  if (pct >= 90) return "red";
  if (pct >= 75) return "orange";
  if (pct >= 50) return "yellow";
  return "green";
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

function formatTier(raw) {
  if (!raw) return "FREE";
  return raw.toUpperCase().replace("DEFAULT_CLAUDE_", "").replace("DEFAULT_", "").replace(/_/g, " ");
}

// ---- UNIFIED BAR ----

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

// ---- LEFT PANEL: Sessions ----

function truncatePath(cwd, maxLen) {
  if (!cwd || cwd.length <= maxLen) return cwd || "";
  const parts = cwd.replace(/\//g, "\\").split("\\").filter(Boolean);
  if (parts.length <= 2) return cwd.slice(0, maxLen) + "...";
  return parts[0] + "\\....\\" + parts[parts.length - 1];
}

function refineStatus(session, ctx) {
  const pct = ctx ? ctx.pct : 0;
  if (session.last_activity_mins <= 5) return "active";
  if (session.last_activity_mins <= 15 || pct >= 15) return "idle";
  return "ghost";
}

function renderStatusBadge(status) {
  if (status === "active") return "";
  return `<span class="status-badge ${status}">${status.toUpperCase()}</span>`;
}

function renderAlertIcon(tier) {
  if (!tier) return "";
  const tierNames = { t1: "warning", t2: "pre-critical", t3: "critical" };
  return `<span class="alert-icon alert-icon-${tier}" title="${tierNames[tier]}">&#9888;</span>`;
}

function renderSession(session, ctx, index) {
  const pct = ctx ? Math.round(ctx.pct) : 0;
  const model = ctx ? ctx.model : "...";
  const used = ctx ? formatTokens(ctx.used_tokens) : "...";
  const max = ctx ? formatTokens(ctx.max_tokens) : "...";
  const status = refineStatus(session, ctx);
  const shortCwd = truncatePath(session.cwd, 30);

  // Alert state for visual card styling + icon
  const preset = ctx ? resolvePreset(session.session_id) : null;
  const alertTier = getAlertState(ctx, preset);

  const infoLeft = `${model}, ${formatDuration(session.duration_mins)}, ${used} / ${max}`;
  const legendParts = [];
  if (ctx && ctx.turn_count > 0) legendParts.push(`${ctx.turn_count} turns`);
  if (ctx && pct > 60) {
    const autocompactPct = Math.round(((ctx.max_tokens - 33000) / ctx.max_tokens) * 100);
    legendParts.push(`compact at ${autocompactPct}%`);
  }
  const infoRight = `PID ${session.pid}`;
  const numberPrefix = index ? `<span class="session-number">#${index}</span> ` : "";
  const barLabel = numberPrefix + session.name + renderAlertIcon(alertTier) + renderStatusBadge(status);
  // Compaction count next to percentage (saves a line)
  const compactPrefix = ctx && ctx.compaction_count > 0
    ? `<span class="compact-indicator">&#x21BB;${ctx.compaction_count} · </span>`
    : "";

  const safeName = escapeHtml(session.name || "session");
  const pinned = !!(settings.sessionPins && settings.sessionPins.has(session.session_id));
  let actions = `<button class="action-icon-btn pin-btn${pinned ? ' pinned' : ''}" data-action="toggle-pin" data-session-id="${escapeHtml(session.session_id)}" title="${pinned ? 'Unpin' : 'Pin to top'}">&#x2B06;</button>`;
  actions += `<button class="action-icon-btn" data-pid="${session.pid}" data-action="compact" title="Compact session">&#x21BB;</button>`;
  actions += `<button class="action-icon-btn" data-action="open-send-popover" data-session-id="${escapeHtml(session.session_id)}" data-pid="${session.pid}" data-name="${safeName}" title="Send command">&#x22EF;</button>`;
  if (ctx) {
    actions += `<button class="action-icon-btn" data-action="open-preset-popover" data-session-id="${escapeHtml(session.session_id)}" data-name="${safeName}" title="Alert preset">&#x2699;</button>`;
  }
  if (status !== "active") {
    actions += `<button class="action-icon-btn dismiss-icon-btn" data-pid="${session.pid}" data-action="dismiss" title="Dismiss session">&#x2715;</button>`;
  }

  const alertClass = alertTier ? ` alert-${alertTier}` : "";

  return `
    <div class="session-card ${status}${alertClass} fade-in">
      ${renderBar(barLabel, pct, "", compactPrefix)}
      <div class="session-info-row">
        <span class="session-info-left">${infoLeft}</span>
        <span class="session-info-right">${infoRight}</span>
      </div>
      ${legendParts.length > 0 ? `<div class="context-legend">${legendParts.join(" · ")}</div>` : ""}
      <div class="session-footer">
        <span class="session-path" title="${session.cwd}">${shortCwd}</span>
        <div class="session-actions">${actions}</div>
      </div>
    </div>
  `;
}

function renderPermission(perm) {
  const req = perm.request;
  let detail = "";
  if (req.tool_input) {
    if (req.tool_input.command) detail = req.tool_input.command;
    else if (req.tool_input.file_path) detail = req.tool_input.file_path;
    else detail = JSON.stringify(req.tool_input).slice(0, 120);
  }
  if (detail.length > 120) detail = detail.slice(0, 120) + "...";
  const permId = req.id;

  return `
    <div class="permission-card fade-in">
      <div class="permission-tool">${req.tool_name}</div>
      <div class="permission-detail">${detail}</div>
      <div class="permission-actions">
        <button class="perm-btn allow" data-action="perm" data-id="${permId}" data-decision="allow">YES <kbd>Y</kbd></button>
        <button class="perm-btn allow secondary" data-action="perm" data-id="${permId}" data-decision="allow_session">ALWAYS <kbd>A</kbd></button>
        <button class="perm-btn deny" data-action="perm" data-id="${permId}" data-decision="deny">NO <kbd>N</kbd></button>
        <button class="perm-btn dismiss" data-action="perm" data-id="${permId}" data-decision="dismiss">&#x2715;</button>
      </div>
    </div>
  `;
}

// ---- FILTER + SORT HELPERS ----

function projectNameFromCwd(cwd) {
  if (!cwd) return "(unknown)";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function filterSessions(sessions, contexts, filter) {
  if (!filter || filter === "all") return sessions;
  if (filter.startsWith("status:")) {
    const target = filter.slice(7);
    return sessions.filter(s => refineStatus(s, contexts[s.session_id]) === target);
  }
  if (filter.startsWith("project:")) {
    const target = filter.slice(8);
    return sessions.filter(s => s.cwd === target);
  }
  return sessions;
}

function sortSessions(sessions, contexts, sort) {
  const arr = [...sessions];
  switch (sort) {
    case "context":
      arr.sort((a, b) => (contexts[b.session_id]?.pct || 0) - (contexts[a.session_id]?.pct || 0));
      break;
    case "duration":
      arr.sort((a, b) => b.duration_mins - a.duration_mins);
      break;
    case "activity":
      arr.sort((a, b) => (a.last_activity_mins || 0) - (b.last_activity_mins || 0));
      break;
    case "alphabetical":
      arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      break;
    default:
      break;
  }
  return arr;
}

function renderSessionControls(sessions, contexts, currentFilter, currentSort) {
  // Build status counts
  const statusCounts = { active: 0, idle: 0, ghost: 0 };
  for (const s of sessions) {
    const st = refineStatus(s, contexts[s.session_id]);
    if (statusCounts[st] !== undefined) statusCounts[st]++;
  }

  // Build project counts
  const projectMap = new Map();
  for (const s of sessions) {
    const cwd = s.cwd || "(unknown)";
    projectMap.set(cwd, (projectMap.get(cwd) || 0) + 1);
  }

  // Filter options
  const filterOpts = [`<option value="all"${currentFilter === "all" ? " selected" : ""}>All (${sessions.length})</option>`];
  filterOpts.push(`<optgroup label="Status">`);
  for (const st of ["active", "idle", "ghost"]) {
    if (statusCounts[st] > 0) {
      const val = `status:${st}`;
      filterOpts.push(`<option value="${val}"${currentFilter === val ? " selected" : ""}>${st[0].toUpperCase() + st.slice(1)} (${statusCounts[st]})</option>`);
    }
  }
  filterOpts.push(`</optgroup>`);
  if (projectMap.size > 1) {
    filterOpts.push(`<optgroup label="Project">`);
    for (const [cwd, count] of projectMap) {
      const val = `project:${cwd}`;
      const name = projectNameFromCwd(cwd);
      filterOpts.push(`<option value="${val}"${currentFilter === val ? " selected" : ""}>${name} (${count})</option>`);
    }
    filterOpts.push(`</optgroup>`);
  }

  // Sort options
  const sortOpts = [
    ["default", "Default"],
    ["context", "By context %"],
    ["duration", "By duration"],
    ["activity", "By last activity"],
    ["alphabetical", "Alphabetical"],
  ].map(([v, label]) => `<option value="${v}"${currentSort === v ? " selected" : ""}>${label}</option>`).join("");

  return `
    <div class="sessions-controls">
      <select class="session-select" data-type="filter" title="Filter sessions">${filterOpts.join("")}</select>
      <select class="session-select" data-type="sort" title="Sort sessions">${sortOpts}</select>
    </div>
  `;
}

async function renderLeftPanel() {
  const sessions = await invoke("list_sessions");
  const pending = await invoke("get_pending_permissions");

  const contexts = {};
  for (const s of sessions) {
    try {
      const ctx = await invoke("get_context", { sessionId: s.session_id });
      if (ctx) contexts[s.session_id] = ctx;
    } catch (_) {}
  }

  lastGhostCount = sessions.filter(s => refineStatus(s, contexts[s.session_id]) === "ghost").length;

  // Alert engine: check thresholds, fire notifications and auto-fire countdowns
  try { processAlerts(sessions, contexts); } catch (_) {}

  // Split pinned vs unpinned. Pinned are always visible (filter doesn't apply to them).
  const pinsSet = settings.sessionPins || new Set();
  const pinnedAll = sessions.filter(s => pinsSet.has(s.session_id));
  const unpinnedAll = sessions.filter(s => !pinsSet.has(s.session_id));

  // Filter applies only to unpinned
  const unpinnedFiltered = filterSessions(unpinnedAll, contexts, settings.filter);

  // Sort each group by the same sort preference
  const pinnedSorted = sortSessions(pinnedAll, contexts, settings.sort);
  const unpinnedSorted = sortSessions(unpinnedFiltered, contexts, settings.sort);

  const totalCount = sessions.length;
  const viewCount = pinnedSorted.length + unpinnedSorted.length;
  const headerText = viewCount < totalCount
    ? `SESSIONS (${viewCount} / ${totalCount})`
    : `SESSIONS (${totalCount})`;

  const controls = totalCount > 0
    ? renderSessionControls(sessions, contexts, settings.filter, settings.sort)
    : "";

  let html = `
    <div class="sessions-header">
      <span class="section-label">${headerText}</span>
      ${controls}
    </div>
  `;

  if (pending.length > 0) {
    html += `<div class="section-label section-label--warning">PENDING (${pending.length})</div>`;
    html += pending.map(renderPermission).join("");
  }

  if (totalCount === 0) {
    html += `<div class="empty-state">No active CLI sessions</div>`;
  } else if (viewCount === 0) {
    html += `<div class="empty-state">No sessions match current filter</div>`;
  } else {
    // Render pinned first with continuous numbering
    let idx = 0;
    if (pinnedSorted.length > 0) {
      html += pinnedSorted
        .map(s => { idx++; return renderSession(s, contexts[s.session_id], idx); })
        .join("");
      // Divider between pinned and unpinned only if both exist
      if (unpinnedSorted.length > 0) {
        html += `<div class="pinned-divider"></div>`;
      }
    }
    if (unpinnedSorted.length > 0) {
      html += unpinnedSorted
        .map(s => { idx++; return renderSession(s, contexts[s.session_id], idx); })
        .join("");
    }
  }

  return html;
}

// ---- RIGHT PANEL: Usage ----

function renderExtraUsage(extra) {
  if (!extra || !extra.is_enabled) return "";
  const rawUsed = extra.used_credits || 0;
  const rawLimit = extra.monthly_limit || 0;
  const used = (rawUsed / 100).toFixed(2);
  const limit = (rawLimit / 100).toFixed(2);
  return `
    <div class="extra-inline">
      <span class="extra-label">EXTRA USAGE</span>
      <span class="extra-value">${used} <span class="extra-sep">/</span> ${limit}</span>
    </div>
  `;
}

function metricBtn(id, label) {
  const active = currentMetric === id ? "active" : "";
  return `<button class="metric-btn ${active}" data-action="set-metric" data-metric="${id}">${label}</button>`;
}

function formatRelativeTime(ts) {
  if (!ts) return "";
  const age = Math.floor(Date.now() / 1000) - ts;
  if (age < 45) return "just now";
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  return `${Math.floor(age / 86400)}d ago`;
}

async function renderRightPanel() {
  try {
    const data = await invoke("get_usage");
    // Don't auto-call refresh_usage - Rust background loop handles it every 5min.
    // Avoids spamming API and exacerbating 429 rate limits.
    if (!data || !data.usage) {
      return `<div class="loading-state"><div class="spinner"></div><div class="loading-text">Loading usage...</div></div>`;
    }

    const usage = data.usage;
    let html = `<div class="section-label">USAGE</div>`;

    if (usage.five_hour) html += renderBar("Session (5h)", Math.round(usage.five_hour.utilization), formatTimeLeft(usage.five_hour.resets_at));
    if (usage.seven_day) html += renderBar("Weekly", Math.round(usage.seven_day.utilization), formatTimeLeft(usage.seven_day.resets_at));
    if (usage.seven_day_sonnet) html += renderBar("Sonnet (weekly)", Math.round(usage.seven_day_sonnet.utilization), formatTimeLeft(usage.seven_day_sonnet.resets_at));

    html += renderExtraUsage(usage.extra_usage);

    html += `
      <div class="settings-row">
        ${metricBtn("session", "5H")}
        ${metricBtn("weekly", "WEEK")}
        ${metricBtn("sonnet", "SONNET")}
      </div>
    `;

    // Staleness indicator
    if (data.fetched_at) {
      const rel = formatRelativeTime(data.fetched_at);
      const ageSecs = Math.floor(Date.now() / 1000) - data.fetched_at;
      const isStale = ageSecs > 600; // > 10 min
      html += `<div class="usage-age${isStale ? ' stale' : ''}">Updated ${rel}</div>`;
    }

    return html;
  } catch (err) {
    return `<div class="empty-state">Usage unavailable</div>`;
  }
}

// ---- SETTINGS VIEW ----

function renderToggle(key, checked) {
  return `
    <label class="toggle">
      <input type="checkbox" ${checked ? "checked" : ""} data-action="toggle" data-key="${key}">
      <span class="toggle-slider"></span>
    </label>
  `;
}

function renderThemeOption(id, label) {
  const checked = settings.theme === id ? "checked" : "";
  return `
    <label class="theme-option" data-action="set-theme" data-theme="${id}">
      <input type="radio" name="theme" value="${id}" ${checked}>
      <span class="theme-option-label">${label}</span>
    </label>`;
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

async function renderBehaviorTab() {
  let isAutostart = false;
  try { isAutostart = await invoke("get_autostart"); } catch (_) {}

  return `
    <div class="settings-group">
      <div class="settings-group-label">WINDOW BEHAVIOR</div>
      <div class="settings-card">
        <div class="settings-item">
          <span class="settings-item-label">Always on top</span>
          ${renderToggle("alwaysOnTop", settings.alwaysOnTop)}
        </div>
        <div class="settings-item">
          <span class="settings-item-label">Auto-hide on blur</span>
          ${renderToggle("autoHide", settings.autoHide)}
        </div>
        <div class="settings-item">
          <span class="settings-item-label">Start with Windows</span>
          ${renderToggle("autostart", isAutostart)}
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

function renderAlertsTab() {
  const rows = settings.presets.map(renderPresetRow).join("");
  return `
    <div class="settings-group">
      <div class="settings-group-label">ALERT PRESETS</div>
      <div class="settings-card">
        ${rows}
        <div class="settings-item settings-item-action">
          <button class="btn btn-secondary" data-action="add-preset">+ New preset</button>
        </div>
      </div>
      <div class="settings-group-hint">&#9733; = default preset (applies to sessions without specific assignment)</div>
    </div>
  `;
}

function renderPresetRow(preset) {
  const leftIcon = preset.isDefault
    ? `<span class="preset-default-star" title="Default preset">&#9733;</span>`
    : `<button class="preset-default-btn" data-action="set-default-preset" data-preset-id="${preset.id}" title="Set as default">&#9734;</button>`;

  const limitDisplay = formatTokenDisplay(preset.limitTokens);
  const pcts = preset.thresholds.map(t => Math.round((t.tokens / preset.limitTokens) * 100));
  const thresholdSummary = `${pcts[0]}/${pcts[1]}/${pcts[2]}%`;
  const builtinTag = preset.builtin ? ` <span class="tag-builtin">built-in</span>` : "";

  const deleteBtn = preset.isDefault
    ? ""
    : `<button class="action-icon-btn dismiss-icon-btn" data-action="delete-preset" data-preset-id="${preset.id}" title="Delete">&#x2715;</button>`;

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
        <button class="action-icon-btn" data-action="edit-preset" data-preset-id="${preset.id}" title="Edit">&#9998;</button>
        ${deleteBtn}
      </div>
    </div>
  `;
}

function renderPresetEditorBody(preset) {
  const limitVal = preset.limitTokens || 250000;
  const limitDisplayStr = formatTokenDisplay(limitVal);

  const commandOptions = (selectedId) => {
    const noneOpt = `<option value=""${!selectedId ? ' selected' : ''}>None (no command)</option>`;
    const cmdOpts = settings.customCommands.map(c =>
      `<option value="${escapeHtml(c.id)}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join("");
    return noneOpt + cmdOpts;
  };

  const tierLabels = ["WARNING", "PRE-CRITICAL", "CRITICAL"];
  const thresholds = (preset.thresholds && preset.thresholds.length === 3)
    ? preset.thresholds
    : [
        { tokens: Math.round(limitVal * 0.70), commandId: null, notify: true },
        { tokens: Math.round(limitVal * 0.85), commandId: null, notify: true },
        { tokens: Math.round(limitVal * 0.95), commandId: "compact", notify: true },
      ];

  const thresholdBlocks = thresholds.map((t, i) => {
    const pct = limitVal > 0 ? Math.round((t.tokens / limitVal) * 100) : 0;
    const tokenStr = formatTokenDisplay(t.tokens);
    return `
      <div class="threshold-block">
        <div class="threshold-header">THRESHOLD ${i + 1} &middot; ${tierLabels[i]}</div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">Tokens</label>
            <input class="field-input threshold-tokens" type="text" data-tier="${i}" value="${escapeHtml(tokenStr)}" placeholder="e.g. 175K" />
            <span class="field-hint"><span class="threshold-pct" data-tier="${i}">${pct}%</span> of limit</span>
          </div>
          <div class="field">
            <label class="field-label">Run command</label>
            <select class="field-input threshold-command" data-tier="${i}">
              ${commandOptions(t.commandId)}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-inline">
            <input type="checkbox" class="threshold-notify" data-tier="${i}" ${t.notify ? 'checked' : ''} />
            <span>System notification when crossed</span>
          </label>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="field-row">
      <div class="field" style="flex: 1;">
        <label class="field-label">Name</label>
        <input class="field-input" type="text" id="preset-name" value="${escapeHtml(preset.name || "")}" placeholder="e.g. Architect" />
      </div>
      <div class="field" style="flex: 1;">
        <label class="field-label">Token limit (100%)</label>
        <input class="field-input" type="text" id="preset-limit" value="${escapeHtml(limitDisplayStr)}" placeholder="e.g. 250K, 450000" />
        <span class="field-hint">Absolute tokens (K/M shorthand ok)</span>
      </div>
    </div>
    <div class="threshold-section">
      ${thresholdBlocks}
    </div>
  `;
}

function openPresetEditor(preset) {
  const isEdit = !!preset.id;
  const title = isEdit ? "Edit preset" : "New preset";
  const deleteBtn = (isEdit && !preset.isDefault)
    ? `<button class="btn btn-danger" data-action="delete-preset-from-editor" data-preset-id="${preset.id}">Delete</button>`
    : "";
  const actions = `
    ${deleteBtn}
    <div style="flex:1"></div>
    <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
    <button class="btn btn-primary" data-action="save-preset" data-preset-id="${preset.id || ''}">Save</button>
  `;
  openModal("preset-editor", {
    title,
    body: renderPresetEditorBody(preset),
    actions,
  });
}

function recomputePresetPercents() {
  const limitEl = document.getElementById("preset-limit");
  if (!limitEl) return;
  const limit = parseTokenInput(limitEl.value);
  for (let i = 0; i < 3; i++) {
    const tokenEl = document.querySelector(`.threshold-tokens[data-tier="${i}"]`);
    const pctEl = document.querySelector(`.threshold-pct[data-tier="${i}"]`);
    if (!tokenEl || !pctEl) continue;
    const tokens = parseTokenInput(tokenEl.value);
    if (!limit || !tokens) { pctEl.textContent = "?%"; continue; }
    pctEl.textContent = `${Math.round((tokens / limit) * 100)}%`;
  }
}

function savePresetFromEditor(editingId) {
  const nameEl = document.getElementById("preset-name");
  const limitEl = document.getElementById("preset-limit");
  if (!nameEl || !limitEl) return;

  const name = nameEl.value.trim();
  const limitTokens = parseTokenInput(limitEl.value);

  if (!name) { showToast({ type: "error", message: "Name is required", duration: 2000 }); return; }
  if (!limitTokens || limitTokens < 1000) {
    showToast({ type: "error", message: "Invalid token limit (min 1000)", duration: 2500 });
    return;
  }

  const thresholds = [];
  for (let i = 0; i < 3; i++) {
    const tokenEl = document.querySelector(`.threshold-tokens[data-tier="${i}"]`);
    const cmdEl = document.querySelector(`.threshold-command[data-tier="${i}"]`);
    const notifyEl = document.querySelector(`.threshold-notify[data-tier="${i}"]`);
    if (!tokenEl || !cmdEl) return;
    const tokens = parseTokenInput(tokenEl.value);
    if (!tokens || tokens < 1) {
      showToast({ type: "error", message: `Invalid tokens for threshold ${i + 1}`, duration: 2500 });
      return;
    }
    const commandId = cmdEl.value || null;
    const notify = !!(notifyEl && notifyEl.checked);
    thresholds.push({ tokens, commandId, notify });
  }

  // Enforce monotonic order T1 <= T2 <= T3
  for (let i = 1; i < thresholds.length; i++) {
    if (thresholds[i].tokens < thresholds[i - 1].tokens) {
      showToast({ type: "error", message: "Thresholds must ascend (T1 <= T2 <= T3)", duration: 3000 });
      return;
    }
  }

  if (editingId) {
    const idx = settings.presets.findIndex(p => p.id === editingId);
    if (idx >= 0) {
      settings.presets[idx] = {
        ...settings.presets[idx],
        name,
        limitTokens,
        thresholds,
      };
    }
  } else {
    const id = `preset-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    settings.presets.push({
      id,
      name,
      limitTokens,
      thresholds,
      isDefault: false,
      builtin: false,
    });
  }
  savePresets();
  closeModal();
  render();
  showToast({ type: "info", message: editingId ? "Preset updated" : "Preset created", duration: 1800 });
}

function deletePresetById(id) {
  const preset = settings.presets.find(p => p.id === id);
  if (!preset) return;
  if (preset.isDefault) {
    showToast({ type: "error", message: "Cannot delete default preset. Set another as default first.", duration: 3000 });
    return;
  }
  settings.presets = settings.presets.filter(p => p.id !== id);
  savePresets();
  closeModal();
  render();
  showToast({ type: "info", message: `Deleted '${preset.name}'`, duration: 1800 });
}

function setDefaultPreset(id) {
  const target = settings.presets.find(p => p.id === id);
  if (!target) return;
  settings.presets.forEach(p => { p.isDefault = (p.id === id); });
  savePresets();
  render();
  showToast({ type: "info", message: `'${target.name}' set as default`, duration: 1800 });
}

// ---- SESSION CARD POPOVERS (Phase 4) ----

function renderPresetPickerBody(sessionId, sessionName) {
  const current = resolvePreset(sessionId);
  const assignedId = (settings.sessionPresets && settings.sessionPresets[sessionId]) || "";
  const effectiveIsDefault = !assignedId && current && current.isDefault;

  const presetOptions = settings.presets.map(p => {
    const defaultTag = p.isDefault ? " (default)" : "";
    const selected = (assignedId === p.id) || (effectiveIsDefault && p.isDefault);
    return `<option value="${escapeHtml(p.id)}"${selected ? ' selected' : ''}>${escapeHtml(p.name)}${defaultTag}</option>`;
  }).join("");

  let thresholdRows = "";
  if (current) {
    const tierLabels = ["Warning", "Pre-crit", "Critical"];
    thresholdRows = current.thresholds.map((t, i) => {
      const pct = current.limitTokens > 0 ? Math.round((t.tokens / current.limitTokens) * 100) : 0;
      const cmd = t.commandId ? settings.customCommands.find(c => c.id === t.commandId) : null;
      const cmdLine = cmd
        ? `<div class="popover-cmd-line">&rarr; ${escapeHtml(cmd.name)}</div>`
        : "";
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

  return `
    <div class="popover-header">
      <span class="popover-title">Alerts &middot; ${escapeHtml(sessionName)}</span>
    </div>
    <div class="popover-field">
      <label class="popover-label">Preset</label>
      <select class="field-input popover-preset-select" data-session-id="${escapeHtml(sessionId)}">
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
        <input type="checkbox" class="popover-auto-compact" data-session-id="${escapeHtml(sessionId)}" ${(settings.sessionAutoCompact && settings.sessionAutoCompact[sessionId]) ? 'checked' : ''} />
        <span>Allow auto-compact on this session</span>
      </label>
      <div class="popover-hint">Off by default. When off, /compact auto-fire is blocked even if configured in preset. Other commands (Crystallize, etc.) still fire normally.</div>
    </div>
    <div class="popover-footer">
      <button class="btn btn-secondary btn-sm" data-action="go-to-alerts">Manage presets</button>
    </div>
  `;
}

function renderSendMenuBody(sessionId, pid, sessionName) {
  const commands = settings.customCommands || [];
  if (commands.length === 0) {
    return `
      <div class="popover-header">
        <span class="popover-title">Send &middot; ${escapeHtml(sessionName)}</span>
      </div>
      <div class="popover-empty">No commands. Add one in Settings &rarr; Commands.</div>
    `;
  }

  const items = commands.map(c => {
    const confirmTag = c.confirm ? ` <span class="tag-confirm">confirm</span>` : "";
    const preview = c.text.length > 50 ? c.text.slice(0, 50) + "..." : c.text;
    const previewOneLine = preview.replace(/\n/g, " \u21B5 ");
    return `
      <button class="popover-send-item" data-action="send-from-menu" data-command-id="${escapeHtml(c.id)}" data-pid="${pid}" data-session-name="${escapeHtml(sessionName)}">
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

async function performSendCommand(commandId, pid, sessionName) {
  const cmd = settings.customCommands.find(c => c.id === commandId);
  if (!cmd) {
    console.warn("[Pulse send] command not found:", commandId);
    showToast({ type: "error", message: "Command not found", duration: 2000 });
    return;
  }
  const pidNum = parseInt(pid);
  console.log(`[Pulse send] invoking send_command pid=${pidNum} cmd="${cmd.name}" text=${JSON.stringify(cmd.text)}`);
  try {
    const result = await invoke("send_command", { pid: pidNum, text: cmd.text });
    console.log(`[Pulse send] result for pid=${pidNum}:\n${result}`);
    showToast({ type: "info", message: `Sent '${cmd.name}' to ${sessionName}`, duration: 2500 });
  } catch (err) {
    console.error(`[Pulse send] FAILED for pid=${pidNum}:`, err);
    showToast({ type: "error", message: `Failed: ${err}`, duration: 6000 });
  }
}

// ---- ALERT ENGINE (Phase 5) ----

// Given current ctx + preset, return highest crossed tier or null ("t1"/"t2"/"t3")
function getAlertState(ctx, preset) {
  if (!ctx || !preset || !preset.thresholds || preset.thresholds.length < 3) return null;
  const tokens = ctx.used_tokens || 0;
  if (tokens >= preset.thresholds[2].tokens) return "t3";
  if (tokens >= preset.thresholds[1].tokens) return "t2";
  if (tokens >= preset.thresholds[0].tokens) return "t1";
  return null;
}

// Countdown toasts currently active (by `${sessionId}|${tierKey}`) so we don't stack duplicates
const activeCountdowns = {};

function processAlerts(sessions, contexts) {
  for (const session of sessions) {
    const ctx = contexts[session.session_id];
    if (!ctx) continue;

    const preset = resolvePreset(session.session_id);
    if (!preset || !preset.thresholds) continue;

    const sid = session.session_id;
    if (!firedThresholds[sid]) firedThresholds[sid] = { t1: false, t2: false, t3: false };

    const tierKeys = ["t1", "t2", "t3"];
    preset.thresholds.forEach((t, idx) => {
      const tierKey = tierKeys[idx];
      const crossed = (ctx.used_tokens || 0) >= t.tokens;
      const fired = firedThresholds[sid][tierKey];

      if (crossed && !fired) {
        firedThresholds[sid][tierKey] = true;
        if (t.notify) {
          fireSystemNotification(session, ctx, idx, preset);
        }
        if (t.commandId) {
          const cmd = settings.customCommands.find(c => c.id === t.commandId);
          const isCompact = isCompactCommand(cmd);
          const autoCompactAllowed = !!(settings.sessionAutoCompact && settings.sessionAutoCompact[sid]);
          if (isCompact && !autoCompactAllowed) {
            // Safety gate: auto-compact blocked for this session
            showToast({
              type: "warning",
              message: `'${session.name}' at ${["warning","pre-critical","critical"][idx]}: /compact suppressed (toggle in \u2699)`,
              duration: 3500,
            });
          } else {
            startAutoFireCountdown(session, t.commandId, idx);
          }
        }
      } else if (!crossed && fired) {
        // Hysteresis reset: tokens dropped below (e.g. after compact)
        firedThresholds[sid][tierKey] = false;
      }
    });
  }
}

function startAutoFireCountdown(session, commandId, tierIdx) {
  const cmd = settings.customCommands.find(c => c.id === commandId);
  if (!cmd) return;

  const key = `${session.session_id}|t${tierIdx + 1}`;
  if (activeCountdowns[key]) return; // already counting down for this tier

  const tierName = ["Warning", "Pre-critical", "Critical"][tierIdx];
  const toastId = showToast({
    type: "countdown",
    message: `${tierName}: firing '${cmd.name}' on ${session.name} in 10s`,
    duration: 10000,
    countdown: true,
    cancellable: true,
    onComplete: async () => {
      delete activeCountdowns[key];
      try {
        await invoke("send_command", { pid: parseInt(session.pid), text: cmd.text });
        showToast({ type: "info", message: `Auto-fired '${cmd.name}' on ${session.name}`, duration: 3500 });
      } catch (err) {
        showToast({ type: "error", message: `Auto-fire failed: ${err}`, duration: 4500 });
      }
    },
    onCancel: () => {
      delete activeCountdowns[key];
      showToast({ type: "info", message: `Auto-fire cancelled for '${cmd.name}'`, duration: 2000 });
    },
  });
  activeCountdowns[key] = toastId;
}

function fireSystemNotification(session, ctx, tierIdx, preset) {
  const tierName = ["warning", "pre-critical", "critical"][tierIdx];
  const pct = preset.limitTokens > 0
    ? Math.round(((ctx.used_tokens || 0) / preset.limitTokens) * 100)
    : 0;
  const title = `${session.name} at ${tierName}`;
  const body = `${formatTokenDisplay(ctx.used_tokens || 0)} / ${formatTokenDisplay(preset.limitTokens)} (${pct}%)`;
  invoke("fire_threshold_notification", { title, body }).catch(() => {});
}

function dispatchCommandToSession(commandId, pid, sessionName) {
  const cmd = settings.customCommands.find(c => c.id === commandId);
  if (!cmd) {
    showToast({ type: "error", message: "Command not found", duration: 2000 });
    return;
  }

  closePopover();

  if (cmd.confirm) {
    openModal("send-confirm", {
      title: "Confirm send",
      body: `
        <div>Send <strong>${escapeHtml(cmd.name)}</strong> to <strong>${escapeHtml(sessionName)}</strong>?</div>
        <pre class="send-confirm-preview">${escapeHtml(cmd.text)}</pre>
      `,
      actions: `
        <div style="flex:1"></div>
        <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="send-confirmed" data-command-id="${escapeHtml(commandId)}" data-pid="${pid}" data-session-name="${escapeHtml(sessionName)}">Send</button>
      `,
    });
  } else {
    performSendCommand(commandId, pid, sessionName);
  }
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCommandRow(cmd) {
  const preview = cmd.text.length > 60 ? cmd.text.slice(0, 60) + "..." : cmd.text;
  const previewOneLine = preview.replace(/\n/g, " \u21B5 ");
  const builtinTag = cmd.builtin ? ` <span class="tag-builtin">built-in</span>` : "";
  const confirmTag = cmd.confirm ? ` <span class="tag-confirm">confirm</span>` : "";
  const deleteBtn = cmd.builtin
    ? ""
    : `<button class="action-icon-btn dismiss-icon-btn" data-action="delete-command" data-command-id="${cmd.id}" title="Delete">&#x2715;</button>`;
  return `
    <div class="settings-item cmd-row">
      <div class="cmd-info">
        <div class="cmd-name-row">
          <span class="cmd-name">${escapeHtml(cmd.name)}</span>${builtinTag}${confirmTag}
        </div>
        <div class="cmd-preview">${escapeHtml(previewOneLine)}</div>
      </div>
      <div class="cmd-actions">
        <button class="action-icon-btn" data-action="edit-command" data-command-id="${cmd.id}" title="Edit">&#9998;</button>
        ${deleteBtn}
      </div>
    </div>
  `;
}

function renderCommandsTab() {
  const rows = settings.customCommands.map(renderCommandRow).join("");
  return `
    <div class="settings-group">
      <div class="settings-group-label">CUSTOM COMMANDS</div>
      <div class="settings-card">
        ${rows}
        <div class="settings-item settings-item-action">
          <button class="btn btn-secondary" data-action="add-command">+ New command</button>
        </div>
      </div>
    </div>
  `;
}

function renderCommandEditorBody(cmd) {
  return `
    <div class="field">
      <label class="field-label">Name</label>
      <input class="field-input" type="text" id="cmd-name" value="${escapeHtml(cmd.name || "")}" placeholder="e.g., Crystallize" />
    </div>
    <div class="field">
      <label class="field-label">Text to send</label>
      <textarea class="field-textarea" id="cmd-text" rows="6" placeholder="/compact, or a natural language message">${escapeHtml(cmd.text || "")}</textarea>
      <span class="field-hint">Slash command or natural language. Multi-line supported.</span>
    </div>
    <div class="field">
      <label class="field-inline">
        <input type="checkbox" id="cmd-confirm" ${cmd.confirm ? 'checked' : ''} />
        <span>Confirm before sending</span>
      </label>
    </div>
  `;
}

function openCommandEditor(cmd) {
  const isEdit = !!cmd.id;
  const isBuiltin = cmd.builtin === true;
  const title = isEdit ? "Edit command" : "New command";
  const actions = `
    ${isEdit && !isBuiltin ? `<button class="btn btn-danger" data-action="delete-command-from-editor" data-command-id="${cmd.id}">Delete</button>` : ""}
    <div style="flex:1"></div>
    <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
    <button class="btn btn-primary" data-action="save-command" data-command-id="${cmd.id || ''}">Save</button>
  `;
  openModal("command-editor", {
    title,
    body: renderCommandEditorBody(cmd),
    actions,
  });
}

function saveCommandFromEditor(editingId) {
  const nameEl = document.getElementById("cmd-name");
  const textEl = document.getElementById("cmd-text");
  const confirmEl = document.getElementById("cmd-confirm");
  if (!nameEl || !textEl) return;

  const name = nameEl.value.trim();
  const text = textEl.value;
  const confirm = !!(confirmEl && confirmEl.checked);

  if (!name) { showToast({ type: "error", message: "Name is required", duration: 2000 }); return; }
  if (!text.trim()) { showToast({ type: "error", message: "Text is required", duration: 2000 }); return; }

  if (editingId) {
    const idx = settings.customCommands.findIndex(c => c.id === editingId);
    if (idx >= 0) {
      settings.customCommands[idx] = {
        ...settings.customCommands[idx],
        name,
        text,
        confirm,
      };
    }
  } else {
    const id = `cmd-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    settings.customCommands.push({ id, name, text, confirm, builtin: false });
  }
  saveCustomCommands();
  closeModal();
  showToast({ type: "info", message: editingId ? "Command updated" : "Command created", duration: 1800 });
}

function deleteCommandById(id) {
  const cmd = settings.customCommands.find(c => c.id === id);
  if (!cmd) return;
  if (cmd.builtin) { showToast({ type: "error", message: "Cannot delete built-in command", duration: 2000 }); return; }
  settings.customCommands = settings.customCommands.filter(c => c.id !== id);
  saveCustomCommands();
  closeModal();
  render();
  showToast({ type: "info", message: `Deleted '${cmd.name}'`, duration: 1800 });
}

function renderAboutTab(appVersion) {
  return `
    <div class="settings-group">
      <div class="settings-group-label">ABOUT</div>
      <div class="settings-card">
        <div class="settings-about">
          Auralis Pulse v${appVersion}<br>
          <a href="https://github.com/antonpme/auralis-pulse" target="_blank">github.com/antonpme/auralis-pulse</a>
        </div>
      </div>
    </div>
  `;
}

async function renderSettingsView() {
  let appVersion = "";
  try { appVersion = await invoke("get_version"); } catch (_) {}

  const tabs = [
    ["appearance", "Appearance"],
    ["behavior", "Behavior"],
    ["alerts", "Alerts"],
    ["commands", "Commands"],
    ["about", "About"],
  ];

  let content = "";
  switch (activeSettingsTab) {
    case "appearance": content = renderAppearanceTab(); break;
    case "behavior": content = await renderBehaviorTab(); break;
    case "alerts": content = renderAlertsTab(); break;
    case "commands": content = renderCommandsTab(); break;
    case "about": content = renderAboutTab(appVersion); break;
    default: content = renderAppearanceTab();
  }

  return `
    <div class="settings-header">
      <button class="settings-back-btn" data-action="back">&larr; BACK</button>
      <span class="settings-title">SETTINGS</span>
      <span></span>
    </div>
    <div class="settings-tabs">
      ${tabs.map(([id, label]) =>
        `<button class="settings-tab ${activeSettingsTab === id ? 'active' : ''}" data-action="set-settings-tab" data-tab="${id}">${label}</button>`
      ).join("")}
    </div>
    <div class="settings-view">
      ${content}
    </div>
  `;
}

// ---- OVERLAYS: Modal, Popover, Toast ----

function renderModal() {
  if (!activeModal) return "";
  const title = activeModal.data?.title || "";
  const body = activeModal.data?.body || "";
  const actions = activeModal.data?.actions || `
    <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
  `;
  return `
    <div class="modal-backdrop" data-action="modal-backdrop-click">
      <div class="modal-card">
        <div class="modal-header">
          <span class="modal-title">${title}</span>
          <button class="modal-close" data-action="close-modal" title="Close">&#x2715;</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">${actions}</div>
      </div>
    </div>
  `;
}

function renderPopover() {
  if (!activePopover) return "";
  const { anchorRect, type, data } = activePopover;
  const right = Math.max(4, window.innerWidth - anchorRect.right);

  let body = "";
  if (type === "session-preset") {
    body = renderPresetPickerBody(data.sessionId, data.name);
  } else if (type === "session-send") {
    body = renderSendMenuBody(data.sessionId, data.pid, data.name);
  } else {
    body = (data && data.body) || "";
  }

  // Estimate popover height for overflow detection
  let estHeight = 240;
  if (type === "session-send") {
    const cmdCount = (settings.customCommands || []).length;
    estHeight = 52 + Math.max(cmdCount, 1) * 48 + 12; // header + items + padding
  } else if (type === "session-preset") {
    estHeight = 230;
  }

  // Flip up if bottom would overflow and there's more room above
  const spaceBelow = window.innerHeight - anchorRect.bottom - 8;
  const spaceAbove = anchorRect.top - 8;
  const flipUp = (estHeight > spaceBelow) && (spaceAbove > spaceBelow);

  let positionStyle;
  if (flipUp) {
    const bottom = Math.max(4, window.innerHeight - anchorRect.top + 4);
    const maxH = Math.max(120, spaceAbove);
    positionStyle = `bottom: ${bottom}px; right: ${right}px; max-height: ${maxH}px;`;
  } else {
    const top = anchorRect.bottom + 4;
    const maxH = Math.max(120, spaceBelow);
    positionStyle = `top: ${top}px; right: ${right}px; max-height: ${maxH}px;`;
  }

  return `
    <div class="popover" style="${positionStyle}">
      <div class="popover-body">${body}</div>
    </div>
  `;
}

function renderToasts() {
  if (!toasts.length) return "";
  const now = Date.now();
  return `
    <div class="toast-container">
      ${toasts.map(t => {
        // Use negative animation-delay so re-renders don't restart the countdown bar
        const elapsed = Math.max(0, now - (t.createdAt || now));
        const countdownBar = t.countdown
          ? `<div class="toast-countdown-bar"><div class="toast-countdown-fill" style="animation: countdown ${t.duration}ms linear forwards; animation-delay: -${elapsed}ms;"></div></div>`
          : "";
        const cancelBtn = t.cancellable
          ? `<button class="toast-cancel" data-action="cancel-toast" data-toast-id="${t.id}">Cancel</button>`
          : "";
        return `
          <div class="toast toast-${t.type || 'info'}" data-toast-id="${t.id}">
            <div class="toast-content">
              <span class="toast-message">${t.message}</span>
              ${cancelBtn}
            </div>
            ${countdownBar}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function showToast(opts) {
  const { type = "info", message, duration = 3000, cancellable = false, countdown = false, onComplete, onCancel } = opts;
  const id = ++toastCounter;
  const toast = { id, type, message, duration, cancellable, countdown, onComplete, onCancel, timer: null, cancelled: false, createdAt: Date.now() };
  toasts.push(toast);
  if (duration > 0) {
    toast.timer = setTimeout(() => {
      if (toast.cancelled) return;
      if (onComplete) onComplete();
      dismissToast(id);
    }, duration);
  }
  render();
  return id;
}

function dismissToast(id) {
  toasts = toasts.filter(t => t.id !== id);
  render();
}

function cancelToast(id) {
  const toast = toasts.find(t => t.id === id);
  if (!toast) return;
  toast.cancelled = true;
  if (toast.timer) clearTimeout(toast.timer);
  if (toast.onCancel) toast.onCancel();
  dismissToast(id);
}

function openModal(type, data) {
  activeModal = { type, data: data || {} };
  render();
}

function closeModal() {
  activeModal = null;
  render();
}

function openPopover(type, anchorEl, data) {
  const rect = anchorEl.getBoundingClientRect();
  activePopover = { type, anchorRect: rect, data: data || {} };
  render();
}

function closePopover() {
  activePopover = null;
  render();
}

// ---- RENDER ----

async function render() {
  if (renderLock) return;
  renderLock = true;
  try {
    let mainHtml;
    if (currentView === "settings") {
      mainHtml = await renderSettingsView();
    } else {
      const [leftHtml, rightHtml] = await Promise.all([renderLeftPanel(), renderRightPanel()]);

      let usageTier = "";
      let appVersion = "";
      try {
        const data = await invoke("get_usage");
        if (data && data.tier) usageTier = formatTier(data.tier);
      } catch (_) {}
      try { appVersion = await invoke("get_version"); } catch (_) {}

      mainHtml = `
        <div class="header">
          <div class="header-left">
            <div class="header-title-row">
              <h1>AURALIS PULSE</h1>
              ${usageTier ? `<span class="tier-label">${usageTier}</span>` : ""}
            </div>
            <span class="header-subtitle">COMPANION FOR CLAUDE CODE${appVersion ? ` · v${appVersion}` : ""}</span>
          </div>
          <div class="header-right">
              <button class="header-icon-btn" data-action="open-settings" title="Settings">&#x2699;</button>
            <button class="refresh-icon-btn" data-action="refresh" title="Refresh all">&#x21bb;</button>
          </div>
        </div>
        <div class="split-container">
          <div class="panel-left">${leftHtml}</div>
          <div class="panel-right">${rightHtml}</div>
        </div>
      `;
    }

    // Overlays layer on top of main content regardless of view
    app.innerHTML = mainHtml + renderModal() + renderPopover() + renderToasts();
  } catch (err) {
    app.innerHTML = `<div class="loading-state"><div class="spinner"></div><div class="loading-text">Loading...</div></div>`;
  } finally {
    renderLock = false;
  }
}

// ---- EVENTS ----
listen("permission-request", () => { if (currentView === "main") render(); });
listen("sessions-updated", () => { if (currentView === "main") render(); });
listen("usage-updated", () => { if (currentView === "main") render(); });
listen("open-settings", () => { currentView = "settings"; render(); });

render();
setInterval(() => { if (currentView === "main") render(); }, 15000);

// ---- EVENT DELEGATION ----
document.addEventListener("click", async (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  const pid = target.dataset.pid ? parseInt(target.dataset.pid) : null;

  // Permission
  if (action === "perm" && target.dataset.id) {
    const id = target.dataset.id;
    const decision = target.dataset.decision;
    target.disabled = true;
    target.textContent = "...";
    try { await invoke("respond_permission", { id, decision }); render(); }
    catch (err) { target.disabled = false; }
    return;
  }

  // Session actions
  if (action === "compact" && pid) {
    const original = target.innerHTML;
    target.disabled = true;
    target.textContent = "...";
    try {
      await invoke("trigger_compact", { pid });
      target.textContent = "\u2713";
      setTimeout(() => { target.innerHTML = original; target.disabled = false; }, 2000);
    } catch (err) {
      target.textContent = "!";
      setTimeout(() => { target.innerHTML = original; target.disabled = false; }, 2000);
    }
    return;
  }

  if (action === "dismiss" && pid) {
    target.disabled = true;
    target.textContent = "...";
    try { await invoke("dismiss_session", { pid }); render(); }
    catch (err) { target.textContent = "!"; setTimeout(() => render(), 2000); }
    return;
  }

  if (action === "clean-ghosts") {
    target.disabled = true;
    target.textContent = "...";
    try {
      const count = await invoke("clean_ghost_sessions");
      target.textContent = count > 0 ? `${count} REMOVED` : "NONE";
      setTimeout(() => render(), 1000);
    } catch (err) { target.textContent = "FAIL"; setTimeout(() => render(), 2000); }
    return;
  }

  if (action === "refresh") {
    try { await invoke("refresh_usage"); } catch (_) {}
    render();
    return;
  }

  // Navigation
  if (action === "open-settings") { currentView = "settings"; render(); return; }
  if (action === "back") { currentView = "main"; render(); return; }

  // Settings tabs
  if (action === "set-settings-tab") {
    activeSettingsTab = target.dataset.tab;
    render();
    return;
  }

  // Theme (handled via change event on radio)
  if (action === "set-theme") {
    applyTheme(target.dataset.theme);
    render();
    return;
  }

  // Metric
  if (action === "set-metric") {
    currentMetric = target.dataset.metric;
    localStorage.setItem("pulse-tray-metric", currentMetric);
    try { await invoke("set_tray_metric", { metric: currentMetric }); } catch (_) {}
    render();
    return;
  }

  // Modal
  if (action === "close-modal") { closeModal(); return; }
  if (action === "modal-backdrop-click") {
    // Only close if click was directly on backdrop (not bubbled from card)
    if (e.target === target) { closeModal(); }
    return;
  }

  // Toast
  if (action === "cancel-toast") {
    const id = parseInt(target.dataset.toastId);
    if (!isNaN(id)) cancelToast(id);
    return;
  }

  // Custom Commands CRUD
  if (action === "add-command") {
    openCommandEditor({ name: "", text: "", confirm: false });
    return;
  }
  if (action === "edit-command") {
    const cmd = settings.customCommands.find(c => c.id === target.dataset.commandId);
    if (cmd) openCommandEditor(cmd);
    return;
  }
  if (action === "save-command") {
    saveCommandFromEditor(target.dataset.commandId || null);
    return;
  }
  if (action === "delete-command" || action === "delete-command-from-editor") {
    deleteCommandById(target.dataset.commandId);
    return;
  }

  // Alert Presets CRUD
  if (action === "add-preset") {
    openPresetEditor({
      name: "",
      limitTokens: 250000,
      thresholds: [
        { tokens: 175000, commandId: null, notify: true },
        { tokens: 212500, commandId: null, notify: true },
        { tokens: 237500, commandId: "compact", notify: true },
      ],
    });
    return;
  }
  if (action === "edit-preset") {
    const preset = settings.presets.find(p => p.id === target.dataset.presetId);
    if (preset) openPresetEditor(preset);
    return;
  }
  if (action === "save-preset") {
    savePresetFromEditor(target.dataset.presetId || null);
    return;
  }
  if (action === "delete-preset" || action === "delete-preset-from-editor") {
    deletePresetById(target.dataset.presetId);
    return;
  }
  if (action === "set-default-preset") {
    setDefaultPreset(target.dataset.presetId);
    return;
  }

  // Session card popovers (Phase 4)
  if (action === "open-preset-popover") {
    const sessionId = target.dataset.sessionId;
    const name = target.dataset.name || "session";
    if (activePopover && activePopover.type === "session-preset" && activePopover.data?.sessionId === sessionId) {
      closePopover();
    } else {
      openPopover("session-preset", target, { sessionId, name });
    }
    return;
  }
  if (action === "open-send-popover") {
    const sessionId = target.dataset.sessionId;
    const pid = target.dataset.pid;
    const name = target.dataset.name || "session";
    if (activePopover && activePopover.type === "session-send" && activePopover.data?.sessionId === sessionId) {
      closePopover();
    } else {
      openPopover("session-send", target, { sessionId, pid, name });
    }
    return;
  }
  if (action === "send-from-menu") {
    const commandId = target.dataset.commandId;
    const pid = target.dataset.pid;
    const sessionName = target.dataset.sessionName || "session";
    dispatchCommandToSession(commandId, pid, sessionName);
    return;
  }
  if (action === "send-confirmed") {
    const commandId = target.dataset.commandId;
    const pid = target.dataset.pid;
    const sessionName = target.dataset.sessionName || "session";
    closeModal();
    performSendCommand(commandId, pid, sessionName);
    return;
  }
  if (action === "go-to-alerts") {
    closePopover();
    activeSettingsTab = "alerts";
    currentView = "settings";
    render();
    return;
  }

  // Pin/unpin session
  if (action === "toggle-pin") {
    const sessionId = target.dataset.sessionId;
    if (sessionId) togglePin(sessionId);
    return;
  }
});

// Live percent updates in preset editor (recompute when limit or threshold tokens change)
document.addEventListener("input", (e) => {
  if (!activeModal || activeModal.type !== "preset-editor") return;
  const tgt = e.target;
  if (!tgt || !tgt.classList) return;
  if (tgt.classList.contains("threshold-tokens") || tgt.id === "preset-limit") {
    recomputePresetPercents();
  }
});

// Click-outside handler for popover
document.addEventListener("click", (e) => {
  if (!activePopover) return;
  const popoverEl = e.target.closest(".popover");
  // If click landed inside popover, keep open
  if (popoverEl) return;
  // If click was on any popover trigger (data-action ending in "-popover"), the opener handles toggle
  if (e.target.closest("[data-action$='-popover']")) return;
  closePopover();
});

// Change events (toggles + radio + session selects)
document.addEventListener("change", async (e) => {
  // Theme radio
  if (e.target.name === "theme") {
    applyTheme(e.target.value);
    render();
    return;
  }

  // Preset picker dropdown inside session popover
  if (e.target.classList && e.target.classList.contains("popover-preset-select")) {
    const sessionId = e.target.dataset.sessionId;
    const presetId = e.target.value;
    if (!settings.sessionPresets) settings.sessionPresets = {};
    settings.sessionPresets[sessionId] = presetId;
    saveSessionPresets();
    render(); // re-renders popover body with new selection preview
    const preset = settings.presets.find(p => p.id === presetId);
    if (preset) showToast({ type: "info", message: `Assigned '${preset.name}'`, duration: 1800 });
    return;
  }

  // Per-session auto-compact allow toggle
  if (e.target.classList && e.target.classList.contains("popover-auto-compact")) {
    const sessionId = e.target.dataset.sessionId;
    if (!settings.sessionAutoCompact) settings.sessionAutoCompact = {};
    settings.sessionAutoCompact[sessionId] = !!e.target.checked;
    saveSessionAutoCompact();
    render();
    const label = e.target.checked ? "enabled" : "disabled";
    showToast({ type: "info", message: `Auto-compact ${label} for this session`, duration: 1800 });
    return;
  }

  // Session filter/sort selects
  if (e.target.classList && e.target.classList.contains("session-select")) {
    const type = e.target.dataset.type;
    const value = e.target.value;
    if (type === "filter") {
      saveSetting("filter", value);
    } else if (type === "sort") {
      saveSetting("sort", value);
    }
    render();
    return;
  }

  const input = e.target.closest("[data-action='toggle']");
  if (!input) return;

  const key = input.dataset.key;
  const checked = input.checked;

  if (key === "alwaysOnTop") {
    saveSetting("alwaysOnTop", checked);
    try { await invoke("set_always_on_top", { enabled: checked }); } catch (_) {}
  } else if (key === "autoHide") {
    saveSetting("autoHide", checked);
    try { await invoke("set_auto_hide", { enabled: checked }); } catch (_) {}
  } else if (key === "autostart") {
    try { await invoke("toggle_autostart"); } catch (_) {}
  }
});

document.addEventListener("keydown", async (e) => {
  // DevTools: F12 or Ctrl+Shift+I
  if (e.key === "F12" || (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i"))) {
    e.preventDefault();
    try { await invoke("open_devtools"); } catch (_) {}
    return;
  }

  if (e.key === "Escape") {
    // Priority: modal > popover > settings view > hide window
    if (activeModal) { closeModal(); return; }
    if (activePopover) { closePopover(); return; }
    if (currentView === "settings") { currentView = "main"; render(); return; }
    window.__TAURI__.window.getCurrentWindow().hide();
    return;
  }

  // Permission shortcuts: Y=allow, A=allow_session, N=deny (topmost pending)
  // Skip if modal/popover active or user is typing in an input field
  if (currentView === "main" && !activeModal && !activePopover) {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    const key = e.key.toLowerCase();
    const shortcutMap = { y: "allow", a: "allow_session", n: "deny" };
    const decision = shortcutMap[key];
    if (!decision) return;

    const btn = document.querySelector('.perm-btn[data-action="perm"]');
    if (!btn) return; // no pending permissions

    const id = btn.dataset.id;
    try { await invoke("respond_permission", { id, decision }); render(); }
    catch (_) {}
  }
});
