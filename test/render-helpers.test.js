import { describe, expect, it } from "vitest";
import { renderContent, renderContextMessage, renderEntry, renderProviderPayload } from "../web/render-helpers.js";

describe("web render helpers", () => {
	it("renders visible custom messages with string content", () => {
		const html = renderEntry({
			type: "custom_message",
			id: "custom-1",
			parentId: null,
			timestamp: new Date(0).toISOString(),
			customType: "qa-plugin",
			content: "Visible injected context",
			display: true,
		});

		expect(html).toContain("qa-plugin");
		expect(html).toContain("custom message");
		expect(html).toContain("Visible injected context");
		expect(html).toContain("open");
	});

	it("renders hidden custom messages as collapsed session entries", () => {
		const html = renderEntry({
			type: "custom_message",
			id: "custom-2",
			parentId: null,
			timestamp: new Date(0).toISOString(),
			customType: "hidden-plugin",
			content: [{ type: "text", text: "Hidden but debuggable" }],
			display: false,
		});

		expect(html).toContain("hidden custom message");
		expect(html).toContain("Hidden but debuggable");
		expect(html).not.toContain("<details class=\"custom-message hidden-custom\" open>");
	});

	it("renders custom state and unknown entries with JSON fallback", () => {
		const custom = renderEntry({
			type: "custom",
			id: "state-1",
			parentId: null,
			timestamp: new Date(0).toISOString(),
			customType: "state-plugin",
			data: { count: 2 },
		});
		const unknown = renderEntry({ type: "plugin_entry", id: "unknown-1", payload: { ok: true } });

		expect(custom).toContain("custom state");
		expect(custom).toContain("&quot;count&quot;: 2");
		expect(unknown).toContain("plugin_entry entry");
		expect(unknown).toContain("&quot;ok&quot;: true");
	});

	it("falls back to JSON for malformed content without throwing", () => {
		const circular = {};
		circular.self = circular;

		expect(() => renderContent({ unexpected: true }, "custom")).not.toThrow();
		expect(() => renderContent(circular, "custom")).not.toThrow();
		expect(renderContent({ unexpected: true }, "custom")).toContain("&quot;unexpected&quot;: true");
		expect(renderContent(circular, "custom")).toContain("[Circular]");
		expect(renderProviderPayload({ input: [{ type: "unknown_block", value: 1 }] })).toContain("unknown_block");
	});

	it("shows custom messages in LLM context rendering", () => {
		const html = renderContextMessage({
			role: "custom",
			customType: "context-plugin",
			content: "Context-only custom message",
			display: false,
			timestamp: 1,
		}, 0);

		expect(html).toContain("custom · context-plugin");
		expect(html).toContain("Context-only custom message");
	});
});
