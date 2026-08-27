import {
  assertAttemptId,
  messageIdForAttempt,
  validateInvitationEmailInput,
  type DeliveryResult,
  type InvitationEmailInput,
  type InvitationEmailProvider,
} from "./email-provider";
import { validateDashboardBaseUrl } from "./invite-token";

export const SMTP_INVITATION_FROM = "ViJEEta <invites@vijeeta.com>";

export interface SmtpInvitationConfig {
  runtimeMode: "production";
  publicUrl: string;
  host: string;
  port: number;
  tlsMode: "implicit_tls" | "starttls_required";
  username: string;
  password: string;
  from: string;
}

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: true;
  tls: { rejectUnauthorized: true };
  auth: { user: string; pass: string };
}

export interface SmtpMail {
  from: string;
  to: string;
  replyTo: { name: string; address: string };
  messageId: string;
  subject: string;
  text: string;
  html: string;
}

export interface SmtpTransportResponse {
  messageId?: string;
  accepted?: boolean | string[];
  rejected?: string[];
}

export interface SmtpTransport {
  sendMail(mail: SmtpMail): Promise<SmtpTransportResponse>;
}

export type SmtpTransportFactory = (options: SmtpTransportOptions) => SmtpTransport;

class SmtpInvitationEmailProvider implements InvitationEmailProvider {
  constructor(
    private readonly publicOrigin: string,
    private readonly transport: SmtpTransport,
  ) {}

  async send(candidate: InvitationEmailInput, attemptId: string): Promise<DeliveryResult> {
    assertAttemptId(attemptId);
    const input = validateInvitationEmailInput(candidate);
    assertMatchingInvitationUrl(input.invitationUrl, this.publicOrigin);
    const messageId = messageIdForAttempt(attemptId);
    const mail = composeMail(input, messageId);

    try {
      const response = await this.transport.sendMail(mail);
      if (response.accepted === false || (Array.isArray(response.rejected) && response.rejected.length > 0)) {
        return { status: "failed", provider: "smtp", category: "recipient_rejected", retryable: false };
      }
      return { status: "sent", provider: "smtp", providerMessageId: messageId };
    } catch (error) {
      return classifyTransportFailure(error);
    }
  }
}

export function createSmtpInvitationEmailProvider(
  config: SmtpInvitationConfig,
  createTransport: SmtpTransportFactory,
): InvitationEmailProvider {
  const validated = validateSmtpConfig(config);
  let transport: SmtpTransport;
  try {
    transport = createTransport({
      host: validated.host,
      port: validated.port,
      secure: validated.tlsMode === "implicit_tls",
      requireTLS: true,
      tls: { rejectUnauthorized: true },
      auth: { user: validated.username, pass: validated.password },
    });
  } catch {
    throw new Error("SMTP transport initialization failed");
  }
  return new SmtpInvitationEmailProvider(validated.publicOrigin, transport);
}

function validateSmtpConfig(config: SmtpInvitationConfig): SmtpInvitationConfig & { publicOrigin: string } {
  if (config.runtimeMode !== "production") throw new Error("SMTP invitation provider is production-only");
  const publicUrl = validateDashboardBaseUrl(config.publicUrl, "production");
  if (!isPublicRelayHost(config.host)) throw new Error("SMTP relay host is invalid");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) throw new Error("SMTP relay port is invalid");
  if (config.tlsMode !== "implicit_tls" && config.tlsMode !== "starttls_required") throw new Error("SMTP TLS mode is invalid");
  if (!isCredential(config.username) || !isCredential(config.password)) throw new Error("SMTP credentials are required");
  if (config.from !== SMTP_INVITATION_FROM) throw new Error("SMTP invitation sender is invalid");
  return { ...config, host: config.host.toLowerCase(), publicOrigin: publicUrl.origin };
}

function isPublicRelayHost(value: string): boolean {
  if (value.length < 4 || value.length > 253 || value !== value.trim() || value.includes("://")) return false;
  const hostname = value.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(hostname);
}

function isCredential(value: string): boolean {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 1_024
    && value.trim().length > 0
    && !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint === 0 || codePoint === 10 || codePoint === 13;
    });
}

function assertMatchingInvitationUrl(value: string, publicOrigin: string): void {
  const url = new URL(value);
  if (url.origin !== publicOrigin || url.protocol !== "https:" || url.pathname !== "/invite" || url.search || !url.hash.startsWith("#token=")) {
    throw new Error("Invitation URL does not match the configured dashboard origin");
  }
}

function composeMail(input: InvitationEmailInput, messageId: string): SmtpMail {
  const teacherIdentity = `${input.teacherName} (${input.teacherEmail})`;
  const text = [
    `${teacherIdentity} invited you to join ${input.classroomName} on ViJEEta.`,
    "",
    `Accept the invitation: ${input.invitationUrl}`,
    `This one-time invitation expires at ${input.expiresAt}.`,
  ].join("\n");
  const html = `<p>${escapeHtml(teacherIdentity)} invited you to join <strong>${escapeHtml(input.classroomName)}</strong> on ViJEEta.</p>`
    + `<p><a href="${escapeHtml(input.invitationUrl)}">Accept the invitation</a></p>`
    + `<p>This one-time invitation expires at ${escapeHtml(input.expiresAt)}.</p>`;
  return {
    from: SMTP_INVITATION_FROM,
    to: input.recipientEmail,
    replyTo: { name: input.teacherName, address: input.teacherEmail },
    messageId,
    subject: `Invitation to join ${input.classroomName} on ViJEEta`,
    text,
    html,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

function classifyTransportFailure(error: unknown): DeliveryResult {
  const candidate = typeof error === "object" && error !== null
    ? error as { code?: unknown; deliveryPhase?: unknown }
    : {};
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  if (candidate.deliveryPhase === "auth" || code === "EAUTH") {
    return { status: "failed", provider: "smtp", category: "authentication_rejected", retryable: false };
  }
  const ambiguousDisconnect = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "EPIPE"]);
  if (candidate.deliveryPhase === "after_data_started" && ambiguousDisconnect.has(code)) {
    return { status: "unknown", provider: "smtp", category: "delivery_ambiguous", retryable: false };
  }
  return { status: "failed", provider: "smtp", category: "transport_pre_data", retryable: true };
}
