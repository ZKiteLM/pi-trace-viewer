import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import piTraceViewer from "../src/index.ts";

function createMockPi() {
	const flags = new Map<string, any>();
	const commands = new Map<string, any>();
	const handlers = new Map<string, Array<(...args: any[]) => any>>();

	const pi: Partial<ExtensionAPI> = {
		registerFlag: (name, options) => {
			if (!flags.has(name)) flags.set(name, options?.default);
		},
		getFlag: (name) => flags.get(name),
		registerCommand: (name, options) => {
			commands.set(name, options);
		},
		on: (event, handler) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(handler);
		},
		getActiveTools: () => [],
		getAllTools: () => [],
	};

	return {
		pi: pi as ExtensionAPI,
		flags,
		commands,
		handlers,
		emit: async (event: string, ...args: any[]) => {
			for (const handler of handlers.get(event) ?? []) {
				await handler(...args);
			}
		},
	};
}

function createMockContext(notify = vi.fn()): ExtensionContext {
	return {
		ui: { notify },
		getSystemPrompt: () => "system prompt",
		sessionManager: {
			getSessionId: () => "mock-session-id",
			getSessionName: () => "mock-session-name",
			getCwd: () => "/tmp",
			getSessionFile: () => "/tmp/mock.jsonl",
			getHeader: () => ({ model: "test-model" }),
			getEntries: () => [],
			getLeafId: () => "leaf-1",
		},
	} as unknown as ExtensionContext;
}

describe("piTraceViewer extension toggle", () => {
	it("registers flags and trace-view command", () => {
		const mock = createMockPi();
		piTraceViewer(mock.pi);

		expect(mock.flags.has("pi-trace-port")).toBe(true);
		expect(mock.flags.has("no-pi-trace")).toBe(true);
		expect(mock.commands.has("trace-view")).toBe(true);
	});

	it("skips session_start when --no-pi-trace is set and allows lazy start with /trace-view on", async () => {
		const mock = createMockPi();
		mock.flags.set("no-pi-trace", true);
		piTraceViewer(mock.pi);

		const notify = vi.fn();
		const ctx = createMockContext(notify);

		await mock.emit("session_start", {}, ctx);
		expect(notify).not.toHaveBeenCalled();

		const cmd = mock.commands.get("trace-view");

		// When not running, plain command prompts to start
		await cmd.handler("", ctx);
		expect(notify).toHaveBeenCalledWith("Trace viewer is not running. Type /trace-view on to start.", "info");

		// Lazy start via /trace-view on
		notify.mockClear();
		await cmd.handler("on", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Trace viewer started (capturing):"), "info");

		// Once started, plain command shows status
		notify.mockClear();
		await cmd.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Trace viewer (capturing):"), "info");

		// Pause capture with /trace-view off
		notify.mockClear();
		await cmd.handler("off", ctx);
		expect(notify).toHaveBeenCalledWith("LLM trace capture paused. Existing traces remain viewable.", "info");

		// Stop server with /trace-view stop
		notify.mockClear();
		await cmd.handler("stop", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Trace viewer server stopped and port released"), "info");

		// Verify it is stopped
		notify.mockClear();
		await cmd.handler("", ctx);
		expect(notify).toHaveBeenCalledWith("Trace viewer is not running. Type /trace-view on to start.", "info");
	});

	it("handles /trace-view off and on toggling when already started", async () => {
		const mock = createMockPi();
		piTraceViewer(mock.pi);

		const notify = vi.fn();
		const ctx = createMockContext(notify);

		await mock.emit("session_start", {}, ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Trace viewer:"), "info");

		const cmd = mock.commands.get("trace-view");

		notify.mockClear();
		await cmd.handler("off", ctx);
		expect(notify).toHaveBeenCalledWith("LLM trace capture paused. Existing traces remain viewable.", "info");

		// When turned off, turn_start / context should be ignored safely without errors
		expect(async () => {
			await mock.emit("turn_start", { turnIndex: 1 });
			await mock.emit("context", {}, ctx);
		}).not.toThrow();

		notify.mockClear();
		await cmd.handler("on", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("LLM trace capture resumed:"), "info");

		await cmd.handler("stop", ctx);
	});
});
