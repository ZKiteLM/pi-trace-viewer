import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessageEvent, Model, Tool } from "@earendil-works/pi-ai";
import type { SessionEntry, SessionHeader, ToolInfo } from "@earendil-works/pi-coding-agent";

export const TRACE_SCHEMA_VERSION = 1;

export type CallKind = "agent" | "compaction" | "branch_summary" | "unknown";

export interface TraceModel {
	provider: string;
	id: string;
	api?: string;
}

export interface GenericContext {
	systemPrompt: string;
	messages: AgentMessage[];
	tools: Tool[];
}

export interface CompactionContext {
	reason: "manual" | "threshold" | "overflow";
	willRetry: boolean;
	customInstructions?: string;
	firstKeptEntryId: string;
	isSplitTurn: boolean;
	tokensBefore: number;
	previousSummary?: string;
	messagesToSummarize: AgentMessage[];
	turnPrefixMessages: AgentMessage[];
	settings: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
	fileOps: { read: string[]; written: string[]; edited: string[] };
}

export interface TraceRecordBase {
	schemaVersion: typeof TRACE_SCHEMA_VERSION;
	sessionId: string;
	sequence: number;
	timestamp: string;
}

export type TraceRecord = TraceRecordBase &
	(
		| { type: "trace_header"; sessionFile?: string; cwd: string }
		| {
				type: "call_started";
				callId: string;
				kind: CallKind;
				turnIndex?: number;
				leafId?: string | null;
				model?: TraceModel;
				captureSource?: "live" | "session_entry";
				sourceEntryId?: string;
			  }
		| { type: "generic_context"; callId: string; context: GenericContext }
		| { type: "compaction_context"; callId: string; context: CompactionContext }
		| { type: "provider_request"; callId: string; attempt: number; payload: unknown }
		| {
				type: "provider_response";
				callId: string;
				attempt: number;
				status: number;
				headers: Record<string, string>;
			  }
		| { type: "output_event"; callId: string; event: CompactAssistantEvent }
		| { type: "call_completed"; callId: string; message: AgentMessage; leafId?: string | null }
		| { type: "call_failed"; callId: string; error: string }
		| { type: "compaction_completed"; callId: string; summary: string; tokensBefore: number; sourceEntryId?: string }
		| { type: "branch_summary_completed"; callId: string; summary: string; leafId?: string | null }
	);

type WithoutPartial<T> = T extends unknown ? Omit<T, "partial"> : never;
export type CompactAssistantEvent = WithoutPartial<AssistantMessageEvent>;

export interface SessionSnapshot {
	id: string;
	name?: string;
	cwd: string;
	file?: string;
	header: SessionHeader | null;
	entries: SessionEntry[];
	leafId: string | null;
	systemPrompt?: string;
	tools: ToolInfo[];
	active: boolean;
	updatedAt: string;
}

export interface SessionRegistration {
	id: string;
	cwd: string;
	file?: string;
	getSnapshot?: () => SessionSnapshot;
	snapshot: SessionSnapshot;
}

export interface CallView {
	callId: string;
	kind: CallKind;
	startedAt: string;
	completedAt?: string;
	turnIndex?: number;
	leafId?: string | null;
	model?: TraceModel;
	captureSource?: "live" | "session_entry";
	sourceEntryId?: string;
	status: "running" | "success" | "error";
	context?: GenericContext;
	compactionContext?: CompactionContext;
	providerRequests: Array<{ attempt: number; timestamp: string; payload: unknown }>;
	providerResponses: Array<{ attempt: number; timestamp: string; status: number; headers: Record<string, string> }>;
	outputEvents: Array<{ timestamp: string; event: CompactAssistantEvent }>;
	finalMessage?: unknown;
	error?: string;
}

export function toTraceModel(model: Model<Api> | undefined): TraceModel | undefined {
	if (!model) return undefined;
	return { provider: model.provider, id: model.id, api: model.api };
}
