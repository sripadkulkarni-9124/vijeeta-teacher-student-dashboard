const EMAIL = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface InvitationEmailInput {
  recipientEmail: string;
  teacherEmail: string;
  teacherEmailVerified: boolean;
  teacherName: string;
  classroomName: string;
  expiresAt: string;
  invitationUrl: string;
}

export type DeliveryResult =
  | { status: "sent"; provider: "capture" | "smtp"; providerMessageId: string }
  | { status: "failed"; provider: "smtp"; category: "authentication_rejected" | "transport_pre_data" | "recipient_rejected"; retryable: boolean }
  | { status: "unknown"; provider: "smtp"; category: "delivery_ambiguous"; retryable: false };

export interface InvitationEmailProvider {
  send(input: InvitationEmailInput, attemptId: string): Promise<DeliveryResult>;
}

export interface CapturedInvitationEmail extends InvitationEmailInput {
  attemptId: string;
}

export interface InvitationEmailValidationOptions {
  now?: () => Date;
}

export class CaptureInvitationEmailProvider implements InvitationEmailProvider {
  private readonly captured: CapturedInvitationEmail[] = [];
  private readonly now: () => Date;

  constructor(options: { runtimeMode: "development" | "test" | "production"; now?: () => Date }) {
    if (options.runtimeMode === "production") throw new Error("Capture email provider is not allowed in production");
    this.now = options.now ?? (() => new Date());
  }

  get captures(): readonly CapturedInvitationEmail[] {
    return this.captured.map((capture) => ({ ...capture }));
  }

  async send(input: InvitationEmailInput, attemptId: string): Promise<DeliveryResult> {
    assertAttemptId(attemptId);
    const validated = validateInvitationEmailInput(input, { now: this.now });
    this.captured.push({ ...validated, attemptId });
    return { status: "sent", provider: "capture", providerMessageId: messageIdForAttempt(attemptId) };
  }
}

export function validateInvitationEmailInput(
  input: InvitationEmailInput,
  options: InvitationEmailValidationOptions = {},
): InvitationEmailInput {
  const recipientEmail = normalizeInvitationEmail(input.recipientEmail, "Recipient");
  const teacherEmail = normalizeInvitationEmail(input.teacherEmail, "Teacher");
  if (input.teacherEmailVerified !== true) throw new Error("Teacher Reply-To email must be server verified");
  const teacherName = validateText(input.teacherName, "Teacher name", 80, false);
  const classroomName = validateText(input.classroomName, "Classroom name", 120, true);
  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAtMs)) throw new Error("Invitation expiry is invalid");
  if (expiresAtMs <= (options.now ?? (() => new Date()))().getTime()) throw new Error("Invitation has expired");
  validateInvitationUrlShape(input.invitationUrl);
  return { ...input, recipientEmail, teacherEmail, teacherName, classroomName, expiresAt: new Date(expiresAtMs).toISOString() };
}

export function assertAttemptId(value: string): void {
  if (!SAFE_ID.test(value)) throw new Error("Delivery attempt ID is invalid");
}

export function messageIdForAttempt(attemptId: string): string {
  assertAttemptId(attemptId);
  return `<${attemptId}@vijeeta.com>`;
}

export function normalizeInvitationEmail(value: string, label = "Invitation"): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !EMAIL.test(normalized)) throw new Error(`${label} email is invalid`);
  return normalized;
}

function validateText(value: string, label: string, maximum: number, rejectMarkup: boolean): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || containsControl(normalized) || (rejectMarkup && /[<>]/.test(normalized))) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function containsControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

function validateInvitationUrlShape(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invitation URL is invalid");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/invite" || url.search || !/^#token=[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.[A-Za-z0-9_-]{6,128}$/.test(url.hash)) {
    throw new Error("Invitation URL is invalid");
  }
}
