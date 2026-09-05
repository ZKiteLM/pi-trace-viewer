import * as R from "./render-helpers.js";
(() => {
  "use strict";

  const state = {
    mode: "session",
    sessions: [],
    sessionId: new URLSearchParams(location.search).get("session"),
    session: null,
    calls: [],
    callId: new URLSearchParams(location.search).get("call"),
    leafId: new URLSearchParams(location.search).get("entry"),
    filter: "default",
    callFilter: "all",
    search: "",
    detailTab: "compare",
    contextView: "pi",
    pendingTargetScroll: false,
    refreshTimer: null,
  };

  const elements = {
    picker: document.querySelector("#session-picker"),
    live: document.querySelector("#live-status"),
    search: document.querySelector("#tree-search"),
    tree: document.querySelector("#tree-container"),
    treeStatus: document.querySelector("#tree-status"),
    header: document.querySelector("#header-container"),
    messages: document.querySelector("#messages"),
    sessionView: document.querySelector("#session-view"),
    callsView: document.querySelector("#calls-view"),
    callDetail: document.querySelector("#call-detail"),
    empty: document.querySelector("#empty-state"),
    sessionFilters: document.querySelector("#session-filters"),
    callFilters: document.querySelector("#call-filters"),
    modal: document.querySelector("#image-modal"),
    modalImage: document.querySelector("#modal-image"),
    toast: document.querySelector("#toast"),
  };

  globalThis.marked?.setOptions({ gfm: true, breaks: false });
  bindControls();
  connectEvents();
  refreshAll();

  function bindControls() {
    document.querySelectorAll(".mode-btn").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
    document.querySelectorAll(".filter-btn").forEach((button) => button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll(".filter-btn").forEach((item) => item.classList.toggle("active", item === button));
      renderSessionTree();
    }));
    document.querySelectorAll(".call-filter").forEach((button) => button.addEventListener("click", () => {
      state.callFilter = button.dataset.callFilter;
      document.querySelectorAll(".call-filter").forEach((item) => item.classList.toggle("active", item === button));
      renderCallTree();
      renderCallDetail();
    }));
    elements.picker.addEventListener("change", () => selectSession(elements.picker.value));
    elements.search.addEventListener("input", () => {
      state.search = elements.search.value.trim().toLowerCase();
      state.mode === "session" ? renderSessionTree() : renderCallTree();
    });
    document.querySelector("#refresh-btn").addEventListener("click", async () => {
      await fetch("/api/refresh", { method: "POST" });
      await refreshAll();
      toast("Data refreshed");
    });
    document.querySelector("#sidebar-toggle").addEventListener("click", () => toggleSidebar(true));
    document.querySelector("#sidebar-overlay").addEventListener("click", () => toggleSidebar(false));
    elements.modal.addEventListener("click", (event) => {
      if (event.target === elements.modal || event.target.closest(".modal-close")) closeImage();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeImage();
        toggleSidebar(false);
      }
    });
    bindResizer();
  }

  function bindResizer() {
    const resizer = document.querySelector("#sidebar-resizer");
    let resizing = false;
    resizer.addEventListener("mousedown", () => { resizing = true; document.body.style.userSelect = "none"; });
    window.addEventListener("mousemove", (event) => {
      if (!resizing) return;
      document.documentElement.style.setProperty("--sidebar-width", `${Math.max(240, Math.min(840, event.clientX))}px`);
    });
    window.addEventListener("mouseup", () => { resizing = false; document.body.style.userSelect = ""; });
    resizer.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const current = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width"), 10);
      const next = Math.max(240, Math.min(840, current + (event.key === "ArrowRight" ? 20 : -20)));
      document.documentElement.style.setProperty("--sidebar-width", `${next}px`);
    });
  }

  function connectEvents() {
    const source = new EventSource("/api/events");
    source.addEventListener("ready", () => setLive("live", "live"));
    source.onopen = () => setLive("live", "live");
    source.onerror = () => setLive("offline", "reconnecting");
    ["trace-record", "session-added", "session-updated", "session-detached", "refresh"].forEach((name) => {
      source.addEventListener(name, () => scheduleRefresh());
    });
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(refreshAll, 120);
  }

  async function refreshAll() {
    try {
      state.sessions = await fetchJson("/api/sessions");
      if (!state.sessionId || !state.sessions.some((session) => session.id === state.sessionId)) {
        state.sessionId = state.sessions.find((session) => session.active)?.id || state.sessions[0]?.id || null;
      }
      renderSessionPicker();
      if (!state.sessionId) {
        state.session = null;
        state.calls = [];
        render();
        return;
      }
      const encoded = encodeURIComponent(state.sessionId);
      [state.session, state.calls] = await Promise.all([
        fetchJson(`/api/sessions/${encoded}`),
        fetchJson(`/api/sessions/${encoded}/calls`),
      ]);
      if (!state.callId || !state.calls.some((call) => call.callId === state.callId)) state.callId = state.calls[0]?.callId || null;
      if (!state.leafId) state.leafId = state.session.leafId;
      syncUrl();
      render();
    } catch (error) {
      setLive("offline", "offline");
      toast(error instanceof Error ? error.message : String(error));
    }
  }

  async function selectSession(sessionId) {
    state.sessionId = sessionId;
    state.leafId = null;
    state.callId = null;
    await refreshAll();
  }

  function setMode(mode) {
    state.mode = mode === "calls" ? "calls" : "session";
    document.querySelectorAll(".mode-btn").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
    elements.sessionFilters.classList.toggle("hidden", state.mode !== "session");
    elements.callFilters.classList.toggle("hidden", state.mode !== "calls");
    elements.search.placeholder = state.mode === "session" ? "Search..." : "Search calls...";
    syncUrl();
    render();
  }

  function render() {
    const empty = !state.session;
    elements.empty.classList.toggle("hidden", !empty);
    elements.sessionView.classList.toggle("hidden", empty || state.mode !== "session");
    elements.callsView.classList.toggle("hidden", empty || state.mode !== "calls");
    if (empty) {
      elements.tree.innerHTML = "";
      elements.treeStatus.textContent = "Waiting for a pi session";
      return;
    }
    if (state.mode === "session") {
      renderSessionTree();
      renderSessionContent();
    } else {
      renderCallTree();
      renderCallDetail();
    }
  }

  function renderSessionPicker() {
    elements.picker.innerHTML = state.sessions.map((session) => {
      const label = session.name || shortId(session.id);
      return `<option value="${escapeAttr(session.id)}"${session.id === state.sessionId ? " selected" : ""}>${escapeHtml(label)}${session.active ? " • live" : ""}</option>`;
    }).join("");
    elements.picker.disabled = state.sessions.length === 0;
  }

  function renderSessionTree() {
    if (!state.session) return;
    const entries = state.session.entries || [];
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const branch = new Set(pathToRoot(byId, state.leafId || state.session.leafId).map((entry) => entry.id));
    const visible = entries.filter((entry) => passesSessionFilter(entry) && matchesSessionSearch(entry));
    const toolCalls = buildToolCallMap(entries);
    const layout = layoutVisibleTree(entries, visible);
    elements.tree.innerHTML = layout.map((item) => {
      const entry = item.entry;
      const active = entry.id === (state.leafId || state.session.leafId);
      const descriptor = R.describeEntry(entry, toolCalls);
      const prefix = buildTreePrefix(item);
      return `<div class="tree-row ${descriptor.className}${active ? " active" : ""}${branch.has(entry.id) ? " on-branch" : ""}" data-entry-id="${escapeAttr(entry.id)}" role="treeitem" tabindex="0" aria-selected="${active}">
        <span class="tree-prefix">${escapeHtml(prefix)}</span><span class="tree-icon">${branch.has(entry.id) ? "•" : " "}</span><span class="tree-lines">${descriptor.lines.map((line) => `<span class="tree-line ${line.className}">${line.label ? `<span class="tree-line-label">${escapeHtml(line.label)}</span>` : ""}${escapeHtml(line.text)}</span>`).join("")}</span>
      </div>`;
    }).join("");
    elements.tree.querySelectorAll("[data-entry-id]").forEach((row) => {
      const activate = () => {
        state.leafId = row.dataset.entryId;
        state.pendingTargetScroll = true;
        syncUrl();
        renderSessionTree();
        renderSessionContent();
        toggleSidebar(false);
      };
      row.addEventListener("click", activate);
      row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") activate(); });
    });
    elements.treeStatus.textContent = `${visible.length} of ${entries.length} entries · leaf ${shortId(state.leafId || state.session.leafId || "root")}`;
  }

  function passesSessionFilter(entry) {
    if (state.filter === "all") return true;
    if (state.filter === "labeled-only") return Boolean(entry.label);
    if (state.filter === "user-only") return entry.type === "message" && entry.message?.role === "user";
    if (state.filter === "no-tools") return !isSetting(entry) && !(entry.type === "message" && entry.message?.role === "toolResult");
    return !isSetting(entry);
  }

  function isSetting(entry) {
    return ["label", "model_change", "thinking_level_change", "session_info"].includes(entry.type);
  }

  function matchesSessionSearch(entry) {
    if (!state.search) return true;
    return JSON.stringify(entry).toLowerCase().includes(state.search);
  }

  function renderSessionContent() {
    const session = state.session;
    const entries = session.entries || [];
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const branchEntries = pathToRoot(byId, state.leafId || session.leafId);
    const stats = sessionStats(entries);
    elements.header.innerHTML = `<header class="session-header">
      <div class="session-title-row">
        <h1 class="session-title">${escapeHtml(session.name || "Session Export")}</h1>
        <span class="session-badge ${session.active ? "active" : ""}">${session.active ? "LIVE" : "HISTORICAL"}</span>
        <div class="header-actions"><a class="small-btn" href="/api/sessions/${encodeURIComponent(session.id)}/download">↓ JSONL</a></div>
      </div>
      <div class="info-grid">
        <div><span class="info-label">Session:</span><span class="info-value">${escapeHtml(session.id)}</span></div>
        <div><span class="info-label">Created:</span><span class="info-value">${formatTime(session.header?.timestamp)}</span></div>
        <div><span class="info-label">Working directory:</span><span class="info-value">${escapeHtml(session.cwd)}</span></div>
        <div><span class="info-label">Messages:</span><span class="info-value">${stats.user} user · ${stats.assistant} assistant · ${stats.tools} tools</span></div>
        <div><span class="info-label">Tokens:</span><span class="info-value">${number(stats.tokens)}</span></div>
        <div><span class="info-label">Cost:</span><span class="info-value">$${stats.cost.toFixed(4)}</span></div>
        <div><span class="info-label">Models:</span><span class="info-value">${escapeHtml([...stats.models].join(", ") || "unknown")}</span></div>
        <div><span class="info-label">Trace calls:</span><span class="info-value">${state.calls.length}</span></div>
        <div><span class="info-label">Trace storage:</span><span class="info-value ${session.tracePersistence?.status === "memory_only" ? "trace-warning" : ""}">${escapeHtml(formatTracePersistence(session.tracePersistence))}</span></div>
      </div>
      ${session.systemPrompt ? `<details class="header-disclosure"><summary>System prompt</summary><pre>${escapeHtml(session.systemPrompt)}</pre></details>` : ""}
      ${session.tools?.length ? `<details class="header-disclosure"><summary>Tools (${session.tools.length})</summary><pre>${escapeHtml(JSON.stringify(session.tools, null, 2))}</pre></details>` : ""}
    </header>`;
    elements.messages.innerHTML = branchEntries.map((entry) => R.renderEntry(entry, entries)).join("");
    bindRenderedContent();
    if (state.pendingTargetScroll) {
      state.pendingTargetScroll = false;
      const targetId = `entry-${state.leafId || ""}`;
      requestAnimationFrame(() => {
        const target = document.getElementById(targetId);
        target?.classList.add("highlight");
        target?.scrollIntoView({ block: "end", behavior: "smooth" });
      });
    }
  }

  function renderCallTree() {
    const calls = filteredCalls();
    if (calls.length && !calls.some((call) => call.callId === state.callId)) {
      state.callId = calls[0].callId;
      state.detailTab = "compare";
      syncUrl();
    }
    const sequence = new Map([...state.calls].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((call, index) => [call.callId, index + 1]));
    elements.tree.innerHTML = calls.map((call) => {
      const active = call.callId === state.callId;
      const identity = callIdentity(call, sequence.get(call.callId));
      return `<div class="tree-row call-tree-row call-${escapeAttr(call.kind)}${active ? " active" : ""}" data-call-id="${escapeAttr(call.callId)}" role="treeitem" tabindex="0" aria-selected="${active}">
        <span class="call-status ${call.status}" aria-hidden="true"></span><span class="sr-only">${escapeHtml(call.status)}</span><span class="call-tree-content"><span class="call-tree-title">${escapeHtml(identity.title)}</span><span class="call-tree-trigger">${escapeHtml(identity.trigger)}</span>${identity.activity ? `<span class="call-tree-activity">${escapeHtml(identity.activity)}</span>` : ""}</span><span class="call-meta"><span>${formatClock(call.startedAt)}</span><span>${escapeHtml(identity.duration)}</span></span>
      </div>`;
    }).join("");
    elements.tree.querySelectorAll("[data-call-id]").forEach((row) => {
      const activate = () => {
        state.callId = row.dataset.callId;
        state.detailTab = "compare";
        syncUrl();
        renderCallTree();
        renderCallDetail();
        toggleSidebar(false);
      };
      row.addEventListener("click", activate);
      row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") activate(); });
    });
    elements.treeStatus.textContent = `${calls.length} of ${state.calls.length} LLM calls`;
  }

  function filteredCalls() {
    return state.calls.filter((call) => {
      if (state.callFilter === "agent" && call.kind !== "agent") return false;
      if (state.callFilter === "summary" && !["compaction", "branch_summary"].includes(call.kind)) return false;
      if (state.callFilter === "error" && call.status !== "error") return false;
      if (!state.search) return true;
      return JSON.stringify(call).toLowerCase().includes(state.search);
    });
  }

  function renderCallDetail() {
    const call = state.calls.find((candidate) => candidate.callId === state.callId);
    if (!call) {
      elements.callDetail.innerHTML = `<div class="empty-state"><div class="empty-glyph">⌁</div><h1>No LLM calls yet</h1><p>The first context event will appear here in real time.</p></div>`;
      return;
    }
    const duration = call.completedAt ? Math.max(0, new Date(call.completedAt) - new Date(call.startedAt)) : null;
    const tabs = [
      ["overview", "Overview"], ["compare", "Context"], ["stream", `Output Stream (${call.outputEvents.length})`], ["final", "Final Output"],
    ];
    elements.callDetail.innerHTML = `<header class="call-header">
      <div class="call-header-top"><h1 class="call-title">${escapeHtml(call.kind.replace("_", " "))}</h1><span class="status-pill ${call.status}">${call.status}</span>${call.captureSource === "session_entry" ? `<span class="source-pill">restored from session entry</span>` : ""}<span class="call-id">${escapeHtml(shortId(call.callId))}</span></div>
      <div class="call-summary-grid">
        <div><span class="info-label">Model:</span>${escapeHtml(call.model ? `${call.model.provider}/${call.model.id}` : "unknown")}</div>
        <div><span class="info-label">API:</span>${escapeHtml(call.model?.api || "unknown")}</div>
        <div><span class="info-label">Turn:</span>${call.turnIndex ?? "—"}</div>
        <div><span class="info-label">Started:</span>${formatTime(call.startedAt)}</div>
        <div><span class="info-label">Duration:</span>${duration === null ? "running" : `${duration} ms`}</div>
        <div><span class="info-label">Requests:</span>${call.providerRequests.length}</div>
      </div>
    </header>
    <nav class="detail-tabs" aria-label="Call detail">${tabs.map(([id, label]) => `<button class="detail-tab${state.detailTab === id ? " active" : ""}" data-detail-tab="${id}">${escapeHtml(label)}</button>`).join("")}</nav>
    <div class="detail-panel">${renderDetailPanel(call)}</div>`;
    elements.callDetail.querySelectorAll("[data-detail-tab]").forEach((button) => button.addEventListener("click", () => {
      state.detailTab = button.dataset.detailTab;
      renderCallDetail();
    }));
    elements.callDetail.querySelectorAll("[data-context-view]").forEach((button) => button.addEventListener("click", () => {
      state.contextView = button.dataset.contextView;
      renderCallDetail();
    }));
    bindRenderedContent();
  }

  function renderDetailPanel(call) {
    if (state.detailTab === "overview") {
      return `<div class="compare-grid">
        <section class="data-panel"><div class="panel-heading">Lifecycle</div><pre class="json-block">${json({
          callId: call.callId, kind: call.kind, status: call.status, startedAt: call.startedAt, completedAt: call.completedAt,
          turnIndex: call.turnIndex, leafId: call.leafId, model: call.model, captureSource: call.captureSource, sourceEntryId: call.sourceEntryId, error: call.error,
        })}</pre></section>
        <section class="data-panel"><div class="panel-heading">Provider responses</div><pre class="json-block">${json(call.providerResponses)}</pre></section>
      </div>`;
    }
    if (state.detailTab === "stream") {
      if (!call.outputEvents.length) return unavailable(call.kind === "agent" ? "No streaming events were captured." : "Pi does not expose normalized streaming events for internal summary calls.");
      return `<div class="event-list">${call.outputEvents.map((item, index) => `<article class="stream-event"><div class="stream-event-head"><span>#${index + 1}</span><span class="stream-event-type">${escapeHtml(item.event.type)}</span><span>${formatClock(item.timestamp)}</span></div><pre>${json(item.event)}</pre></article>`).join("")}</div>`;
    }
    if (state.detailTab === "final") {
      if (!call.finalMessage) return unavailable(call.status === "running" ? "The model is still producing output." : "No final normalized message was captured.");
      return `<section class="data-panel"><div class="panel-heading">Normalized AssistantMessage <button class="small-btn" data-copy-json="final">Copy JSON</button></div><div class="assistant-message">${R.renderContent(call.finalMessage.content, "assistant")}</div><details class="header-disclosure"><summary>Raw JSON</summary><pre class="json-block" data-json-source="final">${json(call.finalMessage)}</pre></details></section>`;
    }
    const request = call.providerRequests.at(-1);
    const piSource = call.context || call.compactionContext;
    const piPanel = `<section class="data-panel context-single-panel"><div class="panel-heading">Pi Context <span class="panel-subtitle">${call.compactionContext && !call.context ? "compaction preparation" : "normalized"}</span>${piSource ? ` <button class="small-btn" data-copy-json="context">Copy JSON</button>` : ""}</div>${call.context ? R.renderPiContext(call.context) : call.compactionContext ? R.renderCompactionContext(call.compactionContext) : unavailableHtml(call.captureSource === "session_entry" ? "This historical compact call predates trace capture; its original compaction preparation was not stored." : "Not exposed for this internal or unmatched provider call.")}${piSource ? `<details class="raw-json-disclosure"><summary>Raw JSON</summary><pre class="json-block" data-json-source="context">${json(piSource)}</pre></details>` : ""}</section>`;
    const providerPanel = `<section class="data-panel context-single-panel"><div class="panel-heading">Provider Payload <span class="panel-subtitle">${escapeHtml(call.model?.api || "backend-specific")}${request ? ` · attempt ${request.attempt}` : ""}</span>${request ? ` <button class="small-btn" data-copy-json="payload">Copy JSON</button>` : ""}</div>${request ? `${R.renderProviderPayload(request.payload)}<details class="raw-json-disclosure"><summary>Raw JSON</summary><pre class="json-block" data-json-source="payload">${json(request.payload)}</pre></details>` : unavailableHtml(call.captureSource === "session_entry" ? "The provider request predates trace capture and cannot be reconstructed from the session file." : "Provider payload has not been emitted yet.")}</section>`;
    return `<div class="context-view-switch" role="group" aria-label="Context representation"><button class="context-view-btn${state.contextView === "pi" ? " active" : ""}" data-context-view="pi" aria-pressed="${state.contextView === "pi"}">Pi Context</button><button class="context-view-btn${state.contextView === "provider" ? " active" : ""}" data-context-view="provider" aria-pressed="${state.contextView === "provider"}">Provider Payload</button></div>${state.contextView === "provider" ? providerPanel : piPanel}`;
  }

  function bindRenderedContent() {
    document.querySelectorAll("pre code").forEach((block) => globalThis.hljs?.highlightElement(block));
    document.querySelectorAll(".message-image").forEach((image) => image.addEventListener("click", () => openImage(image.src)));
    document.querySelectorAll("[data-copy-link]").forEach((button) => button.addEventListener("click", () => {
      const url = new URL(location.href);
      url.searchParams.set("entry", button.dataset.copyLink);
      navigator.clipboard.writeText(url.toString());
      toast("Link copied");
    }));
    document.querySelectorAll("[data-copy-json]").forEach((button) => button.addEventListener("click", () => {
      const source = document.querySelector(`[data-json-source="${button.dataset.copyJson}"]`);
      navigator.clipboard.writeText(source?.textContent || "");
      toast("JSON copied");
    }));
  }

  function pathToRoot(byId, leafId) {
    const path = [];
    let current = leafId ? byId.get(leafId) : null;
    if (!current && byId.size) current = [...byId.values()].at(-1);
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      path.push(current);
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : null;
    }
    return path.reverse();
  }

  function layoutVisibleTree(entries, visibleEntries) {
    const allById = new Map(entries.map((entry) => [entry.id, entry]));
    const visibleIds = new Set(visibleEntries.map((entry) => entry.id));
    const children = new Map([[null, []]]);
    const order = new Map(entries.map((entry, index) => [entry.id, index]));
    for (const entry of visibleEntries) {
      let parentId = entry.parentId;
      const seen = new Set();
      while (parentId && !visibleIds.has(parentId) && !seen.has(parentId)) {
        seen.add(parentId);
        parentId = allById.get(parentId)?.parentId;
      }
      const visibleParent = visibleIds.has(parentId) ? parentId : null;
      if (!children.has(visibleParent)) children.set(visibleParent, []);
      children.get(visibleParent).push(entry.id);
    }
    for (const ids of children.values()) ids.sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0));
    const roots = children.get(null) || [];
    const multipleRoots = roots.length > 1;
    const stack = [];
    const orderedRoots = roots;
    for (let index = orderedRoots.length - 1; index >= 0; index -= 1) stack.push({ id: orderedRoots[index], indent: multipleRoots ? 1 : 0, justBranched: multipleRoots, showConnector: multipleRoots, isLast: index === orderedRoots.length - 1, gutters: [], isVirtualRootChild: multipleRoots, multipleRoots });
    const result = [];
    while (stack.length) {
      const item = stack.pop();
      result.push({ ...item, entry: allById.get(item.id) });
      const orderedChildren = children.get(item.id) || [];
      const multipleChildren = orderedChildren.length > 1;
      const childIndent = multipleChildren || (item.justBranched && item.indent > 0) ? item.indent + 1 : item.indent;
      const displayIndent = item.multipleRoots ? Math.max(0, item.indent - 1) : item.indent;
      const childGutters = item.showConnector && !item.isVirtualRootChild ? [...item.gutters, { position: Math.max(0, displayIndent - 1), show: !item.isLast }] : item.gutters;
      for (let index = orderedChildren.length - 1; index >= 0; index -= 1) stack.push({ id: orderedChildren[index], indent: childIndent, justBranched: multipleChildren, showConnector: multipleChildren, isLast: index === orderedChildren.length - 1, gutters: childGutters, isVirtualRootChild: false, multipleRoots: item.multipleRoots });
    }
    return result;
  }

  function buildTreePrefix(item) {
    const displayIndent = item.multipleRoots ? Math.max(0, item.indent - 1) : item.indent;
    const connector = item.showConnector && !item.isVirtualRootChild;
    let prefix = "";
    for (let level = 0; level < displayIndent; level += 1) {
      const gutter = item.gutters.find((candidate) => candidate.position === level);
      if (gutter) prefix += gutter.show ? "│  " : "   ";
      else if (connector && level === displayIndent - 1) prefix += item.isLast ? "└─ " : "├─ ";
      else prefix += "   ";
    }
    return prefix;
  }

  function buildToolCallMap(entries) {
    const calls = new Map();
    for (const entry of entries) {
      if (entry.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
      for (const block of entry.message.content) if (block?.type === "toolCall" && block.id) calls.set(block.id, { name: block.name, arguments: block.arguments || {} });
    }
    return calls;
  }

  function callIdentity(call, sequence) {
    const kind = call.kind === "agent" ? "Agent" : call.kind === "compaction" ? "Compact" : call.kind === "branch_summary" ? "Branch summary" : "Unknown";
    const model = call.model?.id || "unknown model";
    const turn = call.turnIndex === undefined ? "—" : call.turnIndex;
    const messages = call.context?.messages || [];
    const userMessage = [...messages].reverse().find((message) => message?.role === "user");
    const triggerText = R.contentText(userMessage?.content) || (call.kind === "compaction" ? "Compress current context" : call.kind === "branch_summary" ? "Summarize abandoned branch" : "Continuation after tool result");
    const finalContent = Array.isArray(call.finalMessage?.content) ? call.finalMessage.content : [];
    const toolNames = finalContent.filter((block) => block?.type === "toolCall").map((block) => block.name).filter(Boolean);
    const output = finalContent.filter((block) => block?.type === "text").map((block) => block.text).join(" ").replace(/\s+/g, " ").trim();
    const activity = call.captureSource === "session_entry" ? `restored summary: ${output}` : toolNames.length ? `tools: ${toolNames.join(", ")}` : output ? `output: ${output}` : call.error ? `error: ${call.error}` : call.status === "running" ? "streaming…" : "no normalized output";
    const durationMs = call.completedAt ? Math.max(0, new Date(call.completedAt) - new Date(call.startedAt)) : null;
    return {
      title: `#${sequence || "?"} · ${kind} · Turn ${turn} · ${model}`,
      trigger: `prompt: ${truncate(triggerText, 150)}`,
      activity: truncate(activity, 150),
      duration: durationMs === null ? "running" : durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`,
    };
  }

  function sessionStats(entries) {
    const result = { user: 0, assistant: 0, tools: 0, tokens: 0, cost: 0, models: new Set() };
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const message = entry.message || {};
      if (message.role === "user") result.user += 1;
      else if (message.role === "assistant") {
        result.assistant += 1;
        result.tokens += message.usage?.totalTokens || 0;
        result.cost += message.usage?.cost?.total || 0;
        if (message.model) result.models.add(message.provider ? `${message.provider}/${message.model}` : message.model);
      } else if (message.role === "toolResult") result.tools += 1;
    }
    return result;
  }

  function unavailable(message) {
    return `<div class="data-panel">${unavailableHtml(message)}</div>`;
  }
  function unavailableHtml(message) {
    return `<div class="unavailable"><strong>Unavailable at extension level</strong>${escapeHtml(message)}</div>`;
  }
  function json(value) { return escapeHtml(JSON.stringify(value, null, 2) ?? "null"); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
  function escapeAttr(value) { return escapeHtml(value); }
  function number(value) { return new Intl.NumberFormat("en-US").format(value || 0); }
  function shortId(value) { return String(value || "").slice(0, 8); }
  function truncate(value, length) { const text = String(value || "").replace(/\s+/g, " ").trim(); return text.length > length ? `${text.slice(0, length)}…` : text; }
  function formatTime(value) { return value ? new Date(value).toLocaleString() : "unknown"; }
  function formatClock(value) { return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""; }
  function formatTracePersistence(value) {
    if (!value) return "unknown";
    if (value.status === "persisted") return value.filePath || "persisted";
    return value.error ? `memory only · ${value.error}` : "memory only";
  }
  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }
  function setLive(className, label) { elements.live.className = `live-status ${className}`; elements.live.innerHTML = `<span class="status-dot"></span>${escapeHtml(label)}`; }
  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => elements.toast.classList.remove("show"), 1800);
  }
  function openImage(src) { elements.modalImage.src = src; elements.modal.classList.add("open"); elements.modal.focus(); }
  function closeImage() { elements.modal.classList.remove("open"); elements.modalImage.src = ""; }
  function toggleSidebar(open) { document.body.classList.toggle("sidebar-open", open); document.querySelector("#sidebar-toggle").setAttribute("aria-expanded", String(open)); }
  function syncUrl() {
    const url = new URL(location.href);
    state.sessionId ? url.searchParams.set("session", state.sessionId) : url.searchParams.delete("session");
    state.mode === "calls" ? url.searchParams.set("mode", "calls") : url.searchParams.delete("mode");
    state.callId && state.mode === "calls" ? url.searchParams.set("call", state.callId) : url.searchParams.delete("call");
    state.leafId && state.mode === "session" ? url.searchParams.set("entry", state.leafId) : url.searchParams.delete("entry");
    history.replaceState(null, "", url);
  }

  if (new URLSearchParams(location.search).get("mode") === "calls") setMode("calls");
})();
