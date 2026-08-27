import { describe, expect, it } from "vitest";

import {
  CaptureInvitationEmailProvider,
  validateInvitationEmailInput,
  type InvitationEmailInput,
} from "./email-provider";

const input: InvitationEmailInput = {
  recipientEmail: " Student@Example.test ",
  teacherEmail: "Teacher@Example.test",
  teacherEmailVerified: true,
  teacherName: "Dr. Rao",
  classroomName: "Physics 12-A",
  expiresAt: "2026-09-04T10:00:00.000Z",
  invitationUrl: "http://localhost:3010/invite#token=invite-1.raw-secret",
};
const now = () => new Date("2026-08-28T10:00:00.000Z");

describe("CaptureInvitationEmailProvider", () => {
  it("captures locally without a transport and returns no token or message body", async () => {
    const provider = new CaptureInvitationEmailProvider({ runtimeMode: "test", now });

    const result = await provider.send(input, "attempt-1");

    expect(result).toEqual({ status: "sent", provider: "capture", providerMessageId: "<attempt-1@vijeeta.com>" });
    expect(JSON.stringify(result)).not.toContain("raw-secret");
    expect(provider.captures).toEqual([{ ...input, recipientEmail: "student@example.test", teacherEmail: "teacher@example.test", attemptId: "attempt-1" }]);
  });

  it("fails closed when capture delivery is requested in production", () => {
    expect(() => new CaptureInvitationEmailProvider({ runtimeMode: "production" })).toThrow(/capture.*production/i);
  });

  it("rejects unverified Reply-To identity, invalid email fields, unsafe names, and invalid attempts", async () => {
    const provider = new CaptureInvitationEmailProvider({ runtimeMode: "test", now });

    await expect(provider.send({ ...input, teacherEmailVerified: false }, "attempt-1")).rejects.toThrow(/verified/i);
    await expect(provider.send({ ...input, recipientEmail: "not-email" }, "attempt-1")).rejects.toThrow(/recipient/i);
    await expect(provider.send({ ...input, teacherName: "Teacher\r\nBcc: victim@example.test" }, "attempt-1")).rejects.toThrow(/teacher/i);
    await expect(provider.send(input, "bad.attempt")).rejects.toThrow(/attempt/i);
    expect(provider.captures).toHaveLength(0);
  });

  it("normalizes only bounded one-purpose invitation fields", () => {
    expect(validateInvitationEmailInput(input, { now })).toEqual({
      ...input,
      recipientEmail: "student@example.test",
      teacherEmail: "teacher@example.test",
    });
    expect(() => validateInvitationEmailInput({ ...input, classroomName: "<script>alert(1)</script>" }, { now })).toThrow(/classroom/i);
    expect(() => validateInvitationEmailInput({ ...input, expiresAt: "not-a-date" }, { now })).toThrow(/expiry/i);
  });

  it("rejects an already-expired invitation using an injected clock", async () => {
    const provider = new CaptureInvitationEmailProvider({ runtimeMode: "test", now });

    await expect(provider.send({ ...input, expiresAt: "2026-08-28T09:59:59.999Z" }, "attempt-1")).rejects.toThrow(/expired/i);
    expect(provider.captures).toHaveLength(0);
  });
});
