import type { ExtensionContext, MessageEndEvent, MessageUpdateEvent } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { TraceCollector } from "../src/collector.ts";
import { TraceStore } from "../src/store.ts";
import type { SessionSnapshot } from "../src/types.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("TraceCollector", () => {
	it("correlates generic context, provider payload, stream events, and final output", () => {
		const snapshot = createSnapshot();
		const store = new TraceStore(snapshot);
		const collector = new TraceCollector(store, () => snapshot);
		const context = { getSystemPrompt: () => "system", model: undefined } as unknown as ExtensionContext;

		collector.startTurn(3);
		collector.onContext({ type: "context", messages: [] }, context);
		collector.onProviderRequest({ type: "before_provider_request", payload: { model: "test", api_key: "secret" } }, context);
		collector.onProviderResponse({ type: "after_provider_response", status: 200, headers: { "x-request-id": "req-1" } }, context);
		collector.onMessageUpdate({
			type: "message_update",
			message: {},
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "ok", partial: {} },
		} as unknown as MessageUpdateEvent);
		collector.onMessageEnd({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				stopReason: "stop",
			},
		} as unknown as MessageEndEvent);

		const call = store.getCalls()[0];
		expect(call.turnIndex).toBe(3);
		expect(call.status).toBe("success");
		expect(call.context?.systemPrompt).toBe("system");
		expect(call.providerRequests[0].payload).toEqual({ model: "test", api_key: "[REDACTED]" });
		expect(call.outputEvents[0].event).toEqual({ type: "text_delta", contentIndex: 0, delta: "ok" });
	});

	it("captures an internal compaction request with its resulting summary", () => {
		const snapshot = createSnapshot();
		const store = new TraceStore(snapshot);
		const collector = new TraceCollector(store, () => snapshot);
		const context = { getSystemPrompt: () => "system", model: undefined } as unknown as ExtensionContext;

		collector.beginCompaction(createBeforeCompactEvent(), context);
		collector.onProviderRequest({ type: "before_provider_request", payload: { input: "summary prompt" } }, context);
		collector.onCompaction({
			type: "session_compact",
			compactionEntry: { summary: "compressed", tokensBefore: 12_000 },
		} as never);

		const call = store.getCalls()[0];
		expect(call.kind).toBe("compaction");
		expect(call.status).toBe("success");
		expect(call.context).toBeUndefined();
		expect(call.compactionContext).toMatchObject({ reason: "manual", tokensBefore: 12_000 });
		expect(call.compactionContext?.messagesToSummarize).toHaveLength(1);
		expect(call.finalMessage).toMatchObject({ role: "assistant", content: [{ text: "compressed" }] });
	});

	it("records compaction even when provider hooks are unavailable", () => {
		const snapshot = createSnapshot();
		const store = new TraceStore(snapshot);
		const collector = new TraceCollector(store, () => snapshot);
		const context = { getSystemPrompt: () => "system", model: undefined } as unknown as ExtensionContext;

		collector.beginCompaction(createBeforeCompactEvent(), context);
		collector.onCompaction({
			type: "session_compact",
			compactionEntry: { summary: "semantic hook summary", tokensBefore: 24_000 },
		} as never);

		const call = store.getCalls()[0];
		expect(call.kind).toBe("compaction");
		expect(call.providerRequests).toHaveLength(0);
		expect(call.status).toBe("success");
		expect(call.finalMessage).toMatchObject({
			role: "assistant",
			content: [{ type: "text", text: "semantic hook summary" }],
		});
	});

	it("keeps custom messages in captured generic context", () => {
		const snapshot = createSnapshot();
		const store = new TraceStore(snapshot);
		const collector = new TraceCollector(store, () => snapshot);
		const context = { getSystemPrompt: () => "system", model: undefined } as unknown as ExtensionContext;

		collector.onContext({
			type: "context",
			messages: [{
				role: "custom",
				customType: "example-plugin",
				content: "Injected context",
				display: false,
				timestamp: 1,
			}],
		}, context);

		const call = store.getCalls()[0];
		expect(call.context?.messages[0]).toMatchObject({
			role: "custom",
			customType: "example-plugin",
			content: "Injected context",
			display: false,
		});
	});
});

function createBeforeCompactEvent() {
	return {
		type: "session_before_compact",
		preparation: {
			firstKeptEntryId: "kept-entry",
			messagesToSummarize: [{ role: "user", content: [{ type: "text", text: "old context" }], timestamp: 1 }],
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 12_000,
			fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
			settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
		},
		branchEntries: [],
		reason: "manual",
		willRetry: false,
		signal: new AbortController().signal,
	} as never;
}

function createSnapshot(): SessionSnapshot {
	const directory = mkdtempSync(join(tmpdir(), "pi-trace-collector-test-"));
	temporaryDirectories.push(directory);
	return {
		id: "session-memory",
		cwd: directory,
		header: { type: "session", version: 3, id: "session-memory", timestamp: new Date(0).toISOString(), cwd: directory },
		entries: [],
		leafId: null,
		tools: [],
		active: true,
		updatedAt: new Date(0).toISOString(),
	};
}
