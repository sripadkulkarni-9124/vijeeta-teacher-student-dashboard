import { describe, expect, it } from "vitest";

import type { ClassroomInvite, ClassroomMembership, VerifiedPrincipal } from "@vijeeta/api-contracts";
import type { InvitationDeliveryOutcome, InvitationRepository, MutationContext } from "../../../server/dashboard-store";
import type { InvitationEmailInput, InvitationEmailProvider } from "../../../server/email-provider";
import { InviteTokenService } from "../../../server/invite-token";
import { ClassroomInvitationCoordinator } from "./route-support";

const NOW = "2026-08-28T08:00:00.000Z";
const principal: VerifiedPrincipal = { uid: "teacher-uid", email: "teacher@example.test", emailVerified: true, displayName: "Teacher", authTime: NOW };
const context: MutationContext = { now: NOW, correlationId: "123e4567-e89b-12d3-a456-426614174000" };

class MemoryInvitations implements InvitationRepository {
  invite: ClassroomInvite | null = null;
  readonly operations: string[] = [];
  lastOutcome: InvitationDeliveryOutcome | null = null;

  async getInvitation(): Promise<ClassroomInvite | null> { return this.invite; }
  async inspectInvitation() {
    if (this.invite === null) throw new Error("missing");
    return { invite: this.invite, classroomName: "Physics A", teacherName: "Teacher", teacherEmail: "teacher@example.test", studentOnboardingRequired: true };
  }
  async resolveInvitationForAcceptance() { return this.inspectInvitation(); }
  async listRoster() { return { members: [], invitations: [], nextMemberCursor: null, nextInvitationCursor: null }; }
  async createInvitation(actor: VerifiedPrincipal, input: Parameters<InvitationRepository["createInvitation"]>[1], mutation: MutationContext) {
    if (this.invite !== null) {
      this.operations.push("replayed");
      return { disposition: "idempotent_replay" as const, invite: this.invite };
    }
    this.operations.push("persisted");
    this.invite = { ...input, ownerUid: actor.uid, status: "pending", delivery: "pending", acceptedUid: null, acceptedAt: null, createdAt: mutation.now, updatedAt: mutation.now };
    return { disposition: "created" as const, invite: this.invite };
  }
  async beginInvitationDelivery(actor: VerifiedPrincipal, classroomId: string, invitationId: string, provider: "capture" | "smtp", expected: { tokenDigest: string; tokenVersion: number }) {
    void actor;
    void classroomId;
    void invitationId;
    void provider;
    if (this.invite === null) throw new Error("not persisted");
    if (this.invite.tokenDigest !== expected.tokenDigest || this.invite.tokenVersion !== expected.tokenVersion) throw new Error("token mismatch");
    this.operations.push("attempt");
    return { attemptId: "attempt-1", dispatch: { invite: this.invite, classroomName: "Physics A", teacherName: "Teacher", teacherEmail: "teacher@example.test" } };
  }
  async completeInvitationDelivery(actor: VerifiedPrincipal, classId: string, inviteId: string, attemptId: string, outcome: InvitationDeliveryOutcome, mutation: MutationContext) {
    void actor;
    void classId;
    void inviteId;
    void attemptId;
    if (this.invite === null) throw new Error("missing");
    this.operations.push(`completed:${outcome.status}`);
    this.lastOutcome = outcome;
    this.invite = { ...this.invite, delivery: outcome.status, ...(outcome.status === "unknown" ? { deliveryErrorCategory: "ambiguous" as const } : {}), updatedAt: mutation.now };
    return this.invite;
  }
  async rotateInvitation(actor: VerifiedPrincipal, input: Parameters<InvitationRepository["rotateInvitation"]>[1], mutation: MutationContext) {
    void actor;
    if (this.invite === null) throw new Error("transition unavailable");
    this.operations.push("rotated");
    this.invite = { ...this.invite, tokenDigest: input.tokenDigest, tokenVersion: input.tokenVersion, expiresAt: input.expiresAt, delivery: "pending", updatedAt: mutation.now };
    return { disposition: "rotated" as const, invite: this.invite };
  }
  async revokeInvitation(): Promise<ClassroomInvite> { throw new Error("unused"); }
  async acceptInvitation(): Promise<ClassroomMembership> { throw new Error("unused"); }
}

class RecordingEmail implements InvitationEmailProvider {
  readonly deliveries: InvitationEmailInput[] = [];
  constructor(private readonly fail = false) {}
  async send(input: InvitationEmailInput) {
    this.deliveries.push(input);
    if (this.fail) throw new Error("secret transport detail");
    return { status: "sent" as const, provider: "capture" as const, providerMessageId: "<attempt-1@vijeeta.com>" };
  }
}

function coordinator(store: MemoryInvitations, email: RecordingEmail) {
  let randomSeed = 0;
  return new ClassroomInvitationCoordinator({
    invitations: store,
    tokens: new InviteTokenService({ pepper: "p".repeat(32), now: () => new Date(NOW), random: (size) => Uint8Array.from({ length: size }, () => ++randomSeed % 255) }),
    email,
    providerKind: "capture",
    dashboardUrl: "http://127.0.0.1:3010",
    runtimeMode: "test",
    createInvitationId: () => "invite-1",
  });
}

describe("ClassroomInvitationCoordinator", () => {
  it("persists invite and delivery intent before exactly one transport call", async () => {
    const store = new MemoryInvitations();
    const email = new RecordingEmail();
    const result = await coordinator(store, email).invite(principal, "class-1", "student@example.test", context);

    expect(store.operations).toEqual(["persisted", "attempt", "completed:sent"]);
    expect(email.deliveries).toHaveLength(1);
    expect(result.delivery).toBe("sent");
    expect(JSON.stringify(result)).not.toContain("#token=");
  });

  it("records an unexpected provider throw as unknown and never retries it", async () => {
    const store = new MemoryInvitations();
    const email = new RecordingEmail(true);
    const flow = coordinator(store, email);
    const result = await flow.invite(principal, "class-1", "student@example.test", context);

    expect(result).toMatchObject({ delivery: "unknown", deliveryErrorCategory: "ambiguous" });
    expect(email.deliveries).toHaveLength(1);
    expect(store.operations).toEqual(["persisted", "attempt", "completed:unknown"]);
  });

  it("rotates a sent invitation so its old one-time token no longer inspects", async () => {
    const store = new MemoryInvitations();
    const email = new RecordingEmail();
    const flow = coordinator(store, email);
    await flow.invite(principal, "class-1", "student@example.test", context);
    const oldToken = new URL(email.deliveries[0]!.invitationUrl).hash.slice("#token=".length);
    await flow.redeliver(principal, "class-1", "invite-1", context);
    const newToken = new URL(email.deliveries[1]!.invitationUrl).hash.slice("#token=".length);

    expect(newToken).not.toBe(oldToken);
    await expect(flow.inspect({ ...principal, uid: "student-uid", email: "student@example.test" }, oldToken)).rejects.toMatchObject({ code: "invitation_unavailable" });
    await expect(flow.inspect({ ...principal, uid: "student-uid", email: "student@example.test" }, newToken)).resolves.toMatchObject({ targetEmailMatches: true });
  });

  it("sends only for the caller whose token digest was newly persisted on a same-key replay", async () => {
    const store = new MemoryInvitations();
    const email = new RecordingEmail();
    const flow = coordinator(store, email);

    const [first, replay] = await Promise.all([
      flow.invite(principal, "class-1", "student@example.test", context),
      flow.invite(principal, "class-1", "student@example.test", context),
    ]);

    expect(replay).toMatchObject({ id: first.id, tokenDigest: first.tokenDigest, tokenVersion: first.tokenVersion, delivery: "pending" });
    expect(email.deliveries).toHaveLength(1);
    expect(store.operations).toEqual(["persisted", "replayed", "attempt", "completed:sent"]);
    const usableToken = new URL(email.deliveries[0]!.invitationUrl).hash.slice("#token=".length);
    await expect(flow.inspect({ ...principal, uid: "student-uid", email: "student@example.test" }, usableToken)).resolves.toMatchObject({ inviteId: "invite-1" });
  });
});
