const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const app = document.getElementById("app");
let currentMetric = "weekly";
let renderLock = false;

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
  // Keep drive + last folder: "E:\...\folder"
  const parts = cwd.replace(/\//g, "\\").split("\\").filter(Boolean);
  if (parts.length <= 2) return cwd.slice(0, maxLen) + "...";
  return parts[0] + "\\....\\" + parts[parts.length - 1];
}

function refineStatus(session, ctx) {
  // Backend gives rough status. Refine with real context % from frontend.
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

  // Info line: model, duration, tokens (left) + PID (right)
  const infoLeft = `${model}, ${formatDuration(session.duration_mins)}, ${used} / ${max}`;
  const legendParts = [];
  if (ctx && ctx.turn_count > 0) legendParts.push(`${ctx.turn_count} turns`);
  if (ctx && ctx.compaction_count > 0) legendParts.push(`${ctx.compaction_count}x compacted`);
  if (ctx && pct > 60) {
    const autocompactPct = Math.round(((ctx.max_tokens - 33000) / ctx.max_tokens) * 100);
    legendParts.push(`compact at ${autocompactPct}%`);
  }
  const infoRight = `PID ${session.pid}`;

  // Bar label: name + badge
  const barLabel = session.name + renderStatusBadge(status);

  // Actions: COMPACT always, DISMISS for idle/ghost
  let actions = `<button class="action-btn" data-pid="${session.pid}" data-action="compact">COMPACT</button>`;
  if (status !== "active") {
    actions += `<button class="action-btn dismiss-btn" data-pid="${session.pid}" data-action="dismiss">DISMISS</button>`;
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
        <button class="perm-btn allow" data-action="perm" data-id="${permId}" data-decision="allow">YES</button>
        <button class="perm-btn allow secondary" data-action="perm" data-id="${permId}" data-decision="allow_session">DON'T ASK AGAIN</button>
        <button class="perm-btn deny" data-action="perm" data-id="${permId}" data-decision="deny">NO</button>
        <button class="perm-btn dismiss" data-action="perm" data-id="${permId}" data-decision="dismiss">&#x2715;</button>
      </div>
    </div>
  `;
}

let lastGhostCount = 0;

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

  // Count ghosts (refined with real context %)
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

// ---- RIGHT PANEL: Usage (Burnrate) ----

function renderExtraUsage(extra) {
  if (!extra || !extra.is_enabled) return "";
  const rawUsed = extra.used_credits || 0;
  const rawLimit = extra.monthly_limit || 0;
  // API returns values in cents - convert to base currency
  // No currency symbol: API doesn't specify currency (USD, EUR, etc.)
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
  return `<button class="metric-btn ${active}" onclick="setMetric('${id}')">${label}</button>`;
}

async function renderRightPanel() {
  try {
    let data = await invoke("get_usage");
    if (!data || !data.usage) {
      try {
        data = await invoke("refresh_usage");
      } catch (fetchErr) {
        console.error("refresh_usage error:", fetchErr);
        return `<div class="loading-state"><div class="spinner"></div><div class="loading-text">Loading usage...</div></div>`;
      }
    }
    if (!data || !data.usage) {
      return `<div class="loading-state"><div class="spinner"></div><div class="loading-text">Loading usage...</div></div>`;
    }

    const usage = data.usage;
    let html = `<div class="section-label">USAGE</div>`;

    if (usage.five_hour) {
      html += renderBar("Session (5h)", Math.round(usage.five_hour.utilization), formatTimeLeft(usage.five_hour.resets_at));
    }
    if (usage.seven_day) {
      html += renderBar("Weekly", Math.round(usage.seven_day.utilization), formatTimeLeft(usage.seven_day.resets_at));
    }
    if (usage.seven_day_sonnet) {
      html += renderBar("Sonnet (weekly)", Math.round(usage.seven_day_sonnet.utilization), formatTimeLeft(usage.seven_day_sonnet.resets_at));
    }

    html += renderExtraUsage(usage.extra_usage);

    // Tray metric selector
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

// ---- RENDER ----

async function render() {
  if (renderLock) return;
  renderLock = true;
  try {
    const [leftHtml, rightHtml] = await Promise.all([renderLeftPanel(), renderRightPanel()]);

    let usageTier = "";
    try {
      const data = await invoke("get_usage");
      if (data && data.tier) usageTier = formatTier(data.tier);
    } catch (_) {}

    app.innerHTML = `
      <div class="header">
        <div class="header-left">
          <div class="header-title-row">
            <h1>AURALIS PULSE</h1>
            ${usageTier ? `<span class="tier-label">${usageTier}</span>` : ""}
          </div>
          <span class="header-subtitle">COMPANION FOR CLAUDE CODE</span>
        </div>
        <div class="header-right">
          ${lastGhostCount > 0 ? `<button class="clean-btn" data-action="clean-ghosts" title="Remove ${lastGhostCount} ghost session${lastGhostCount > 1 ? 's' : ''}">CLEAN</button>` : ""}
          <button class="refresh-icon-btn" data-action="refresh" title="Refresh all">&#x21bb;</button>
        </div>
      </div>
      <div class="split-container">
        <div class="panel-left">${leftHtml}</div>
        <div class="panel-right">${rightHtml}</div>
      </div>
    `;
  } catch (err) {
    app.innerHTML = `<div class="loading-state"><div class="spinner"></div><div class="loading-text">Loading...</div></div>`;
  } finally {
    renderLock = false;
  }
}

// ---- ACTIONS ----
// Most actions handled via event delegation above.

window.setMetric = async function(metric) {
  currentMetric = metric;
  try { await invoke("set_tray_metric", { metric }); } catch (_) {}
  render();
};

// ---- EVENTS ----
listen("permission-request", () => render());
listen("sessions-updated", () => render());
listen("usage-updated", () => render());

render();
setInterval(render, 15000);

// Unified event delegation for all interactive buttons
document.addEventListener("click", async (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  const pid = target.dataset.pid ? parseInt(target.dataset.pid) : null;

  // Permission buttons
  if (action === "perm" && target.dataset.id) {
    const id = target.dataset.id;
    const decision = target.dataset.decision;
    target.disabled = true;
    target.textContent = "...";
    try {
      await invoke("respond_permission", { id, decision });
      render();
    } catch (err) {
      console.error("[PULSE] Permission response failed:", err);
      target.disabled = false;
    }
    return;
  }

  // Session actions
  if (action === "compact" && pid) {
    target.disabled = true;
    target.textContent = "...";
    try {
      await invoke("trigger_compact", { pid });
      target.textContent = "SENT";
      setTimeout(() => { target.textContent = "COMPACT"; target.disabled = false; }, 2000);
    } catch (err) {
      target.textContent = "FAIL";
      setTimeout(() => { target.textContent = "COMPACT"; target.disabled = false; }, 2000);
    }
    return;
  }

  if (action === "dismiss" && pid) {
    target.disabled = true;
    target.textContent = "...";
    try {
      await invoke("dismiss_session", { pid });
      render();
    } catch (err) {
      console.error("[PULSE] Dismiss failed:", err);
      target.textContent = "FAIL";
      setTimeout(() => { target.textContent = "DISMISS"; target.disabled = false; }, 2000);
    }
    return;
  }

  if (action === "clean-ghosts") {
    target.disabled = true;
    target.textContent = "...";
    try {
      const count = await invoke("clean_ghost_sessions");
      target.textContent = count > 0 ? `${count} REMOVED` : "NONE";
      setTimeout(() => render(), 1000);
    } catch (err) {
      console.error("[PULSE] Clean ghosts failed:", err);
      target.textContent = "FAIL";
      setTimeout(() => render(), 2000);
    }
    return;
  }

  if (action === "refresh") {
    try { await invoke("refresh_usage"); } catch (_) {}
    render();
    return;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.__TAURI__.window.getCurrentWindow().hide();
});
