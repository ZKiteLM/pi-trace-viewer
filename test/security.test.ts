import { describe, expect, it } from "vitest";
import { redactHeaders, redactSensitive } from "../src/security.ts";

describe("redaction", () => {
	it("redacts credential-shaped keys without removing observable content", () => {
		const input = {
			api_key: "secret",
			content: "keep this prompt",
			nested: { accessToken: "secret-2", model: "gpt" },
		};
		expect(redactSensitive(input)).toEqual({
			api_key: "[REDACTED]",
			content: "keep this prompt",
			nested: { accessToken: "[REDACTED]", model: "gpt" },
		});
	});

	it("redacts sensitive response headers case-insensitively", () => {
		expect(redactHeaders({ "Set-Cookie": "private", "x-request-id": "req-1" })).toEqual({
			"Set-Cookie": "[REDACTED]",
			"x-request-id": "req-1",
		});
	});

	it("handles circular payloads", () => {
		const input: Record<string, unknown> = {};
		input.self = input;
		expect(redactSensitive(input)).toEqual({ self: "[Circular]" });
	});
});
