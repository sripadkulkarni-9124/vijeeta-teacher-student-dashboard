import { AuditEventSchema, type AuditEvent, type RedactedAuditChangeSet } from "@vijeeta/api-contracts";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SENSITIVE_HEADER_LINE = /^([ \t]*)(authorization|proxy-authorization|cookie|set-cookie|api[-_ ]?key|x-api-key)[ \t]*[:=][^\r\n]*/gim;
const AUTH_CREDENTIAL = /\b(Bearer|Basic|Digest)\s+[^\s,;]+/gi;
const SENSITIVE_ASSIGNMENT = /\b(authorization|proxy-authorization|cookie|set-cookie|api[-_ ]?key|x-api-key|password|passwd|credential|secret|access[-_]?token|refresh[-_]?token|id[-_]?token|token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const COMMON_API_KEY = /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/g;
const SECRET_FIELD = /(answer|authorization|cookie|credential|digest|email|key|passw|secret|session|token)/i;

export interface AuditEmitter {
  emit(event: AuditEvent): Promise<void>;
}

export type AuditEmissionStatus =
  | { eventId: string; action: AuditEvent["action"]; status: "emitted" }
  | { eventId: string; action: AuditEvent["action"]; status: "deferred"; category: "canonical_emit_failed" };

export interface AuditEmissionStatusReporter {
  report(status: AuditEmissionStatus): Promise<void>;
}

export interface SafeAuditChange {
  field: string;
  value: string | null;
}

export interface SafeStructuredAuditDto {
  eventId: string;
  actorUid: string;
  actorProfileId: string;
  action: AuditEvent["action"];
  targetType: AuditEvent["targetType"];
  targetId: string;
  correlationId: string;
  reason: string | null;
  before?: SafeAuditChange[];
  after?: SafeAuditChange[];
  createdAt: string;
}

export interface StructuredAuditRecord {
  severity: "NOTICE";
  message: "vijeeta_dashboard_audit";
  insertId: string;
  audit: SafeStructuredAuditDto;
}

export interface StructuredAuditWriter {
  write(record: StructuredAuditRecord): Promise<void>;
}

export class JsonLineAuditWriter implements StructuredAuditWriter {
  constructor(
    private readonly appendLine: (line: string) => void = (line) => { process.stdout.write(`${line}\n`); },
  ) {}

  async write(record: StructuredAuditRecord): Promise<void> {
    this.appendLine(JSON.stringify(record));
  }
}

export class StructuredAuditEmitter implements AuditEmitter {
  constructor(private readonly writer: StructuredAuditWriter) {}

  async emit(candidate: AuditEvent): Promise<void> {
    const event = AuditEventSchema.parse(candidate);
    await this.writer.write({
      severity: "NOTICE",
      message: "vijeeta_dashboard_audit",
      insertId: event.canonicalLogInsertId,
      audit: {
        eventId: event.id,
        actorUid: event.actorUid,
        actorProfileId: event.actorProfileId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        correlationId: event.correlationId,
        reason: sanitizeText(event.reason),
        ...(event.before === undefined ? {} : { before: safeChanges(event.before) }),
        ...(event.after === undefined ? {} : { after: safeChanges(event.after) }),
        createdAt: event.createdAt,
      },
    });
  }
}

function safeChanges(changeSet: RedactedAuditChangeSet): SafeAuditChange[] {
  return changeSet.entries.map(({ field, value }) => ({
    field,
    value: value === null ? null : SECRET_FIELD.test(field) ? "[REDACTED]" : sanitizeText(value, 240),
  }));
}

function sanitizeText(value: string | null, maximum = 500): string | null {
  return value
    ?.replace(SENSITIVE_HEADER_LINE, "$1$2=[REDACTED]")
    .replace(AUTH_CREDENTIAL, "$1 [REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT, "$1=[REDACTED]")
    .replace(JWT, "[REDACTED_JWT]")
    .replace(COMMON_API_KEY, "[REDACTED_API_KEY]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .slice(0, maximum) ?? null;
}
