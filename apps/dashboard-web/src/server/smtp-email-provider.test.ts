import { describe, expect, it, vi } from "vitest";

import {
  SMTP_INVITATION_FROM,
  createSmtpInvitationEmailProvider,
  type SmtpMail,
  type SmtpTransport,
  type SmtpTransportOptions,
} from "./smtp-email-provider";

const baseConfig = {
  runtimeMode: "production" as const,
  publicUrl: "https://dashboard.example",
  host: "smtp.relay.example",
  port: 587,
  tlsMode: "starttls_required" as const,
  username: "smtp-user",
  password: "smtp-password",
  from: "ViJEEta <invites@vijeeta.com>",
};

const input = {
  recipientEmail: " Student@Example.test ",
  teacherEmail: "Teacher@Example.test",
  teacherEmailVerified: true as const,
  teacherName: "Dr. <Rao>",
  classroomName: "Physics & Chemistry",
  expiresAt: "2026-09-04T10:00:00.000Z",
  invitationUrl: "https://dashboard.example/invite#token=invite-1.raw-secret",
};
const now = () => new Date("2026-08-28T10:00:00.000Z");

function harness(result: unknown = { messageId: "relay-id", accepted: ["student@example.test"], rejected: [] }) {
  const sent: SmtpMail[] = [];
  const options: SmtpTransportOptions[] = [];
  const transport: SmtpTransport = {
    sendMail: vi.fn(async (mail) => {
      sent.push(mail);
      return result as { messageId?: string };
    }),
  };
  const provider = createSmtpInvitationEmailProvider(baseConfig, (candidate) => {
    options.push(candidate);
    return transport;
  }, { now });
  return { provider, transport, sent, options };
}

describe("SMTP invitation composition", () => {
  it("uses the exact sender, normalized recipient, verified Teacher Reply-To, deterministic Message-ID, and safe bodies", async () => {
    const { provider, sent } = harness();

    const result = await provider.send(input, "attempt-1");

    expect(result).toEqual({ status: "sent", provider: "smtp", providerMessageId: "<attempt-1@vijeeta.com>" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: SMTP_INVITATION_FROM,
      to: "student@example.test",
      replyTo: { name: "Dr. <Rao>", address: "teacher@example.test" },
      messageId: "<attempt-1@vijeeta.com>",
    });
    expect(sent[0]!.text).toContain("Dr. <Rao> (teacher@example.test)");
    expect(sent[0]!.text).toContain(input.invitationUrl);
    expect(sent[0]!.html).toContain("Dr. &lt;Rao&gt; (teacher@example.test)");
    expect(sent[0]!.html).toContain("Physics &amp; Chemistry");
    expect(sent[0]!.html).toContain("href=\"https://dashboard.example/invite#token=invite-1.raw-secret\"");
    expect(JSON.stringify(result)).not.toContain("raw-secret");
  });

  it("rejects an invitation link that does not belong to the configured dashboard origin", async () => {
    const { provider, sent } = harness();

    await expect(provider.send({ ...input, invitationUrl: "https://attacker.example/invite#token=invite-1.raw-secret" }, "attempt-1")).rejects.toThrow(/invitation.*url/i);
    expect(sent).toHaveLength(0);
  });
});

describe("SMTP transport policy", () => {
  it("configures authenticated required STARTTLS", () => {
    const { options } = harness();

    expect(options).toEqual([{
      host: "smtp.relay.example",
      port: 587,
      secure: false,
      requireTLS: true,
      tls: { rejectUnauthorized: true },
      auth: { user: "smtp-user", pass: "smtp-password" },
    }]);
  });

  it("configures authenticated implicit TLS", () => {
    const options: SmtpTransportOptions[] = [];

    createSmtpInvitationEmailProvider({ ...baseConfig, port: 465, tlsMode: "implicit_tls" }, (candidate) => {
      options.push(candidate);
      return { sendMail: async () => ({}) };
    }, { now });

    expect(options).toEqual([{
      host: "smtp.relay.example",
      port: 465,
      secure: true,
      requireTLS: true,
      tls: { rejectUnauthorized: true },
      auth: { user: "smtp-user", pass: "smtp-password" },
    }]);
  });

  it("rejects invalid TLS modes, hosts, ports, credentials, sender, and public URL before creating a transport", () => {
    const factory = vi.fn((): SmtpTransport => ({ sendMail: async () => ({}) }));
    const invalid = [
      { ...baseConfig, tlsMode: "opportunistic" },
      { ...baseConfig, host: "localhost" },
      { ...baseConfig, host: "https://smtp.relay.example" },
      { ...baseConfig, port: 0 },
      { ...baseConfig, port: 70_000 },
      { ...baseConfig, username: "" },
      { ...baseConfig, username: "   " },
      { ...baseConfig, password: "" },
      { ...baseConfig, password: "   " },
      { ...baseConfig, from: "Other <invites@vijeeta.com>" },
      { ...baseConfig, publicUrl: "http://dashboard.example" },
      { ...baseConfig, publicUrl: "https://localhost:3010" },
    ];

    for (const config of invalid) {
      expect(() => createSmtpInvitationEmailProvider(config as typeof baseConfig, factory)).toThrow();
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it("redacts a transport initialization failure before it can escape configuration", () => {
    const sensitive = `${baseConfig.username} ${baseConfig.password}`;

    expect(() => createSmtpInvitationEmailProvider(baseConfig, () => {
      throw new Error(sensitive);
    })).toThrow("SMTP transport initialization failed");
    try {
      createSmtpInvitationEmailProvider(baseConfig, () => { throw new Error(sensitive); });
    } catch (error) {
      expect(String(error)).not.toContain(baseConfig.username);
      expect(String(error)).not.toContain(baseConfig.password);
    }
  });
});

describe("SMTP relay acceptance validation", () => {
  it("accepts a case-varied affirmative list containing exactly the intended recipient", async () => {
    const { provider } = harness({ accepted: [" STUDENT@EXAMPLE.TEST "], rejected: [] });

    expect(await provider.send(input, "attempt-1")).toEqual({
      status: "sent",
      provider: "smtp",
      providerMessageId: "<attempt-1@vijeeta.com>",
    });
  });

  it.each([
    ["missing acceptance", {}],
    ["empty acceptance", { accepted: [], rejected: [] }],
    ["mismatched acceptance", { accepted: ["other@example.test"], rejected: [] }],
    ["boolean acceptance", { accepted: true, rejected: [] }],
    ["malformed acceptance", { accepted: ["student@example.test", 42], rejected: [] }],
    ["conflicting acceptance", { accepted: ["student@example.test"], rejected: ["student@example.test"] }],
  ])("returns unknown for %s", async (_label, response) => {
    const { provider } = harness(response);

    expect(await provider.send(input, "attempt-1")).toEqual({
      status: "unknown",
      provider: "smtp",
      category: "delivery_ambiguous",
      retryable: false,
    });
  });
});

describe("SMTP outcome classification", () => {
  it("returns a definite failed result for authentication rejection", async () => {
    const transport = { sendMail: vi.fn(async () => Promise.reject(Object.assign(new Error("535 smtp-user smtp-password"), { code: "EAUTH", deliveryPhase: "auth" }))) };
    const provider = createSmtpInvitationEmailProvider(baseConfig, () => transport, { now });

    const result = await provider.send(input, "attempt-1");

    expect(result).toEqual({ status: "failed", provider: "smtp", category: "authentication_rejected", retryable: false });
    expect(JSON.stringify(result)).not.toContain("smtp-user");
    expect(JSON.stringify(result)).not.toContain("smtp-password");
    expect(JSON.stringify(result)).not.toContain("raw-secret");
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
  });

  it("returns a definite retryable failure before DATA without exposing the provider response", async () => {
    const transport = { sendMail: vi.fn(async () => Promise.reject(Object.assign(new Error("student@example.test full SMTP response"), { code: "ECONNREFUSED", deliveryPhase: "before_data" }))) };
    const provider = createSmtpInvitationEmailProvider(baseConfig, () => transport, { now });

    expect(await provider.send(input, "attempt-1")).toEqual({ status: "failed", provider: "smtp", category: "transport_pre_data", retryable: true });
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
  });

  it("returns unknown for an ambiguous timeout after DATA may have begun and never retries internally", async () => {
    const transport = { sendMail: vi.fn(async () => Promise.reject(Object.assign(new Error("timeout after DATA raw-secret"), { code: "ETIMEDOUT", deliveryPhase: "after_data_started" }))) };
    const provider = createSmtpInvitationEmailProvider(baseConfig, () => transport, { now });

    const result = await provider.send(input, "attempt-1");

    expect(result).toEqual({ status: "unknown", provider: "smtp", category: "delivery_ambiguous", retryable: false });
    expect(JSON.stringify(result)).not.toContain("raw-secret");
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
  });

  it("returns unknown for any confirmed post-DATA error regardless of transport code", async () => {
    const transport = { sendMail: vi.fn(async () => Promise.reject(Object.assign(new Error("relay rejected after DATA"), { code: "EOTHER", deliveryPhase: "after_data_started" }))) };
    const provider = createSmtpInvitationEmailProvider(baseConfig, () => transport, { now });

    expect(await provider.send(input, "attempt-1")).toEqual({ status: "unknown", provider: "smtp", category: "delivery_ambiguous", retryable: false });
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
  });

  it.each(["ETIMEDOUT", "ECONNRESET", "EPIPE"])("returns unknown for uncertain-phase %s without retry", async (code) => {
    const transport = { sendMail: vi.fn(async () => Promise.reject(Object.assign(new Error("uncertain disconnect"), { code }))) };
    const provider = createSmtpInvitationEmailProvider(baseConfig, () => transport, { now });

    expect(await provider.send(input, "attempt-1")).toEqual({ status: "unknown", provider: "smtp", category: "delivery_ambiguous", retryable: false });
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
  });
});
