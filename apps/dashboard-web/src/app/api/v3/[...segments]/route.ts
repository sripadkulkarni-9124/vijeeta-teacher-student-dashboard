import { parseV3ReadRoute, type DashboardProfile, type V3ReadRoute } from "@vijeeta/api-contracts";
import { loadRuntimeConfig } from "../../../../server/runtime-config";
import { bearerToken, TokenVerificationError, type ProfileStore, type TokenVerifier } from "../../../../server/profile-store";
import { V3ReadAdapter, type V3ReadInput } from "../../../../server/v3-read-adapter";
import { getProductionFirebaseRuntime } from "../../../../server/firebase-runtime";

interface ReadProxy { read(input: V3ReadInput): Promise<Response>; }
interface V3Dependencies { profiles: ProfileStore; verifier: TokenVerifier; adapter: ReadProxy; }
let configured: V3Dependencies | undefined;

function problem(code: string, message: string, status: number): Response { return Response.json({ problem: { code, message } }, { status, headers: { "cache-control": "no-store" } }); }
async function deps(): Promise<V3Dependencies | undefined> {
  if (configured) return configured;
  try {
    const config = loadRuntimeConfig();
    const firebase = await getProductionFirebaseRuntime(config);
    return { ...firebase, adapter: new V3ReadAdapter({ baseUrl: config.baseUrl, timeoutMs: config.timeoutMs }) };
  } catch { return undefined; }
}

function allowed(profile: DashboardProfile, route: V3ReadRoute, uid: string): boolean {
  if (profile.activeRole === "student") {
    if (route.path === "/v3/shared/mode" || route.path === "/v3/shared/tests" || route.path === "/v3/test/{id}") return true;
    if (route.path === "/v3/test/{id}/review" || route.path === "/v3/test/{id}/analysis") return route.query.get("user_id") === uid;
    return (route.path === "/v3/analysis/tests" || route.path === "/v3/analysis/overall" || route.path === "/v3/analysis/pyq") && route.query.get("user_id") === uid;
  }
  return route.path === "/v3/paperdesk/config" || route.path === "/v3/paperdesk/jobs" || route.path === "/v3/paperdesk/jobs/{id}";
}

async function paramsOf(context: { params: Promise<{ segments: string[] }> | { segments: string[] } }): Promise<string[]> {
  const params = await context.params;
  return params.segments;
}

export async function GET(request: Request, context: { params: Promise<{ segments: string[] }> | { segments: string[] } }): Promise<Response> {
  if (request.method !== "GET") return problem("invalid_request", "Only GET is supported", 405);
  let route: V3ReadRoute;
  try { route = parseV3ReadRoute(await paramsOf(context), new URL(request.url).searchParams); } catch (error) { return problem("invalid_request", error instanceof Error ? error.message : "Invalid V3 request", 400); }
  let authorization: string;
  try { authorization = bearerToken(request.headers.get("authorization")); } catch { return problem("unauthorized", "Firebase authentication required", 401); }
  const dependencies = await deps();
  if (!dependencies) return problem("upstream_unavailable", "V3 service unavailable", 503);
  let uid: string;
  try {
    uid = (await dependencies.verifier.verify(authorization)).uid;
    if (!uid) throw new TokenVerificationError("Firebase authentication failed", 401);
  } catch (error) { return problem(error instanceof TokenVerificationError && error.status === 503 ? "upstream_unavailable" : "unauthorized", error instanceof TokenVerificationError && error.status === 503 ? "V3 service unavailable" : "Firebase authentication failed", error instanceof TokenVerificationError && error.status === 503 ? 503 : 401); }
  let profile: DashboardProfile | null;
  try { profile = await dependencies.profiles.getByFirebaseUid(uid); } catch { return problem("upstream_unavailable", "V3 service unavailable", 503); }
  if (!profile) return problem("forbidden", "Profile onboarding required", 403);
  if (profile.firebaseUid !== uid) return problem("forbidden", "Profile identity mismatch", 403);
  if (!profile.allowedRoles.includes(profile.activeRole)) return problem("forbidden", "Profile role is not allowed", 403);
  if (!allowed(profile, route, uid)) return problem("forbidden", "Profile role cannot access this V3 read", 403);
  return dependencies.adapter.read({ path: route.path.replace("{id}", route.params.id ?? "").replace("{sid}", route.params.sid ?? "").replace("{uid}", route.params.uid ?? "").replace("{token}", route.params.token ?? ""), query: route.query, authorization });
}

export function configureV3ForTests(dependencies: V3Dependencies): void { configured = dependencies; }
export function resetV3ForTests(): void { configured = undefined; }
