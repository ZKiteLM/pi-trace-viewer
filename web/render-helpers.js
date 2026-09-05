/* global marked */
export function renderEntry(entry, allEntries = []) {
  const timestamp = `<div class="message-timestamp">${formatTime(entry?.timestamp)}</div>`;
  const link = entry?.id ? `<button class="copy-link" data-copy-link="${escapeAttr(entry.id)}" title="Copy link">#</button>` : "";
  if (entry?.type === "message") {
    const message = entry.message || {};
    if (message.role === "user") return `<article id="entry-${escapeAttr(entry.id)}" class="entry user-message">${link}${timestamp}${renderContent(message.content, "user")}</article>`;
    if (message.role === "assistant") return `<article id="entry-${escapeAttr(entry.id)}" class="entry assistant-message">${link}${timestamp}${renderContent(message.content, "assistant")}${message.errorMessage ? `<div class="tool-block error"><div class="tool-content">${escapeHtml(message.errorMessage)}</div></div>` : ""}</article>`;
    if (message.role === "toolResult") {
      return `<article id="entry-${escapeAttr(entry.id)}" class="entry"><details class="tool-block ${message.isError ? "error" : "success"}"><summary><span class="tool-name">${escapeHtml(message.toolName || "tool")}</span> result${message.isError ? " · error" : ""}</summary><div class="tool-content">${renderContent(message.content, "tool")}</div></details></article>`;
    }
    return fallbackEntry(entry, "message");
  }
  if (entry?.type === "custom_message") {
    const open = entry.display ? " open" : "";
    const hidden = entry.display ? "" : " hidden-custom";
    const label = entry.display ? "custom message" : "hidden custom message";
    return `<article id="entry-${escapeAttr(entry.id)}" class="entry"><details class="custom-message${hidden}"${open}><summary><span class="tool-name">${escapeHtml(entry.customType || "custom")}</span> ${label}</summary><div class="summary-content">${renderContent(entry.content, "custom")}${renderDetails(entry.details)}</div></details></article>`;
  }
  if (entry?.type === "custom") {
    return `<article id="entry-${escapeAttr(entry.id)}" class="entry"><details class="custom-message custom-state"><summary><span class="tool-name">${escapeHtml(entry.customType || "custom")}</span> custom state</summary><div class="summary-content"><pre class="json-block">${json(entry.data ?? null)}</pre></div></details></article>`;
  }
  if (entry?.type === "compaction") return `<article id="entry-${escapeAttr(entry.id)}" class="entry"><details class="compaction"><summary>[compaction] Compacted from ${number(entry.tokensBefore)} tokens</summary><div class="summary-content">${renderMarkdownText(entry.summary, "Compaction summary")}</div></details></article>`;
  if (entry?.type === "branch_summary") return `<article id="entry-${escapeAttr(entry.id)}" class="entry"><details class="branch-summary" open><summary>Branch Summary</summary><div class="summary-content">${renderMarkdownText(entry.summary, "Branch summary")}</div></details></article>`;
  if (entry?.type === "model_change") return `<div id="entry-${escapeAttr(entry.id)}" class="entry model-change">${timestamp}Switched to model: ${escapeHtml(`${entry.provider}/${entry.modelId}`)}</div>`;
  if (entry?.type === "thinking_level_change") return `<div id="entry-${escapeAttr(entry.id)}" class="entry setting-change">Thinking level: ${escapeHtml(entry.thinkingLevel)}</div>`;
  if (entry?.type === "session_info") return `<div id="entry-${escapeAttr(entry.id)}" class="entry setting-change">${timestamp}Session name: ${escapeHtml(entry.name || "(cleared)")}</div>`;
  if (entry?.type === "label") return `<div id="entry-${escapeAttr(entry.id)}" class="entry setting-change">${timestamp}Label: ${escapeHtml(entry.label || "(cleared)")}</div>`;
  return fallbackEntry(entry, entry?.type || "unknown");
}

export function renderContent(content, role) {
  if (typeof content === "string") return renderMarkdownText(content, `${role} markdown`);
  if (!Array.isArray(content)) return `<pre class="json-block">${json(content ?? null)}</pre>`;
  let html = "";
  const images = [];
  for (const block of content) {
    if (typeof block === "string") html += renderMarkdownText(block, `${role} markdown`);
    else if (!block || typeof block !== "object") html += `<pre class="json-block">${json(block ?? null)}</pre>`;
    else if (block.type === "text") html += renderMarkdownText(block.text || "", `${role} markdown`);
    else if (block.type === "thinking") html += `<details class="thinking-block"><summary>thinking</summary><div class="thinking-content">${escapeHtml(block.thinking || "")}</div></details>`;
    else if (block.type === "toolCall") html += `<details class="tool-block" open><summary><span class="tool-name">${escapeHtml(block.name || "tool")}</span> call</summary><pre class="json-block">${json(block.arguments ?? {})}</pre></details>`;
    else if (block.type === "image" && block.data) images.push(`<img class="message-image" alt="${escapeAttr(role)} attachment" src="data:${escapeAttr(block.mimeType || "image/png")};base64,${escapeAttr(block.data)}">`);
    else html += `<details class="provider-block"><summary>${escapeHtml(block.type || "content block")}</summary><pre class="json-block">${json(block)}</pre></details>`;
  }
  return html + (images.length ? `<div class="message-images">${images.join("")}</div>` : "");
}

export function renderPiContext(context) {
  const messages = Array.isArray(context?.messages) ? context.messages : [];
  const tools = Array.isArray(context?.tools) ? context.tools : [];
  return `<div class="structured-context">
    <details class="context-section" open><summary>System prompt</summary><div class="context-section-body">${renderMarkdownText(context?.systemPrompt || "", "System prompt source")}</div></details>
    <section class="context-section"><div class="context-section-title">Messages <span>${messages.length}</span></div><div class="context-messages">${messages.map((message, index) => renderContextMessage(message, index)).join("") || `<div class="unavailable">No messages</div>`}</div></section>
    <details class="context-section"><summary>Tools (${tools.length})</summary><div class="context-section-body tool-definition-list">${tools.map((tool) => `<details class="tool-definition"><summary>${escapeHtml(tool?.name || "unnamed tool")}</summary><p>${escapeHtml(tool?.description || "")}</p><pre class="json-block">${json(tool?.parameters || {})}</pre></details>`).join("") || "No tools"}</div></details>
  </div>`;
}

export function renderCompactionContext(context) {
  const messages = Array.isArray(context?.messagesToSummarize) ? context.messagesToSummarize : [];
  const prefix = Array.isArray(context?.turnPrefixMessages) ? context.turnPrefixMessages : [];
  return `<div class="structured-context">
    <div class="context-note"><strong>Compaction preparation</strong>Pi exposes the source messages and cut-point metadata here. The exact generated prompt is visible in Provider Payload when the provider hook was captured.</div>
    <section class="provider-meta">
      <div><span>reason</span><strong>${escapeHtml(context?.reason)}</strong></div><div><span>tokens before</span><strong>${number(context?.tokensBefore)}</strong></div><div><span>split turn</span><strong>${context?.isSplitTurn ? "yes" : "no"}</strong></div><div><span>retry after</span><strong>${context?.willRetry ? "yes" : "no"}</strong></div>
    </section>
    ${context?.customInstructions ? `<details class="context-section"><summary>Custom compaction instructions</summary><div class="context-section-body">${renderMarkdownText(context.customInstructions, "Instruction source")}</div></details>` : ""}
    ${context?.previousSummary ? `<details class="context-section"><summary>Previous summary</summary><div class="context-section-body">${renderMarkdownText(context.previousSummary, "Previous summary source")}</div></details>` : ""}
    <section class="context-section"><div class="context-section-title">Messages to summarize <span>${messages.length}</span></div><div class="context-messages">${messages.map((message, index) => renderContextMessage(message, index)).join("") || `<div class="unavailable">No history messages in this compaction pass.</div>`}</div></section>
    ${prefix.length ? `<section class="context-section"><div class="context-section-title">Split-turn prefix <span>${prefix.length}</span></div><div class="context-messages">${prefix.map((message, index) => renderContextMessage(message, index)).join("")}</div></section>` : ""}
    <details class="context-section"><summary>Cut point and settings</summary><div class="context-section-body"><pre class="json-block">${json({ firstKeptEntryId: context?.firstKeptEntryId, settings: context?.settings, fileOps: context?.fileOps })}</pre></div></details>
  </div>`;
}

export function renderContextMessage(message, index) {
  const role = message?.role || message?.type || "unknown";
  const customType = message?.customType ? ` · ${message.customType}` : "";
  const tool = message?.toolName ? ` · ${message.toolName}` : "";
  const source = message?.content ?? message?.summary ?? message?.text ?? message;
  return `<details class="context-message role-${roleClass(role)}"><summary class="context-message-head"><span>#${index + 1}</span><span class="role-badge">${escapeHtml(role + customType + tool)}</span>${message?.isError ? `<span class="error-label">error</span>` : ""}<span class="context-message-preview">${escapeHtml(truncate(contentText(source) || "(no text)", 130))}</span></summary><div class="context-message-body">${renderContent(source, role)}</div><details class="message-raw-json"><summary>Message JSON</summary><pre class="json-block">${json(message)}</pre></details></details>`;
}

export function renderProviderPayload(payload) {
  if (!payload || typeof payload !== "object") return `<div class="provider-scalar">${escapeHtml(String(payload ?? "null"))}</div>`;
  const input = Array.isArray(payload.input) ? payload.input : Array.isArray(payload.messages) ? payload.messages : typeof payload.prompt === "string" ? [payload.prompt] : [];
  const instructions = payload.instructions ?? payload.system;
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  const meta = {};
  for (const key of ["model", "temperature", "top_p", "max_tokens", "max_output_tokens", "reasoning", "tool_choice", "parallel_tool_calls", "store", "stream"]) if (payload[key] !== undefined) meta[key] = payload[key];
  return `<div class="structured-context provider-context">
    <section class="provider-meta">${Object.entries(meta).map(([key, value]) => `<div><span>${escapeHtml(key)}</span><strong>${escapeHtml(typeof value === "object" ? safeStringify(value) : value)}</strong></div>`).join("") || `<div><span>format</span><strong>generic payload</strong></div>`}</section>
    ${instructions !== undefined ? `<details class="context-section" open><summary>Instructions / system</summary><div class="context-section-body">${renderProviderContent(instructions, "instructions")}</div></details>` : ""}
    <section class="context-section"><div class="context-section-title">Backend input <span>${input.length}</span></div><div class="context-messages">${input.map((item, index) => renderProviderItem(item, index)).join("") || `<div class="unavailable">No recognized input/messages field. Use Raw JSON below.</div>`}</div></section>
    ${tools.length ? `<details class="context-section"><summary>Backend tools (${tools.length})</summary><div class="context-section-body tool-definition-list">${tools.map((tool) => { const definition = tool?.function || tool || {}; return `<details class="tool-definition"><summary>${escapeHtml(definition.name || tool?.type || "tool")}</summary><p>${escapeHtml(definition.description || "")}</p><pre class="json-block">${json(definition.parameters || definition.input_schema || tool)}</pre></details>`; }).join("")}</div></details>` : ""}
  </div>`;
}

export function renderProviderContent(content, label) {
  if (typeof content === "string") return renderMarkdownText(content, `${label} source`);
  if (!Array.isArray(content)) return `<pre class="json-block">${json(content)}</pre>`;
  return content.map((block) => {
    if (typeof block === "string") return renderMarkdownText(block, `${label} source`);
    const text = block?.text ?? block?.input_text ?? block?.output_text;
    if (typeof text === "string") return renderMarkdownText(text, `${block.type || label} source`);
    if (["function_call", "tool_use"].includes(block?.type)) return `<details class="tool-block" open><summary><span class="tool-name">${escapeHtml(block.name || "tool")}</span> call</summary><pre class="json-block">${json(block.arguments ?? block.input ?? {})}</pre></details>`;
    if (["function_call_output", "tool_result"].includes(block?.type)) return `<details class="tool-block success"><summary>tool result</summary>${renderProviderContent(block.output ?? block.content ?? "", "tool result")}</details>`;
    return `<details class="provider-block"><summary>${escapeHtml(block?.type || "content block")}</summary><pre class="json-block">${json(block)}</pre></details>`;
  }).join("");
}

export function renderProviderItem(item, index) {
  if (typeof item === "string") return `<details class="context-message role-user"><summary class="context-message-head"><span>#${index + 1}</span><span class="role-badge">prompt</span><span class="context-message-preview">${escapeHtml(truncate(item, 130))}</span></summary><div class="context-message-body">${renderMarkdownText(item, "Prompt source")}</div></details>`;
  const role = item?.role || item?.type || "input item";
  const name = item?.name ? ` · ${item.name}` : "";
  if (["function_call", "tool_use"].includes(item?.type)) {
    const args = typeof item.arguments === "string" ? parseJson(item.arguments) : item.arguments ?? item.input ?? {};
    return `<details class="context-message role-${roleClass(role)}"><summary class="context-message-head"><span>#${index + 1}</span><span class="role-badge">${escapeHtml(role + name)}</span><span class="context-message-preview">${escapeHtml(truncate(safeStringify(args), 130))}</span></summary><div class="context-message-body"><pre class="json-block">${json(args)}</pre></div></details>`;
  }
  if (["function_call_output", "tool_result"].includes(item?.type)) {
    const output = item.output ?? item.content ?? "";
    return `<details class="context-message role-${roleClass(role)}"><summary class="context-message-head"><span>#${index + 1}</span><span class="role-badge">${escapeHtml(role + name)}</span><span class="context-message-preview">${escapeHtml(truncate(providerContentText(output), 130))}</span></summary><div class="context-message-body">${renderProviderContent(output, role)}</div></details>`;
  }
  const content = item?.content ?? item?.text ?? item?.arguments ?? item?.output ?? item;
  return `<details class="context-message role-${roleClass(role)}"><summary class="context-message-head"><span>#${index + 1}</span><span class="role-badge">${escapeHtml(role + name)}</span><span class="context-message-preview">${escapeHtml(truncate(providerContentText(content), 130))}</span></summary><div class="context-message-body">${renderProviderContent(content, role)}</div></details>`;
}

export function describeEntry(entry, toolCalls) {
  if (entry?.type === "message") return describeMessageEntry(entry, toolCalls);
  if (entry?.type === "custom_message") {
    const label = entry.display ? "custom: " : "hidden custom: ";
    return { className: entry.display ? "tree-custom" : "tree-custom tree-hidden-custom", lines: [{ className: "line-custom", label, text: `${entry.customType || "custom"} · ${contentText(entry.content) || "(no text)"}` }] };
  }
  if (entry?.type === "custom") return { className: "tree-custom", lines: [{ className: "line-custom", label: "state: ", text: `${entry.customType || "custom"} · ${truncate(safeStringify(entry.data ?? null), 120)}` }] };
  if (entry?.type === "compaction") return { className: "tree-compaction", lines: [{ className: "line-compaction", label: "compact: ", text: `${Math.round((entry.tokensBefore || 0) / 1000)}k tokens` }] };
  if (entry?.type === "branch_summary") return { className: "tree-branch", lines: [{ className: "line-branch", label: "branch: ", text: entry.summary || "summary" }] };
  if (entry?.type === "model_change") return { className: "tree-setting", lines: [{ className: "line-setting", label: "model: ", text: `${entry.provider}/${entry.modelId}` }] };
  if (entry?.type === "thinking_level_change") return { className: "tree-setting", lines: [{ className: "line-setting", label: "thinking: ", text: entry.thinkingLevel || "" }] };
  if (entry?.type === "session_info") return { className: "tree-setting", lines: [{ className: "line-setting", label: "name: ", text: entry.name || "(cleared)" }] };
  if (entry?.type === "label") return { className: "tree-setting", lines: [{ className: "line-setting", label: "label: ", text: entry.label || "(cleared)" }] };
  return { className: "tree-setting", lines: [{ className: "line-setting", label: `${entry?.type || "unknown"}: `, text: truncate(safeStringify(entry ?? null), 160) }] };
}

export function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return typeof content === "object" ? safeStringify(content ?? "") : String(content ?? "");
  return content.map((block) => {
    if (typeof block === "string") return block;
    return block?.text || block?.thinking || (block?.type === "toolCall" ? `${block.name}(${safeStringify(block.arguments)})` : block?.type === "image" ? "[image]" : block?.type || "");
  }).join(" ").replace(/\s+/g, " ").trim();
}

export function providerContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return safeStringify(content ?? "");
  return content.map((block) => {
    if (typeof block === "string") return block;
    const direct = block?.text ?? block?.input_text ?? block?.output_text;
    if (direct !== undefined) return String(direct);
    const nested = block?.output ?? block?.content;
    if (typeof nested === "string") return nested;
    if (block?.name) return `${block.name} ${safeStringify(block.arguments ?? block.input ?? {})}`;
    return block?.type || "content block";
  }).join(" ").replace(/\s+/g, " ").trim();
}

export function renderMarkdownText(value, rawLabel = "Raw Markdown") {
  const source = String(value || "");
  return `<div class="markdown-pair"><div class="markdown">${markdown(source)}</div><details class="raw-markdown"><summary>${escapeHtml(rawLabel)}</summary><pre>${escapeHtml(source)}</pre></details></div>`;
}

export function unavailableHtml(message) {
  return `<div class="unavailable"><strong>Unavailable at extension level</strong>${escapeHtml(message)}</div>`;
}

export function json(value) {
  return escapeHtml(safeStringify(value));
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

export function number(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

export function truncate(value, length) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export function formatTime(value) {
  return value ? new Date(value).toLocaleString() : "unknown";
}

export function formatClock(value) {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}

function describeMessageEntry(entry, toolCalls) {
  const role = entry.message?.role;
  const content = Array.isArray(entry.message?.content) ? entry.message.content : [];
  if (role === "user") return { className: "tree-user", lines: [{ className: "line-user", label: "user: ", text: contentText(entry.message?.content) || "(empty)" }] };
  if (role === "assistant") {
    const text = content.filter((block) => block?.type === "text").map((block) => block.text).join(" ").replace(/\s+/g, " ").trim();
    const thinking = content.filter((block) => block?.type === "thinking").map((block) => block.thinking).join(" ").replace(/\s+/g, " ").trim();
    const lines = [];
    if (thinking) lines.push({ className: "line-thinking", label: "thinking: ", text: thinking });
    if (text) lines.push({ className: entry.message?.stopReason === "error" ? "line-error" : "line-assistant", label: "assistant: ", text });
    if (!lines.length) lines.push({ className: entry.message?.stopReason === "error" ? "line-error" : "line-assistant", label: "assistant: ", text: entry.message?.errorMessage ? entry.message.errorMessage : "(no text)" });
    for (const block of content.filter((item) => item?.type === "toolCall")) lines.push({ className: "line-tool-call", label: "call: ", text: formatToolCall(block.name || "tool", block.arguments || {}) });
    return { className: entry.message?.stopReason === "error" ? "tree-error" : "tree-assistant", lines };
  }
  const linked = entry.message?.toolCallId ? toolCalls.get(entry.message.toolCallId) : null;
  const toolName = entry.message?.toolName || linked?.name || role || "message";
  const callDescription = linked ? formatToolCall(linked.name, linked.arguments) : `[${toolName}]`;
  const result = contentText(entry.message?.content);
  return { className: entry.message?.isError ? "tree-tool-result tree-error" : "tree-tool-result", lines: [{ className: entry.message?.isError ? "line-tool-error" : "line-tool-result", label: "result: ", text: `${callDescription}${result ? ` · ${result}` : ""}` }] };
}

function fallbackEntry(entry, label) {
  const id = entry?.id ? ` id="entry-${escapeAttr(entry.id)}"` : "";
  return `<article${id} class="entry"><details class="custom-message custom-state"><summary>${escapeHtml(label)} entry</summary><div class="summary-content"><pre class="json-block">${json(entry ?? null)}</pre></div></details></article>`;
}

function renderDetails(details) {
  if (details === undefined) return "";
  return `<details class="message-raw-json"><summary>Details JSON</summary><pre class="json-block">${json(details)}</pre></details>`;
}

function formatToolCall(name, args) {
  const compact = (value, length = 90) => String(value ?? "").replace(/[\n\t]+/g, " ").trim().slice(0, length);
  if (["read", "write", "edit"].includes(name)) return `[${name}: ${compact(args.path || args.file_path)}]`;
  if (name === "bash") return `[bash: ${compact(args.command)}${String(args.command || "").length > 90 ? "…" : ""}]`;
  if (name === "grep") return `[grep: /${compact(args.pattern, 45)}/ in ${compact(args.path || ".", 45)}]`;
  if (name === "find") return `[find: ${compact(args.pattern, 45)} in ${compact(args.path || ".", 45)}]`;
  const serialized = safeStringify(args || {});
  return `[${name}: ${compact(serialized)}${serialized.length > 90 ? "…" : ""}]`;
}

function roleClass(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function markdown(value) {
  const fallback = typeof marked === "undefined" ? undefined : marked;
  const parser = globalThis.marked?.parse ? globalThis.marked : fallback;
  return parser?.parse ? parser.parse(escapeHtml(String(value || ""))) : `<p>${escapeHtml(value)}</p>`;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function safeStringify(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === "bigint") return `${item.toString()}n`;
      if (!item || typeof item !== "object") return item;
      if (seen.has(item)) return "[Circular]";
      seen.add(item);
      return item;
    }, 2) ?? "null";
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2);
  }
}
