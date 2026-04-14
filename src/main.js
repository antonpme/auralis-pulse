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

function renderSession(session, ctx) {
  const pct = ctx ? Math.round(ctx.pct) : 0;
  const model = ctx ? ctx.model : "...";
  const used = ctx ? formatTokens(ctx.used_tokens) : "...";
  const max = ctx ? formatTokens(ctx.max_tokens) : "...";
  const subText = `${model}, ${formatDuration(session.duration_mins)}, ${used} / ${max}`;
  const shortCwd = truncatePath(session.cwd, 30);

  // Context legend: turns, compactions, autocompact threshold
  let legend = "";
  if (ctx) {
    const parts = [];
    if (ctx.turn_count > 0) parts.push(`${ctx.turn_count} turns`);
    if (ctx.compaction_count > 0) parts.push(`${ctx.compaction_count}x compacted`);
    // Autocompact fires at ~96.7% (33k buffer for 1M)
    const autocompactPct = Math.round(((ctx.max_tokens - 33000) / ctx.max_tokens) * 100);
    if (pct > 60) parts.push(`compact at ${autocompactPct}%`);
    if (parts.length > 0) legend = parts.join(" · ");
  }

  // Stacked bar: used (green-ish) + autocompact buffer zone
  const autocompactWidth = Math.round((33000 / (ctx?.max_tokens || 1000000)) * 100);
  const usedWidth = Math.min(pct, 100 - autocompactWidth);

  return `
    <div class="session-card fade-in">
      ${renderBar(session.name, pct, subText)}
      ${legend ? `<div class="context-legend">${legend}</div>` : ""}
      <div class="session-footer">
        <span class="session-path" title="${session.cwd}">${shortCwd}</span>
        <button class="action-btn" onclick="doCompact(${session.pid})">COMPACT</button>
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
        <button class="perm-btn allow" data-id="${permId}" data-decision="allow">YES</button>
        <button class="perm-btn allow secondary" data-id="${permId}" data-decision="allow_session">DON'T ASK AGAIN</button>
        <button class="perm-btn deny" data-id="${permId}" data-decision="deny">NO</button>
        <button class="perm-btn dismiss" data-id="${permId}" data-decision="dismiss">&#x2715;</button>
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
  const used = (rawLimit > 1000 ? rawUsed / 100 : rawUsed).toFixed(2);
  const limit = (rawLimit > 1000 ? rawLimit / 100 : rawLimit).toFixed(2);
  return `
    <div class="extra-inline">
      <span class="extra-label">EXTRA USAGE</span>
      <span class="extra-value"><span class="dollar">$</span>${used} <span class="extra-sep">/</span> <span class="dollar">$</span>${limit}</span>
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
          <span class="header-subtitle">companion for Claude Code</span>
        </div>
        <div class="header-right">
          <button class="refresh-icon-btn" onclick="doRefreshAll()" title="Refresh all">&#x21bb;</button>
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

window.doCompact = async function(pid) {
  const btn = event.target;
  btn.textContent = "...";
  btn.disabled = true;
  try {
    await invoke("trigger_compact", { pid });
    btn.textContent = "SENT";
    setTimeout(() => { btn.textContent = "COMPACT"; btn.disabled = false; }, 2000);
  } catch (err) {
    btn.textContent = "FAIL";
    setTimeout(() => { btn.textContent = "COMPACT"; btn.disabled = false; }, 2000);
  }
};

window.respondPerm = async function(id, decision) {
  console.log("[PULSE] respondPerm called:", id, decision);
  try {
    await invoke("respond_permission", { id, decision });
    console.log("[PULSE] respondPerm success");
    render();
  } catch (err) {
    console.error("[PULSE] respondPerm error:", err);
  }
};

window.doRefreshAll = async function() {
  try { await invoke("refresh_usage"); } catch (_) {}
  render();
};

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

// Event delegation for permission buttons (more reliable than inline onclick)
document.addEventListener("click", async (e) => {
  console.log("[PULSE] click target:", e.target.tagName, e.target.className, e.target.textContent?.slice(0, 20));
  const btn = e.target.closest("[data-id][data-decision]");
  if (btn) {
    const id = btn.dataset.id;
    const decision = btn.dataset.decision;
    console.log("[PULSE] permission btn clicked:", id, decision);
    btn.disabled = true;
    btn.textContent = "...";
    try {
      await invoke("respond_permission", { id, decision });
      console.log("[PULSE] respond_permission OK");
      render();
    } catch (err) {
      console.error("[PULSE] Permission response failed:", err);
      btn.disabled = false;
    }
    return;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.__TAURI__.window.getCurrentWindow().hide();
});
