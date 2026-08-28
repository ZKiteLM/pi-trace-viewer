import { randomUUID } from "node:crypto";
import type {
	BeforeProviderRequestEvent,
	ContextEvent,
	ExtensionContext,
	MessageEndEvent,
	MessageUpdateEvent,
	SessionCompactEvent,
	SessionBeforeCompactEvent,
	SessionTreeEvent,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessageEvent, Tool } from "@earendil-works/pi-ai";
import { redactHeaders, redactSensitive } from "./security.ts";
import { TraceStore } from "./store.ts";
import type { CallKind, CompactAssistantEvent, SessionSnapshot } from "./types.ts";
import { toTraceModel } from "./types.ts";

interface ActiveCall {
	id: string;
	kind: CallKind;
	attempt: number;
}

interface AfterProviderResponseEvent {
	type: "after_provider_response";
	status: number;
	headers: Record<string, string>;
}

export class TraceCollector {
	private activeCall: ActiveCall | undefined;
	private nextKind: CallKind = "agent";
	private turnIndex: number | undefined;
	private systemPrompt = "";
	private tools: ToolInfo[] = [];

	constructor(
		private store: TraceStore,
		private snapshot: () => SessionSnapshot,
	) {}

	setSystemPrompt(systemPrompt: string): void {
		this.systemPrompt = systemPrompt;
	}

	setTools(tools: ToolInfo[]): void {
		this.tools = structuredClone(tools);
	}

	startTurn(turnIndex: number): void {
		this.turnIndex = turnIndex;
		this.nextKind = "agent";
	}

	prepare(kind: Extract<CallKind, "compaction" | "branch_summary">, ctx?: ExtensionContext): void {
		this.nextKind = kind;
	}

	beginCompaction(event: SessionBeforeCompactEvent, ctx: ExtensionContext): void {
		this.nextKind = "compaction";
		if (this.activeCall) this.failActive("Superseded by context compaction");
		const call = this.startCall("compaction", ctx);
		const preparation = event.preparation;
		this.store.append({
			type: "compaction_context",
			callId: call.id,
			context: {
				reason: event.reason,
				willRetry: event.willRetry,
				customInstructions: event.customInstructions,
				firstKeptEntryId: preparation.firstKeptEntryId,
				isSplitTurn: preparation.isSplitTurn,
				tokensBefore: preparation.tokensBefore,
				previousSummary: preparation.previousSummary,
				messagesToSummarize: structuredClone(preparation.messagesToSummarize),
				turnPrefixMessages: structuredClone(preparation.turnPrefixMessages),
				settings: structuredClone(preparation.settings),
				fileOps: {
					read: [...preparation.fileOps.read],
					written: [...preparation.fileOps.written],
					edited: [...preparation.fileOps.edited],
				},
			},
		});
	}

	onContext(event: ContextEvent, ctx: ExtensionContext): void {
		if (this.activeCall) this.failActive("Superseded by the next LLM context");
		this.nextKind = "agent";
		const call = this.startCall("agent", ctx);
		const activeNames = new Set(this.tools.map((tool) => tool.name));
		const tools: Tool[] = this.tools
			.filter((tool) => activeNames.has(tool.name))
			.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
		this.store.append({
			type: "generic_context",
			callId: call.id,
			context: {
				systemPrompt: ctx.getSystemPrompt() || this.systemPrompt,
				messages: structuredClone(event.messages),
				tools,
			},
		});
	}

	onProviderRequest(event: BeforeProviderRequestEvent, ctx: ExtensionContext): void {
		const call = this.activeCall ?? this.startCall(this.nextKind === "agent" ? "unknown" : this.nextKind, ctx);
		call.attempt += 1;
		this.store.append({
			type: "provider_request",
			callId: call.id,
			attempt: call.attempt,
			payload: redactSensitive(structuredClone(event.payload)),
		});
	}

	onProviderResponse(event: AfterProviderResponseEvent, ctx: ExtensionContext): void {
		const call = this.activeCall ?? this.startCall(this.nextKind === "agent" ? "unknown" : this.nextKind, ctx);
		this.store.append({
			type: "provider_response",
			callId: call.id,
			attempt: Math.max(call.attempt, 1),
			status: event.status,
			headers: redactHeaders(event.headers),
		});
	}

	onMessageUpdate(event: MessageUpdateEvent): void {
		if (!this.activeCall || this.activeCall.kind !== "agent") return;
		this.store.append({
			type: "output_event",
			callId: this.activeCall.id,
			event: compactEvent(event.assistantMessageEvent),
		});
	}

	onMessageEnd(event: MessageEndEvent): void {
		if (event.message.role !== "assistant" || !this.activeCall || this.activeCall.kind !== "agent") return;
		const snapshot = this.snapshot();
		if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
			this.store.append({
				type: "call_failed",
				callId: this.activeCall.id,
				error: event.message.errorMessage ?? event.message.stopReason,
			});
		} else {
			this.store.append({
				type: "call_completed",
				callId: this.activeCall.id,
				message: structuredClone(event.message),
				leafId: snapshot.leafId,
			});
		}
		this.activeCall = undefined;
	}

	onCompaction(event: SessionCompactEvent): void {
		if (!this.activeCall || this.activeCall.kind !== "compaction") return;
		this.store.append({
			type: "compaction_completed",
			callId: this.activeCall.id,
			summary: event.compactionEntry.summary,
			tokensBefore: event.compactionEntry.tokensBefore,
			sourceEntryId: event.compactionEntry.id,
		});
		this.activeCall = undefined;
		this.nextKind = "agent";
	}

	onTree(event: SessionTreeEvent): void {
		this.nextKind = "agent";
		if (!this.activeCall || this.activeCall.kind !== "branch_summary") return;
		if (!event.summaryEntry) {
			this.failActive("Tree navigation completed without a generated summary");
			return;
		}
		this.store.append({
			type: "branch_summary_completed",
			callId: this.activeCall.id,
			summary: event.summaryEntry.summary,
			leafId: event.newLeafId,
		});
		this.activeCall = undefined;
	}

	onCompactionFailed(error: string): void {
		this.nextKind = "agent";
		if (this.activeCall?.kind === "compaction") this.failActive(error);
	}

	private startCall(kind: CallKind, ctx: ExtensionContext): ActiveCall {
		const snapshot = this.snapshot();
		const call: ActiveCall = { id: randomUUID(), kind, attempt: 0 };
		this.activeCall = call;
		this.store.append({
			type: "call_started",
			callId: call.id,
			kind,
			turnIndex: this.turnIndex,
			leafId: snapshot.leafId,
			model: toTraceModel(ctx.model),
		});
		return call;
	}

	private failActive(error: string): void {
		if (!this.activeCall) return;
		this.store.append({ type: "call_failed", callId: this.activeCall.id, error });
		this.activeCall = undefined;
	}
}

function compactEvent(event: AssistantMessageEvent): CompactAssistantEvent {
	const copy = structuredClone(event) as AssistantMessageEvent & { partial?: unknown };
	delete copy.partial;
	return copy;
}
