import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TraceStore } from "../src/store.ts";
import type { SessionSnapshot } from "../src/types.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("TraceStore", () => {
	it("persists records with stable sequence numbers and owner-only permissions", () => {
		const { store } = createStore();
		store.append({
			type: "call_started",
			callId: "call-1",
			kind: "agent",
			turnIndex: 2,
		});
		store.append({
			type: "provider_request",
			callId: "call-1",
			attempt: 1,
			payload: { model: "example" },
		});
		expect(store.getRecords().map((record) => record.sequence)).toEqual([1, 2, 3]);
		expect(statSync(store.filePath!).mode & 0o777).toBe(0o600);
		expect(readFileSync(store.filePath!, "utf8").trim().split("\n")).toHaveLength(3);
	});

	it("groups event records into a call view", () => {
		const { store } = createStore();
		store.append({ type: "call_started", callId: "call-1", kind: "agent", turnIndex: 0 });
		store.append({
			type: "generic_context",
			callId: "call-1",
			context: { systemPrompt: "system", messages: [], tools: [] },
		});
		store.append({ type: "provider_request", callId: "call-1", attempt: 1, payload: { input: [] } });
		store.append({ type: "output_event", callId: "call-1", event: { type: "text_delta", contentIndex: 0, delta: "ok" } });
		store.append({
			type: "call_completed",
			callId: "call-1",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				api: "openai-responses",
				provider: "example",
				model: "model",
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 1,
			},
		});
		const call = store.getCalls()[0];
		expect(call.status).toBe("success");
		expect(call.context?.systemPrompt).toBe("system");
		expect(call.providerRequests).toHaveLength(1);
		expect(call.outputEvents[0].event).toMatchObject({ type: "text_delta", delta: "ok" });
	});

	it("ignores a truncated final JSONL record during recovery", () => {
		const { snapshot, store } = createStore();
		writeFileSync(store.filePath!, `${readFileSync(store.filePath!, "utf8")}{"broken":`, "utf8");
		const recovered = new TraceStore(snapshot);
		expect(recovered.getRecords()).toHaveLength(1);
	});

	it("recovers a historical compaction call from the session entry", () => {
		const { snapshot } = createStore();
		snapshot.entries = [{
			type: "compaction",
			id: "compact-entry",
			parentId: null,
			timestamp: new Date(1000).toISOString(),
			summary: "historical summary",
			tokensBefore: 12_345,
			firstKeptEntryId: "kept-entry",
		}];
		const recovered = new TraceStore(snapshot);
		const compact = recovered.getCalls().find((call) => call.kind === "compaction");
		expect(compact).toMatchObject({ status: "success", captureSource: "session_entry", sourceEntryId: "compact-entry" });
		expect(compact?.providerRequests).toHaveLength(0);
	});
});

function createStore(): { snapshot: SessionSnapshot; store: TraceStore } {
	const directory = mkdtempSync(join(tmpdir(), "pi-trace-test-"));
	temporaryDirectories.push(directory);
	const sessionFile = join(directory, "session.jsonl");
	writeFileSync(sessionFile, "", "utf8");
	const snapshot: SessionSnapshot = {
		id: "session-1",
		cwd: directory,
		file: sessionFile,
		header: { type: "session", version: 3, id: "session-1", timestamp: new Date(0).toISOString(), cwd: directory },
		entries: [],
		leafId: null,
		tools: [],
		active: true,
		updatedAt: new Date(0).toISOString(),
	};
	return { snapshot, store: new TraceStore(snapshot) };
}
