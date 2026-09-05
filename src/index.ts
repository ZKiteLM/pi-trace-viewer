import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { TraceCollector } from "./collector.ts";
import { closeViewerController, getViewerController, type ViewerController } from "./server.ts";
import type { SessionSnapshot } from "./types.ts";

interface BoundSession {
	id: string;
	collector: TraceCollector;
	getSnapshot: () => SessionSnapshot;
}

export default function piTraceViewer(pi: ExtensionAPI): void {
	pi.registerFlag("pi-trace-port", {
		description: "Local port for the pi trace viewer",
		type: "string",
		default: "7890",
	});

	let controller: ViewerController | undefined;
	let bound: BoundSession | undefined;
	let lastSystemPrompt = "";
	let latestTools: ToolInfo[] = [];

	pi.registerCommand("trace-view", {
		description: "Show the local session and LLM trace viewer URL",
		handler: async (_args, ctx) => {
			if (!controller) {
				ctx.ui.notify("Trace viewer is not running. Check the startup error above.", "error");
				return;
			}
			const suffix = bound ? `?session=${encodeURIComponent(bound.id)}` : "";
			ctx.ui.notify(`${controller.url}/${suffix}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const port = parsePort(pi.getFlag("pi-trace-port"));
		try {
			controller = await getViewerController(port);
		} catch (error) {
			ctx.ui.notify(
				`Trace viewer could not bind 127.0.0.1:${port}: ${error instanceof Error ? error.message : String(error)}. Use --pi-trace-port to choose another port. Trace capture is disabled for this session.`,
				"error",
			);
			return;
		}

		latestTools = activeTools(pi);
		const getSnapshot = (): SessionSnapshot => snapshotFromContext(ctx, latestTools, lastSystemPrompt, true);
		const initial = getSnapshot();
		const store = controller.register({
			id: initial.id,
			cwd: initial.cwd,
			file: initial.file,
			getSnapshot,
			snapshot: initial,
		});
		const collector = new TraceCollector(store, getSnapshot);
		collector.setTools(latestTools);
		collector.setSystemPrompt(lastSystemPrompt || ctx.getSystemPrompt());
		bound = { id: initial.id, collector, getSnapshot };
		ctx.ui.notify(`Trace viewer: ${controller.url}/?session=${encodeURIComponent(initial.id)}`, "info");
	});

	pi.on("before_agent_start", (event) => {
		lastSystemPrompt = event.systemPrompt;
		latestTools = activeTools(pi);
		bound?.collector.setSystemPrompt(event.systemPrompt);
		bound?.collector.setTools(latestTools);
	});

	pi.on("turn_start", (event) => bound?.collector.startTurn(event.turnIndex));
	pi.on("context", (event, ctx) => bound?.collector.onContext(event, ctx));
	pi.on("before_provider_request", (event, ctx) => bound?.collector.onProviderRequest(event, ctx));
	pi.on("after_provider_response", (event, ctx) => bound?.collector.onProviderResponse(event, ctx));
	pi.on("message_update", (event) => bound?.collector.onMessageUpdate(event));
	pi.on("message_end", (event) => bound?.collector.onMessageEnd(event));
	pi.on("session_before_compact", (event, ctx) => bound?.collector.beginCompaction(event, ctx));
	pi.on("session_compact", (event) => bound?.collector.onCompaction(event));
	pi.on("session_compact_failed", (event) =>
		bound?.collector.onCompactionFailed(event.errorMessage ?? (event.aborted ? "Compaction aborted" : "Compaction failed")),
	);
	pi.on("session_before_tree", () => bound?.collector.prepare("branch_summary"));
	pi.on("session_tree", (event) => bound?.collector.onTree(event));

	const notifySessionUpdated = () => {
		if (bound) controller?.notify(bound.id, "session-updated");
	};
	pi.on("session_info_changed", notifySessionUpdated);
	pi.on("model_select", notifySessionUpdated);
	pi.on("thinking_level_select", notifySessionUpdated);
	pi.on("message_end", notifySessionUpdated);
	pi.on("session_compact", notifySessionUpdated);
	pi.on("session_tree", notifySessionUpdated);

	pi.on("session_shutdown", async (event) => {
		if (bound && controller) {
			const finalSnapshot = { ...bound.getSnapshot(), active: false, updatedAt: new Date().toISOString() };
			controller.detach(bound.id, finalSnapshot);
		}
		bound = undefined;
		lastSystemPrompt = "";
		latestTools = [];
		if (event.reason === "quit") {
			await closeViewerController();
			controller = undefined;
		}
	});
}

function parsePort(value: boolean | string | undefined): number {
	const port = typeof value === "string" ? Number.parseInt(value, 10) : 7890;
	return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 7890;
}

function activeTools(pi: ExtensionAPI): ToolInfo[] {
	const active = new Set(pi.getActiveTools());
	return pi.getAllTools().filter((tool) => active.has(tool.name));
}

function snapshotFromContext(
	ctx: ExtensionContext,
	tools: ToolInfo[],
	systemPrompt: string,
	active: boolean,
): SessionSnapshot {
	const manager = ctx.sessionManager;
	return {
		id: manager.getSessionId(),
		name: manager.getSessionName(),
		cwd: manager.getCwd(),
		file: manager.getSessionFile(),
		header: structuredClone(manager.getHeader()),
		entries: structuredClone(manager.getEntries()),
		leafId: manager.getLeafId(),
		systemPrompt: systemPrompt || ctx.getSystemPrompt(),
		tools: structuredClone(tools),
		active,
		updatedAt: new Date().toISOString(),
	};
}
