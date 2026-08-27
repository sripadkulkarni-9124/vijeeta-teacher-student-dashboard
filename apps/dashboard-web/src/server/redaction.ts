const SECRET_HEADER = /^(authorization|cookie|set-cookie|x-admin-key|x-api-key|proxy-authorization)$/i;

export function redactHeaders(headers: HeadersInit | Record<string, string>): Record<string, string> {
  const entries = headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers);
  return Object.fromEntries(entries.map(([key, value]) => [key, SECRET_HEADER.test(key) ? "[REDACTED]" : String(value)]));
}

export function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]").replace(/(?:cookie|set-cookie)\s*[:=]\s*[^;\s]+/gi, "$1=[REDACTED]").slice(0, 300);
}
