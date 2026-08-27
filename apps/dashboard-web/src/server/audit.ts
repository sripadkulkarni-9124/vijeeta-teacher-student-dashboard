import { AuditEventSchema, type AuditEvent, type RedactedAuditChangeSet } from "@vijeeta/api-contracts";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /Bearer\s+[^\s]+/gi;
const SECRET_FIELD = /(answer|authorization|cookie|digest|email|key|secret|token)/i;

export interface AuditEmitter {
  emit(event: AuditEvent): Promise<void>;
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
    value: value === null ? null : SECRET_FIELD.test(field) ? "[REDACTED]" : sanitizeText(value),
  }));
}

function sanitizeText(value: string | null): string | null {
  return value?.replace(BEARER, "Bearer [REDACTED]").replace(EMAIL, "[REDACTED_EMAIL]").slice(0, 500) ?? null;
}
