import { DashboardRoleSchema, ProfileOnboardRequestSchema, type V3Problem } from "@vijeeta/api-contracts";
import { bearerToken, ProfileStoreError, TokenVerificationError, type ProfileStore, type TokenVerifier } from "../../../server/profile-store";
import { getProductionFirebaseRuntime } from "../../../server/firebase-runtime";

let configured: { profiles: ProfileStore; verifier: TokenVerifier } | undefined;

async function dependencies() {
  if (configured) return configured;
  try { return await getProductionFirebaseRuntime(); } catch { return undefined; }
}
function response(problem: V3Problem, status: number) { return Response.json({ problem }, { status, headers: { "cache-control": "no-store" } }); }
function unauthorized() { return response({ code: "unauthorized", message: "Firebase authentication required" }, 401); }
function validation(error: unknown) {
  const issues = typeof error === "object" && error !== null && Array.isArray((error as { issues?: unknown }).issues) ? (error as { issues: Array<{ path: Array<string | number>; message: string }> }).issues.map((issue) => ({ path: issue.path, message: issue.message })) : undefined;
  return response({ code: "invalid_request", message: "Request validation failed", ...(issues ? { issues } : {}) }, 400);
}

async function verifiedUid(request: Request, verifier: TokenVerifier): Promise<string> {
  const header = bearerToken(request.headers.get("authorization"));
  const verified = await verifier.verify(header);
  if (!verified.uid) throw new Error("Verifier returned no UID");
  return verified.uid;
}

export async function GET(request: Request): Promise<Response> {
  try { bearerToken(request.headers.get("authorization")); } catch { return unauthorized(); }
  const deps = await dependencies();
  if (!deps) return response({ code: "upstream_unavailable", message: "Profile service unavailable" }, 503);
  let uid: string;
  try { uid = await verifiedUid(request, deps.verifier); } catch (error) {
    if (error instanceof TokenVerificationError && error.status === 503) return response({ code: "upstream_unavailable", message: "Profile service unavailable" }, 503);
    return unauthorized();
  }
  try {
    const profile = await deps.profiles.getByFirebaseUid(uid);
    return profile ? Response.json(profile, { headers: { "cache-control": "no-store" } }) : response({ code: "not_found", message: "Profile onboarding required" }, 404);
  } catch { return response({ code: "upstream_unavailable", message: "Profile service unavailable" }, 503); }
}

export async function POST(request: Request): Promise<Response> {
  try { bearerToken(request.headers.get("authorization")); } catch { return unauthorized(); }
  const deps = await dependencies();
  if (!deps) return response({ code: "upstream_unavailable", message: "Profile service unavailable" }, 503);
  let uid: string;
  try { uid = await verifiedUid(request, deps.verifier); } catch (error) {
    if (error instanceof TokenVerificationError && error.status === 503) return response({ code: "upstream_unavailable", message: "Profile service unavailable" }, 503);
    return unauthorized();
  }
  let body: { role: "teacher" | "student" };
  try { body = ProfileOnboardRequestSchema.parse(await request.json()); } catch (error) { return validation(error); }
  try {
    const profile = await deps.profiles.onboard(uid, DashboardRoleSchema.parse(body.role));
    return Response.json(profile, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ProfileStoreError) return response({ code: "forbidden", message: error.message }, 409);
    return response({ code: "upstream_unavailable", message: "Profile service unavailable" }, 503);
  }
}

export function configureProfileForTests(deps: { profiles: ProfileStore; verifier: TokenVerifier }): void { configured = deps; }
export function resetProfileForTests(): void { configured = undefined; }
