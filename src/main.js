const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const app = document.getElementById("app");
let currentMetric = localStorage.getItem("pulse-tray-metric") || "weekly";
let currentView = "main"; // "main" | "settings"
let renderLock = false;
let lastGhostCount = 0;

// ---- SETTINGS STATE ----

const validThemes = ["cyberpunk", "glass", "light"];
const savedTheme = localStorage.getItem("pulse-theme");
const settings = {
  theme: (savedTheme && validThemes.includes(savedTheme)) ? savedTheme : "cyberpunk",
  alwaysOnTop: localStorage.getItem("pulse-always-on-top") !== "false",
  autoHide: localStorage.getItem("pulse-auto-hide") !== "false",
};

const THEME_SIZES = {
  cyberpunk: { w: 780, h: 500 },
  glass: { w: 820, h: 530 },
  light: { w: 810, h: 520 },
};

function applyTheme(name) {
  settings.theme = name;
  document.documentElement.setAttribute("data-theme", name);
  localStorage.setItem("pulse-theme", name);
  // Resize window to fit theme
  const size = THEME_SIZES[name] || THEME_SIZES.cyberpunk;
  try { invoke("resize_window", { width: size.w, height: size.h }); } catch (_) {}
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

function renderBar(label, pct, subText) {
  const color = getColor(pct);
  return `
    <div class="bar-item">
      <div class="bar-header">
        <span class="bar-label">${label}</span>
        <span class="bar-value ${color}">${pct}%</span>
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

function renderSession(session, ctx) {
  const pct = ctx ? Math.round(ctx.pct) : 0;
  const model = ctx ? ctx.model : "...";
  const used = ctx ? formatTokens(ctx.used_tokens) : "...";
  const max = ctx ? formatTokens(ctx.max_tokens) : "...";
  const status = refineStatus(session, ctx);
  const shortCwd = truncatePath(session.cwd, 30);

  const infoLeft = `${model}, ${formatDuration(session.duration_mins)}, ${used} / ${max}`;
  const legendParts = [];
  if (ctx && ctx.turn_count > 0) legendParts.push(`${ctx.turn_count} turns`);
  if (ctx && ctx.compaction_count > 0) legendParts.push(`${ctx.compaction_count}x compacted`);
  if (ctx && pct > 60) {
    const autocompactPct = Math.round(((ctx.max_tokens - 33000) / ctx.max_tokens) * 100);
    legendParts.push(`compact at ${autocompactPct}%`);
  }
  const infoRight = `PID ${session.pid}`;
  const barLabel = session.name + renderStatusBadge(status);

  let actions = `<button class="action-icon-btn" data-pid="${session.pid}" data-action="compact" title="Compact session">&#x21BB;</button>`;
  if (status !== "active") {
    actions += `<button class="action-icon-btn dismiss-icon-btn" data-pid="${session.pid}" data-action="dismiss" title="Dismiss session">&#x2715;</button>`;
  }

  return `
    <div class="session-card ${status} fade-in">
      ${renderBar(barLabel, pct, "")}
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

  let html = `<div class="section-label">SESSIONS (${sessions.length})</div>`;

  if (pending.length > 0) {
    html += `<div class="section-label section-label--warning">PENDING (${pending.length})</div>`;
    html += pending.map(renderPermission).join("");
  }

  if (sessions.length === 0) {
    html += `<div class="empty-state">No active CLI sessions</div>`;
  } else {
    html += sessions.map(s => renderSession(s, contexts[s.session_id])).join("");
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

async function renderRightPanel() {
  try {
    let data = await invoke("get_usage");
    if (!data || !data.usage) {
      try { data = await invoke("refresh_usage"); } catch (fetchErr) {
        return `<div class="loading-state"><div class="spinner"></div><div class="loading-text">Loading usage...</div></div>`;
      }
    }
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

async function renderSettingsView() {
  let appVersion = "";
  let isAutostart = false;
  try { appVersion = await invoke("get_version"); } catch (_) {}
  try { isAutostart = await invoke("get_autostart"); } catch (_) {}

  return `
    <div class="settings-header">
      <button class="settings-back-btn" data-action="back">&larr; BACK</button>
      <span class="settings-title">SETTINGS</span>
      <span></span>
    </div>
    <div class="settings-view">
      <div class="settings-group">
        <div class="settings-group-label">APPEARANCE</div>
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

      <div class="settings-group">
        <div class="settings-group-label">ABOUT</div>
        <div class="settings-card">
          <div class="settings-about">
            Auralis Pulse v${appVersion}<br>
            <a href="https://github.com/antonpme/auralis-pulse" target="_blank">github.com/antonpme/auralis-pulse</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- RENDER ----

async function render() {
  if (renderLock) return;
  renderLock = true;
  try {
    if (currentView === "settings") {
      app.innerHTML = await renderSettingsView();
    } else {
      const [leftHtml, rightHtml] = await Promise.all([renderLeftPanel(), renderRightPanel()]);

      let usageTier = "";
      let appVersion = "";
      try {
        const data = await invoke("get_usage");
        if (data && data.tier) usageTier = formatTier(data.tier);
      } catch (_) {}
      try { appVersion = await invoke("get_version"); } catch (_) {}

      app.innerHTML = `
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
});

// Change events (toggles + radio)
document.addEventListener("change", async (e) => {
  // Theme radio
  if (e.target.name === "theme") {
    applyTheme(e.target.value);
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
  if (e.key === "Escape") {
    if (currentView === "settings") { currentView = "main"; render(); }
    else window.__TAURI__.window.getCurrentWindow().hide();
    return;
  }

  // Permission shortcuts: Y=allow, A=allow_session, N=deny (topmost pending)
  if (currentView === "main") {
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
