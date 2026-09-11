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

describe("piTraceViewer extension toggle", () => {
	it("registers flags and trace-view command", () => {
		const mock = createMockPi();
		piTraceViewer(mock.pi);

		expect(mock.flags.has("pi-trace-port")).toBe(true);
		expect(mock.flags.has("no-pi-trace")).toBe(true);
		expect(mock.commands.has("trace-view")).toBe(true);
	});

	it("skips session_start when --no-pi-trace is set", async () => {
		const mock = createMockPi();
		mock.flags.set("no-pi-trace", true);
		piTraceViewer(mock.pi);

		const notify = vi.fn();
		const ctx = {
			ui: { notify },
		} as unknown as ExtensionContext;

		await mock.emit("session_start", {}, ctx);
		expect(notify).not.toHaveBeenCalled();

		// Calling command should notify that it's disabled via flag
		const cmd = mock.commands.get("trace-view");
		await cmd.handler("", ctx);
		expect(notify).toHaveBeenCalledWith("Trace viewer is disabled via --no-pi-trace.", "warning");
	});

	it("handles /trace-view off and on toggling", async () => {
		const mock = createMockPi();
		piTraceViewer(mock.pi);

		const notify = vi.fn();
		const ctx = {
			ui: { notify },
		} as unknown as ExtensionContext;

		const cmd = mock.commands.get("trace-view");

		await cmd.handler("off", ctx);
		expect(notify).toHaveBeenCalledWith("LLM trace capture paused. Existing traces remain viewable.", "info");

		// When turned off, turn_start / context should be ignored safely without errors
		expect(async () => {
			await mock.emit("turn_start", { turnIndex: 1 });
			await mock.emit("context", {}, ctx);
		}).not.toThrow();

		await cmd.handler("on", ctx);
		expect(notify).toHaveBeenCalledWith("LLM trace capture resumed.", "info");
	});
});
