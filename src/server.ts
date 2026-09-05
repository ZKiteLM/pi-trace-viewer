import { createServer, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import type { SessionRegistration, SessionSnapshot, TraceRecord } from "./types.ts";
import { TraceStore } from "./store.ts";

const require = createRequire(import.meta.url);
const webRoot = fileURLToPath(new URL("../web", import.meta.url));
const markedPath = join(dirname(require.resolve("marked")), "marked.umd.js");
const highlightPath = require.resolve("@highlightjs/cdn-assets/highlight.min.js");

interface RegisteredSession {
	registration: SessionRegistration;
	store: TraceStore;
	unlisten: () => void;
}

export interface ViewerController {
	readonly port: number;
	readonly url: string;
	register(registration: SessionRegistration): TraceStore;
	detach(sessionId: string, snapshot: SessionSnapshot): void;
	notify(sessionId: string, event: string, payload?: unknown): void;
	close(): Promise<void>;
}

class LocalViewerController implements ViewerController {
	readonly port: number;
	readonly url: string;
	private server: Server;
	private sessions = new Map<string, RegisteredSession>();
	private clients = new Set<ServerResponse>();

	private constructor(server: Server, port: number) {
		this.server = server;
		this.port = port;
		this.url = `http://127.0.0.1:${port}`;
	}

	static async start(startPort: number): Promise<LocalViewerController> {
		for (let port = startPort; port <= 65535; port++) {
			try {
				return await new Promise<LocalViewerController>((resolve, reject) => {
					const server = createServer();
					const controller = new LocalViewerController(server, port);
					server.on("request", (request, response) => controller.handle(request.method ?? "GET", request.url ?? "/", response));
					const onError = (err: unknown) => {
						server.close();
						reject(err);
					};
					server.once("error", onError);
					server.listen(port, "127.0.0.1", () => {
						server.off("error", onError);
						resolve(controller);
					});
				});
			} catch (error: unknown) {
				const isAddrInUse =
					typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EADDRINUSE";
				if (isAddrInUse) {
					continue;
				}
				throw error;
			}
		}
		throw new Error(`Could not find an available port from ${startPort} to 65535`);
	}

	register(registration: SessionRegistration): TraceStore {
		const previous = this.sessions.get(registration.id);
		if (previous) {
			previous.registration = registration;
			this.notify(registration.id, "session-updated");
			return previous.store;
		}
		const store = new TraceStore(registration.snapshot);
		const unlisten = store.onRecord((record) => this.broadcast("trace-record", record));
		this.sessions.set(registration.id, { registration, store, unlisten });
		this.notify(registration.id, "session-added");
		return store;
	}

	detach(sessionId: string, snapshot: SessionSnapshot): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.registration = { ...session.registration, getSnapshot: undefined, snapshot: { ...snapshot, active: false } };
		this.notify(sessionId, "session-detached");
	}

	notify(sessionId: string, event: string, payload?: unknown): void {
		this.broadcast(event, { sessionId, payload });
	}

	async close(): Promise<void> {
		for (const client of this.clients) client.end();
		this.clients.clear();
		for (const session of this.sessions.values()) session.unlisten();
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}

	private snapshot(session: RegisteredSession): SessionSnapshot {
		if (session.registration.getSnapshot) {
			try {
				const snapshot = session.registration.getSnapshot();
				session.registration.snapshot = snapshot;
				return snapshot;
			} catch {
				// Keep the last stable snapshot while a session is switching.
			}
		}
		return session.registration.snapshot;
	}

	private handle(method: string, rawUrl: string, response: ServerResponse): void {
		const url = new URL(rawUrl, this.url);
		if (method === "GET" && url.pathname === "/api/events") {
			response.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Content-Type-Options": "nosniff",
			});
			response.write("event: ready\ndata: {}\n\n");
			this.clients.add(response);
			response.on("close", () => this.clients.delete(response));
			return;
		}

		if (method === "GET" && url.pathname === "/api/sessions") {
			const sessions = Array.from(this.sessions.values()).map((session) => {
				const snapshot = this.snapshot(session);
				return {
					id: snapshot.id,
					name: snapshot.name,
					cwd: snapshot.cwd,
					active: snapshot.active,
					updatedAt: snapshot.updatedAt,
					callCount: session.store.getCalls().length,
					tracePersistence: session.store.getPersistence(),
				};
			});
			this.json(response, 200, sessions);
			return;
		}

		const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(calls)(?:\/([^/]+))?|\/(download))?$/);
		if (method === "GET" && match) {
			const sessionId = decodeURIComponent(match[1]);
			const session = this.sessions.get(sessionId);
			if (!session) return this.json(response, 404, { error: "Session not found" });
			if (match[4] === "download") {
				const snapshot = this.snapshot(session);
				response.writeHead(200, {
					"Content-Type": "application/x-ndjson; charset=utf-8",
					"Content-Disposition": `attachment; filename="${sessionId}.jsonl"`,
				});
				response.end([JSON.stringify(snapshot.header), ...snapshot.entries.map((entry) => JSON.stringify(entry))].join("\n"));
				return;
			}
			if (match[2] === "calls") {
				const calls = session.store.getCalls();
				if (match[3]) {
					const call = calls.find((candidate) => candidate.callId === decodeURIComponent(match[3]));
					return this.json(response, call ? 200 : 404, call ?? { error: "Call not found" });
				}
				return this.json(response, 200, calls);
			}
			return this.json(response, 200, { ...this.snapshot(session), tracePersistence: session.store.getPersistence() });
		}

		if (method === "POST" && url.pathname === "/api/refresh") {
			this.broadcast("refresh", {});
			return this.json(response, 200, { ok: true });
		}

		if (method === "GET" && url.pathname === "/vendor/marked.js") return this.file(response, markedPath, "text/javascript");
		if (method === "GET" && url.pathname === "/vendor/highlight.js") return this.file(response, highlightPath, "text/javascript");
		if (method === "GET" && url.pathname === "/favicon.ico") {
			response.writeHead(204, { "Cache-Control": "public, max-age=86400" });
			response.end();
			return;
		}
		if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return this.file(response, join(webRoot, "index.html"), "text/html");
		if (method === "GET" && url.pathname === "/app.js") return this.file(response, join(webRoot, "app.js"), "text/javascript");
		if (method === "GET" && url.pathname === "/render-helpers.js") return this.file(response, join(webRoot, "render-helpers.js"), "text/javascript");
		if (method === "GET" && url.pathname === "/styles.css") return this.file(response, join(webRoot, "styles.css"), "text/css");
		this.json(response, 404, { error: "Not found" });
	}

	private file(response: ServerResponse, path: string, contentType: string): void {
		try {
			const content = readFileSync(path);
			response.writeHead(200, {
				"Content-Type": `${contentType}; charset=utf-8`,
				"Cache-Control": "no-cache",
				"Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
				"X-Content-Type-Options": "nosniff",
				"Referrer-Policy": "no-referrer",
			});
			response.end(content);
		} catch (error) {
			this.json(response, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	}

	private json(response: ServerResponse, status: number, value: unknown): void {
		response.writeHead(status, {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		});
		response.end(JSON.stringify(value));
	}

	private broadcast(event: string, data: unknown): void {
		const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		for (const client of this.clients) client.write(chunk);
	}
}

const CONTROLLER_KEY = Symbol.for("pi-trace-viewer.controller");
interface ViewerGlobal {
	[CONTROLLER_KEY]?: Promise<ViewerController>;
}

export function getViewerController(port: number): Promise<ViewerController> {
	const globalState = globalThis as ViewerGlobal;
	globalState[CONTROLLER_KEY] ??= LocalViewerController.start(port).catch((error) => {
		delete globalState[CONTROLLER_KEY];
		throw error;
	});
	return globalState[CONTROLLER_KEY];
}

export async function closeViewerController(): Promise<void> {
	const globalState = globalThis as ViewerGlobal;
	const controller = globalState[CONTROLLER_KEY];
	if (!controller) return;
	delete globalState[CONTROLLER_KEY];
	const resolved = await controller.catch(() => undefined);
	await resolved?.close();
}
