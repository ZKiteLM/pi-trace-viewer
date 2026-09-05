import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { closeViewerController, getViewerController } from "../src/server.ts";

async function occupyPort(preferredPort = 0): Promise<{ port: number; close: () => Promise<void> }> {
	const server = createServer();
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(preferredPort, "127.0.0.1", () => {
			const port = (server.address() as AddressInfo).port;
			resolve({
				port,
				close: () => new Promise<void>((r) => server.close(() => r())),
			});
		});
	});
}

describe("server port selection", () => {
	afterEach(async () => {
		await closeViewerController();
	});

	it("increments port when startPort is in use (EADDRINUSE)", async () => {
		const occupied = await occupyPort(0);
		try {
			const controller = await getViewerController(occupied.port);
			expect(controller.port).toBe(occupied.port + 1);
			expect(controller.url).toBe(`http://127.0.0.1:${occupied.port + 1}`);
		} finally {
			await occupied.close();
		}
	});

	it("skips multiple consecutive occupied ports", async () => {
		const first = await occupyPort(0);
		let second: { close: () => Promise<void> } | undefined;
		try {
			second = await occupyPort(first.port + 1);
			const controller = await getViewerController(first.port);
			expect(controller.port).toBe(first.port + 2);
		} finally {
			await second?.close();
			await first.close();
		}
	});

	it("fails when the port range up to 65535 is exhausted", async () => {
		let occupied65535: { close: () => Promise<void> } | undefined;
		try {
			occupied65535 = await occupyPort(65535);
		} catch {
			// If 65535 cannot be bound in the current test environment (e.g. system restriction), skip
			return;
		}

		try {
			await expect(getViewerController(65535)).rejects.toThrow(
				"Could not find an available port from 65535 to 65535",
			);
		} finally {
			await occupied65535.close();
		}
	});
});
