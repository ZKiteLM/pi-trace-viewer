const SENSITIVE_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password)$/i;

export function redactSensitive(value: unknown, seen = new WeakSet<object>()): unknown {
	if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen));
	if (!value || typeof value !== "object") return value;
	if (seen.has(value)) return "[Circular]";
	seen.add(value);

	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitive(item, seen);
	}
	return result;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(headers).map(([key, value]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : value]),
	);
}
