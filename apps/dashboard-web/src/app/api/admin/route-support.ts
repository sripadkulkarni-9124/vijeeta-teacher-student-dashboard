import {
  ClassroomInviteProjectionSchema,
  type ClassroomInvite,
  type ClassroomInviteProjection,
  type VerifiedPrincipal,
} from "@vijeeta/api-contracts";

import { getProductionDashboardRouteDependencies } from "../../../server/dashboard-runtime";
import {
  authenticateRequest,
  requireRole,
  serveHttp,
  type PrincipalVerifier,
  type ProfileReader,
} from "../../../server/http";

export interface AdminRouteDependencies {
  verifier: PrincipalVerifier;
  profiles: ProfileReader;
  createCorrelationId?: () => string;
}

export async function authorizeAdmin(
  request: Request,
  dependencies: AdminRouteDependencies,
): Promise<VerifiedPrincipal> {
  const principal = await authenticateRequest(request, dependencies.verifier);
  await requireRole(principal, "admin", dependencies.profiles);
  return principal;
}

export function projectInvitation(invitation: ClassroomInvite): ClassroomInviteProjection {
  return ClassroomInviteProjectionSchema.parse({
    id: invitation.id,
    classroomId: invitation.classroomId,
    ownerUid: invitation.ownerUid,
    tokenVersion: invitation.tokenVersion,
    expiresAt: invitation.expiresAt,
    status: invitation.status,
    delivery: invitation.delivery,
    ...(invitation.deliveryErrorCategory === undefined ? {} : { deliveryErrorCategory: invitation.deliveryErrorCategory }),
    acceptedUid: invitation.acceptedUid,
    acceptedAt: invitation.acceptedAt,
    createdAt: invitation.createdAt,
    updatedAt: invitation.updatedAt,
  });
}

export async function productionAdminDependencies() {
  const dependencies = await getProductionDashboardRouteDependencies();
  return {
    verifier: dependencies.verifier,
    profiles: dependencies.store,
    admin: dependencies.store,
    classrooms: dependencies.store,
    adminClassrooms: dependencies.store,
    invitations: dependencies.store,
    audit: dependencies.store,
  };
}

export function productionDependencyError(request: Request, error: unknown): Promise<Response> {
  return serveHttp(request, async () => { throw error; });
}
