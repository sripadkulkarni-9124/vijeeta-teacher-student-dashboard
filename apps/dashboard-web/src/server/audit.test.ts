import { describe, expect, it } from "vitest";

import { AuditEventSchema, type AuditEvent } from "@vijeeta/api-contracts";

import { JsonLineAuditWriter, StructuredAuditEmitter } from "./audit";

const event: AuditEvent = {
  id: "audit-1",
  actorUid: "admin-uid",
  actorProfileId: "profile-admin",
  action: "teacher.approved",
  targetType: "profile",
  targetId: "teacher-uid",
  reason: "Approved teacher@example.com after reviewing Bearer secret-token",
  correlationId: "123e4567-e89b-12d3-a456-426614174000",
  before: {
    count: 2,
    entries: [
      { field: "roles.teacher", value: "pending" },
      { field: "verifiedEmail", value: "teacher@example.com" },
    ],
  },
  after: {
    count: 2,
    entries: [
      { field: "roles.teacher", value: "active" },
      { field: "tokenDigest", value: "digest-that-must-not-be-logged" },
    ],
  },
  canonicalLogInsertId: "audit-1",
  createdAt: "2026-08-28T08:00:00.000Z",
};

describe("StructuredAuditEmitter", () => {
  it("writes a bounded structured audit DTO without full emails, tokens, or digests", async () => {
    const records: unknown[] = [];
    const emitter = new StructuredAuditEmitter({
      write: async (record) => { records.push(record); },
    });

    await emitter.emit(event);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      severity: "NOTICE",
      message: "vijeeta_dashboard_audit",
      insertId: "audit-1",
      audit: {
        eventId: "audit-1",
        action: "teacher.approved",
        reason: "Approved [REDACTED_EMAIL] after reviewing Bearer [REDACTED]",
        before: [
          { field: "roles.teacher", value: "pending" },
          { field: "verifiedEmail", value: "[REDACTED]" },
        ],
        after: [
          { field: "roles.teacher", value: "active" },
          { field: "tokenDigest", value: "[REDACTED]" },
        ],
      },
    });
    expect(JSON.stringify(records[0])).not.toContain("teacher@example.com");
    expect(JSON.stringify(records[0])).not.toContain("secret-token");
    expect(JSON.stringify(records[0])).not.toContain("digest-that-must-not-be-logged");
  });

  it("validates through the canonical audit contract before writing", async () => {
    const records: unknown[] = [];
    const emitter = new StructuredAuditEmitter({ write: async (record) => { records.push(record); } });

    await expect(emitter.emit({ ...event, correlationId: "forged" })).rejects.toThrow();
    expect(records).toEqual([]);
  });

  it("uses the canonical contract for the bootstrap action required by the store", () => {
    expect(AuditEventSchema.safeParse({ ...event, action: "admin.bootstrap" }).success).toBe(true);
  });

  it("exposes append-only emission without update or delete operations", () => {
    const emitter = new StructuredAuditEmitter({ write: async () => {} });

    expect("update" in emitter).toBe(false);
    expect("delete" in emitter).toBe(false);
  });

  it("appends one structured JSON line for the production logging stream", async () => {
    const lines: string[] = [];
    const writer = new JsonLineAuditWriter((line) => { lines.push(line); });

    await writer.write({
      severity: "NOTICE",
      message: "vijeeta_dashboard_audit",
      insertId: "audit-1",
      audit: {
        eventId: "audit-1",
        actorUid: "admin-uid",
        actorProfileId: "profile-admin",
        action: "teacher.approved",
        targetType: "profile",
        targetId: "teacher-uid",
        correlationId: "123e4567-e89b-12d3-a456-426614174000",
        reason: null,
        createdAt: "2026-08-28T08:00:00.000Z",
      },
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      message: "vijeeta_dashboard_audit",
      insertId: "audit-1",
    });
  });

  it("redacts credentials, cookies, API keys, and JWT-like values while preserving safe context", async () => {
    const records: unknown[] = [];
    const emitter = new StructuredAuditEmitter({ write: async (record) => { records.push(record); } });
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.signature12345";
    const sensitiveValues = [
      "hunter2",
      "sk_live_1234567890",
      "session=abc123",
      "dXNlcjpwYXNz",
      "access-value",
      "refresh-value",
      jwt,
      "stored-password-hash",
    ];

    await emitter.emit({
      ...event,
      reason: `Review context password=hunter2 api_key=sk_live_1234567890 Cookie:session=abc123 Authorization=Basic dXNlcjpwYXNz ${jwt}`,
      before: {
        count: 1,
        entries: [{ field: "metadata", value: "access_token=access-value refresh_token:refresh-value" }],
      },
      after: {
        count: 1,
        entries: [{ field: "passwordHash", value: "stored-password-hash" }],
      },
    });

    const serialized = JSON.stringify(records[0]);
    for (const sensitive of sensitiveValues) expect(serialized).not.toContain(sensitive);
    expect(records[0]).toMatchObject({
      audit: {
        reason: expect.stringContaining("Review context"),
        before: [{ field: "metadata", value: "access_token=[REDACTED] refresh_token=[REDACTED]" }],
        after: [{ field: "passwordHash", value: "[REDACTED]" }],
      },
    });
  });
});
