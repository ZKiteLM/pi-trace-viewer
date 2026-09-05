import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CallView, SessionSnapshot, TracePersistence, TraceRecord } from "./types.ts";
import { TRACE_SCHEMA_VERSION } from "./types.ts";

export type TraceListener = (record: TraceRecord) => void;
type TraceRecordInput = TraceRecord extends infer RecordType
	? RecordType extends TraceRecord
		? Omit<RecordType, "schemaVersion" | "sessionId" | "sequence" | "timestamp"> & { timestamp?: string }
		: never
	: never;

export class TraceStore {
	readonly sessionId: string;
	filePath: string | undefined;
	private records: TraceRecord[] = [];
	private sequence = 0;
	private listeners = new Set<TraceListener>();
	private persistence: TracePersistence;

	constructor(snapshot: SessionSnapshot) {
		this.sessionId = snapshot.id;
		const filePath = join(snapshot.cwd, ".pi-traces", `${snapshot.id}.jsonl`);
		const error = validateTraceDirectory(snapshot.cwd);
		this.filePath = error ? undefined : filePath;
		this.persistence = error ? { status: "memory_only", error } : { status: "persisted", filePath };
		this.load();
		if (!this.records.some((record) => record.type === "trace_header")) {
			this.append({ type: "trace_header", sessionFile: snapshot.file, cwd: snapshot.cwd });
		}
		this.reconcileHistoricalCompactions(snapshot);
	}

	onRecord(listener: TraceListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	append(record: TraceRecordInput): TraceRecord {
		const complete = {
			...record,
			schemaVersion: TRACE_SCHEMA_VERSION,
			sessionId: this.sessionId,
			sequence: ++this.sequence,
			timestamp: record.timestamp ?? new Date().toISOString(),
		} as TraceRecord;
		this.records.push(complete);
		if (this.filePath) {
			try {
				mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
				appendFileSync(this.filePath, `${JSON.stringify(complete)}\n`, { encoding: "utf8", mode: 0o600 });
				chmodSync(this.filePath, 0o600);
			} catch (error) {
				this.persistence = {
					status: "memory_only",
					error: error instanceof Error ? error.message : String(error),
				};
				this.filePath = undefined;
			}
		}
		for (const listener of this.listeners) listener(complete);
		return complete;
	}

	getPersistence(): TracePersistence {
		return { ...this.persistence };
	}

	getRecords(): readonly TraceRecord[] {
		return this.records;
	}

	getCalls(): CallView[] {
		const calls = new Map<string, CallView>();
		for (const record of this.records) {
			if (!("callId" in record)) continue;
			if (record.type === "call_started") {
				calls.set(record.callId, {
					callId: record.callId,
					kind: record.kind,
					startedAt: record.timestamp,
					turnIndex: record.turnIndex,
					leafId: record.leafId,
					model: record.model,
					captureSource: record.captureSource ?? "live",
					sourceEntryId: record.sourceEntryId,
					status: "running",
					providerRequests: [],
					providerResponses: [],
					outputEvents: [],
				});
				continue;
			}
			const call = calls.get(record.callId);
			if (!call) continue;
			switch (record.type) {
				case "generic_context":
					call.context = record.context;
					break;
				case "compaction_context":
					call.compactionContext = record.context;
					break;
				case "provider_request":
					call.providerRequests.push({ attempt: record.attempt, timestamp: record.timestamp, payload: record.payload });
					break;
				case "provider_response":
					call.providerResponses.push({
						attempt: record.attempt,
						timestamp: record.timestamp,
						status: record.status,
						headers: record.headers,
					});
					break;
				case "output_event":
					call.outputEvents.push({ timestamp: record.timestamp, event: record.event });
					break;
				case "call_completed":
					call.status = "success";
					call.completedAt = record.timestamp;
					call.finalMessage = record.message;
					call.leafId = record.leafId ?? call.leafId;
					break;
				case "call_failed":
					call.status = "error";
					call.completedAt = record.timestamp;
					call.error = record.error;
					break;
				case "compaction_completed":
					call.status = "success";
					call.completedAt = record.timestamp;
					call.finalMessage = { role: "assistant", content: [{ type: "text", text: record.summary }] };
					break;
				case "branch_summary_completed":
					call.status = "success";
					call.completedAt = record.timestamp;
					call.leafId = record.leafId ?? call.leafId;
					call.finalMessage = { role: "assistant", content: [{ type: "text", text: record.summary }] };
					break;
			}
		}
		return Array.from(calls.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
	}

	private load(): void {
		if (!this.filePath || !existsSync(this.filePath)) return;
		const loaded: TraceRecord[] = [];
		for (const line of readFileSync(this.filePath, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const record = JSON.parse(line) as TraceRecord;
				if (record.schemaVersion === TRACE_SCHEMA_VERSION && record.sessionId === this.sessionId) loaded.push(record);
			} catch {
				// A truncated final line is expected after an abrupt process exit.
			}
		}
		this.records = loaded;
		this.sequence = loaded.reduce((max, record) => Math.max(max, record.sequence), 0);
	}

	private reconcileHistoricalCompactions(snapshot: SessionSnapshot): void {
		const completed = this.records.filter((record) => record.type === "compaction_completed");
		for (const entry of snapshot.entries) {
			if (entry.type !== "compaction") continue;
			const alreadyCaptured = completed.some(
				(record) =>
					record.sourceEntryId === entry.id ||
					(record.summary === entry.summary && record.tokensBefore === entry.tokensBefore),
			);
			if (alreadyCaptured) continue;
			const callId = `session-compaction-${entry.id}`;
			this.append({
				type: "call_started",
				callId,
				kind: "compaction",
				leafId: entry.parentId,
				captureSource: "session_entry",
				sourceEntryId: entry.id,
				timestamp: entry.timestamp,
			});
			this.append({
				type: "compaction_completed",
				callId,
				summary: entry.summary,
				tokensBefore: entry.tokensBefore,
				sourceEntryId: entry.id,
				timestamp: entry.timestamp,
			});
		}
	}
}

function validateTraceDirectory(cwd: string): string | undefined {
	try {
		const stat = statSync(cwd);
		if (!stat.isDirectory()) return `Trace cwd is not a directory: ${cwd}`;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	return undefined;
}
