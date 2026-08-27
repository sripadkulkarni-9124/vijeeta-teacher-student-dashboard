import {
  ClassroomInviteProjectionSchema,
  DashboardProfileV2Schema,
  InspectInvitationResponseSchema,
  type ClassroomInvite,
  type ClassroomInviteProjection,
  type ClassroomMembership,
  type InspectInvitationResponse,
  type VerifiedPrincipal,
} from "@vijeeta/api-contracts";

import type { InvitationEmailProvider } from "../../../server/email-provider";
import { buildInvitationAcceptanceUrl, type InvitationRuntimeMode, type InviteTokenService } from "../../../server/invite-token";
import type {
  InvitationRepository,
  MutationContext,
  ProfileRepository,
  RosterPagination,
} from "../../../server/dashboard-store";
import { getProductionDashboardRouteDependencies } from "../../../server/dashboard-runtime";
import {
  HttpError,
  authenticateRequest,
  type PrincipalVerifier,
} from "../../../server/http";
import { randomUUID } from "node:crypto";

const TOKEN_SHAPE = /^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.([A-Za-z0-9_-]{43})$/;

export interface ClassroomRouteDependencies {
  verifier: PrincipalVerifier;
  profiles: Pick<ProfileRepository, "getProfile">;
  createCorrelationId?: () => string;
}

export async function authorizeClassWorkspace(request: Request, dependencies: ClassroomRouteDependencies): Promise<VerifiedPrincipal> {
  const principal = await authenticateRequest(request, dependencies.verifier);
  const candidate = await dependencies.profiles.getProfile(principal.uid);
  if (candidate === null) throw new HttpError(403, "forbidden", "This action is not permitted");
  const profile = DashboardProfileV2Schema.parse(candidate);
  if (profile.firebaseUid !== principal.uid) throw new Error("Persisted profile identity mismatch");
  const active = profile.activeRole;
  if ((active !== "teacher" && active !== "student") || profile.roles[active] !== "active") {
    throw new HttpError(403, "forbidden", "This action is not permitted");
  }
  return principal;
}

export function projectInvitation(invite: ClassroomInvite): ClassroomInviteProjection {
  return ClassroomInviteProjectionSchema.parse({
    id: invite.id,
    classroomId: invite.classroomId,
    ownerUid: invite.ownerUid,
    tokenVersion: invite.tokenVersion,
    expiresAt: invite.expiresAt,
    status: invite.status,
    delivery: invite.delivery,
    ...(invite.deliveryErrorCategory === undefined ? {} : { deliveryErrorCategory: invite.deliveryErrorCategory }),
    acceptedUid: invite.acceptedUid,
    acceptedAt: invite.acceptedAt,
    createdAt: invite.createdAt,
    updatedAt: invite.updatedAt,
  });
}

export class ClassroomInvitationCoordinator {
  constructor(private readonly dependencies: {
    invitations: InvitationRepository;
    tokens: InviteTokenService;
    email: InvitationEmailProvider;
    providerKind: "capture" | "smtp";
    dashboardUrl: string;
    runtimeMode: InvitationRuntimeMode;
    createInvitationId: () => string;
  }) {}

  async invite(principal: VerifiedPrincipal, classroomId: string, email: string, context: MutationContext): Promise<ClassroomInvite> {
    const invitationId = this.dependencies.createInvitationId();
    const issued = this.dependencies.tokens.issue(invitationId);
    const invite = await this.dependencies.invitations.createInvitation(principal, {
      id: invitationId, classroomId, normalizedEmail: email, tokenDigest: issued.digest, tokenVersion: issued.version, expiresAt: issued.expiresAt,
    }, context);
    if (invite.id !== invitationId) {
      if (invite.delivery !== "pending") return invite;
      const replayIssued = this.dependencies.tokens.issue(invite.id, {
        version: invite.tokenVersion + 1,
        expiresAt: new Date(Date.parse(context.now) + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      });
      const rotated = await this.dependencies.invitations.rotateInvitation(principal, {
        id: invite.id,
        classroomId: invite.classroomId,
        normalizedEmail: invite.normalizedEmail,
        tokenDigest: replayIssued.digest,
        tokenVersion: replayIssued.version,
        expiresAt: replayIssued.expiresAt,
      }, context);
      return this.deliver(principal, rotated, replayIssued.urlFragment, context);
    }
    return this.deliver(principal, invite, issued.urlFragment, context);
  }

  async redeliver(principal: VerifiedPrincipal, classroomId: string, invitationId: string, context: MutationContext): Promise<ClassroomInvite> {
    const existing = await this.dependencies.invitations.getInvitation(classroomId, invitationId);
    if (existing === null) throw invitationUnavailable();
    const issued = this.dependencies.tokens.issue(invitationId, { version: existing.tokenVersion + 1, expiresAt: new Date(Date.parse(context.now) + 7 * 24 * 60 * 60 * 1_000).toISOString() });
    const rotated = await this.dependencies.invitations.rotateInvitation(principal, {
      id: invitationId, classroomId, normalizedEmail: existing.normalizedEmail, tokenDigest: issued.digest, tokenVersion: issued.version, expiresAt: issued.expiresAt,
    }, context);
    if (rotated.tokenVersion !== issued.version || rotated.delivery !== "pending") return rotated;
    return this.deliver(principal, rotated, issued.urlFragment, context);
  }

  async inspect(principal: VerifiedPrincipal, serialized: string): Promise<InspectInvitationResponse> {
    const invitationId = parseInvitationId(serialized);
    const inspection = await this.dependencies.invitations.inspectInvitation(principal, invitationId);
    if (!this.dependencies.tokens.verify(serialized, inspection.invite.tokenDigest)) throw invitationUnavailable();
    return InspectInvitationResponseSchema.parse({
      inviteId: inspection.invite.id,
      classroomId: inspection.invite.classroomId,
      classroomName: inspection.classroomName,
      teacherDisplayName: inspection.teacherName,
      targetEmailMatches: true,
      studentOnboardingRequired: inspection.studentOnboardingRequired,
      expiresAt: inspection.invite.expiresAt,
      status: inspection.invite.status,
    });
  }

  async accept(principal: VerifiedPrincipal, serialized: string, context: MutationContext): Promise<ClassroomMembership> {
    const invitationId = parseInvitationId(serialized);
    const inspection = await this.dependencies.invitations.resolveInvitationForAcceptance(principal, invitationId);
    if (!this.dependencies.tokens.verify(serialized, inspection.invite.tokenDigest)) throw invitationUnavailable();
    return this.dependencies.invitations.acceptInvitation(principal, {
      classroomId: inspection.invite.classroomId,
      invitationId,
      expectedTokenDigest: inspection.invite.tokenDigest,
      expectedTokenVersion: inspection.invite.tokenVersion,
    }, context);
  }

  private async deliver(principal: VerifiedPrincipal, invite: ClassroomInvite, tokenFragment: string, context: MutationContext): Promise<ClassroomInvite> {
    const { attemptId, dispatch } = await this.dependencies.invitations.beginInvitationDelivery(
      principal, invite.classroomId, invite.id, this.dependencies.providerKind, context,
    );
    const invitationUrl = buildInvitationAcceptanceUrl({ dashboardUrl: this.dependencies.dashboardUrl, tokenFragment, runtimeMode: this.dependencies.runtimeMode });
    let outcome;
    try {
      outcome = await this.dependencies.email.send({
        recipientEmail: dispatch.invite.normalizedEmail,
        teacherEmail: dispatch.teacherEmail,
        teacherEmailVerified: true,
        teacherName: dispatch.teacherName,
        classroomName: dispatch.classroomName,
        expiresAt: dispatch.invite.expiresAt,
        invitationUrl,
      }, attemptId);
    } catch {
      outcome = { status: "unknown" as const, provider: this.dependencies.providerKind, category: "delivery_ambiguous" as const, retryable: false as const };
    }
    return this.dependencies.invitations.completeInvitationDelivery(
      principal, invite.classroomId, invite.id, attemptId, outcome, context,
    );
  }
}

export function parseRosterPagination(request: Request): RosterPagination {
  const query = new URL(request.url).searchParams;
  for (const key of query.keys()) {
    if (!["limit", "memberCursor", "invitationCursor"].includes(key) || query.getAll(key).length !== 1) {
      throw new HttpError(400, "invalid_request", "Request validation failed");
    }
  }
  const rawLimit = query.get("limit");
  if (rawLimit !== null && !/^[1-9]\d*$/.test(rawLimit)) throw new HttpError(400, "invalid_request", "Request validation failed");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "invalid_request", "Request validation failed");
  const memberCursor = query.get("memberCursor") ?? undefined;
  const invitationCursor = query.get("invitationCursor") ?? undefined;
  if ((memberCursor?.length ?? 0) > 512 || (invitationCursor?.length ?? 0) > 512) throw new HttpError(400, "invalid_request", "Request validation failed");
  return { limit, ...(memberCursor === undefined ? {} : { memberCursor }), ...(invitationCursor === undefined ? {} : { invitationCursor }) };
}

export async function productionClassroomDependencies() {
  const dependencies = await getProductionDashboardRouteDependencies();
  return { verifier: dependencies.verifier, profiles: dependencies.store, classrooms: dependencies.store, invitations: dependencies.store };
}

export async function productionInvitationReadDependencies() {
  const dependencies = await getProductionDashboardRouteDependencies();
  const pepper = process.env.VIJEETA_INVITE_TOKEN_PEPPER;
  if (pepper === undefined || pepper.length < 32) throw new Error("Invitation token verification is not configured");
  const coordinator = new ClassroomInvitationCoordinator({
    invitations: dependencies.store,
    tokens: new (await import("../../../server/invite-token")).InviteTokenService({ pepper }),
    email: { send: async () => { throw new Error("Invitation email delivery is not configured"); } },
    providerKind: "smtp",
    dashboardUrl: "https://invalid.example",
    runtimeMode: "production",
    createInvitationId: randomUUID,
  });
  return { verifier: dependencies.verifier, profiles: dependencies.store, invitations: coordinator };
}

function parseInvitationId(serialized: string): string {
  const match = TOKEN_SHAPE.exec(serialized);
  if (!match) throw invitationUnavailable();
  return match[1]!;
}

function invitationUnavailable(): HttpError {
  return new HttpError(404, "invitation_unavailable", "Invitation is unavailable");
}
