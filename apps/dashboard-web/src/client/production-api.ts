import { DashboardProfileResponseSchema } from "@vijeeta/api-contracts";

export type ProductionRole = "student" | "teacher";

export interface ProductionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface ProductionAuthSession {
  currentUser: ProductionUser | null;
  getIdToken(forceRefresh?: boolean): Promise<string>;
  signInWithEmailPassword(email: string, password: string): Promise<ProductionUser>;
  createAccountWithEmailPassword?(email: string, password: string): Promise<ProductionUser>;
  isEmailVerified?(): Promise<boolean>;
  resendEmailVerification?(): Promise<void>;
  prepare?(): Promise<void>;
  completeRedirectSignIn?(): Promise<ProductionUser | null>;
  signInWithGoogle(): Promise<ProductionUser>;
  signOut(): Promise<void>;
  subscribe(listener: (user: ProductionUser | null) => void): () => void;
}

export interface ProductionProfile {
  user: ProductionUser;
  activeRole: ProductionRole | null;
  allowedRoles: ProductionRole[];
  onboardingComplete: boolean;
}

export class ProductionApiError extends Error {
  constructor(
    message: string,
    readonly kind: "unauthorized" | "invalid-response" | "network" | "auth",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProductionApiError";
  }
}

type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ProductionApi {
  auth: ProductionAuthSession;
  getProfile(): Promise<ProductionProfile | null>;
  onboard(role: ProductionRole): Promise<ProductionProfile>;
  readStudent(): Promise<{ discovery: unknown; tests: unknown; analysis: unknown }>;
  readTeacher(): Promise<{ config: unknown; jobs: unknown }>;
}

function isRole(value: unknown): value is ProductionRole {
  return value === "student" || value === "teacher";
}

function asUser(value: unknown): ProductionUser | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.uid !== "string" || !candidate.uid) return null;
  return {
    uid: candidate.uid,
    email: typeof candidate.email === "string" ? candidate.email : null,
    displayName: typeof candidate.displayName === "string" ? candidate.displayName : null,
  };
}

function parseProfile(value: unknown, fallbackUser: ProductionUser | null = null): ProductionProfile | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new ProductionApiError("Invalid profile response", "invalid-response");
  const candidate = value as Record<string, unknown>;
  const canonical = DashboardProfileResponseSchema.safeParse(value);
  if (canonical.success) {
    const profile = canonical.data.profile;
    if (fallbackUser !== null && profile.firebaseUid !== fallbackUser.uid) {
      throw new ProductionApiError("Profile does not belong to the signed-in user", "invalid-response");
    }
    const allowedRoles: ProductionRole[] = [];
    if (profile.roles.student === "active") allowedRoles.push("student");
    if (profile.roles.teacher === "active") allowedRoles.push("teacher");
    const activeRole = isRole(profile.activeRole) && allowedRoles.includes(profile.activeRole)
      ? profile.activeRole
      : null;
    return {
      user: {
        uid: profile.firebaseUid,
        email: profile.verifiedEmail,
        displayName: profile.displayName,
      },
      activeRole,
      allowedRoles,
      onboardingComplete: profile.onboardingCompleted,
    };
  }
  if ("profile" in candidate) {
    throw new ProductionApiError("Invalid profile response", "invalid-response");
  }
  if (typeof candidate.firebaseUid === "string" && fallbackUser && candidate.firebaseUid !== fallbackUser.uid) {
    throw new ProductionApiError("Profile does not belong to the signed-in user", "invalid-response");
  }
  const user = asUser(candidate.user) ?? asUser(candidate) ?? (
    typeof candidate.firebaseUid === "string" ? { ...(fallbackUser ?? { email: null, displayName: null }), uid: candidate.firebaseUid } : null
  );
  const allowedRoles = Array.isArray(candidate.allowedRoles)
    ? candidate.allowedRoles.filter(isRole)
    : [];
  const activeRole = isRole(candidate.activeRole) ? candidate.activeRole : null;
  const onboardingComplete =
    typeof candidate.onboardingComplete === "boolean"
      ? candidate.onboardingComplete
      : typeof candidate.onboardingCompleted === "boolean"
        ? candidate.onboardingCompleted
        : false;
  if (!user || allowedRoles.length !== (Array.isArray(candidate.allowedRoles) ? candidate.allowedRoles.length : 0)) {
    throw new ProductionApiError("Invalid profile response", "invalid-response");
  }
  if (activeRole !== null && !allowedRoles.includes(activeRole)) {
    throw new ProductionApiError("Invalid profile role response", "invalid-response");
  }
  return { user, activeRole, allowedRoles, onboardingComplete };
}

export function createProductionApi(options: {
  auth: ProductionAuthSession;
  transport?: Transport;
}): ProductionApi {
  const transport = options.transport ?? fetch;

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let token: string;
    try {
      token = await options.auth.getIdToken();
    } catch (error) {
      throw new ProductionApiError(error instanceof Error ? error.message : "Unable to refresh sign-in", "auth");
    }
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    try {
      const response = await transport(path, { ...init, headers: Object.fromEntries(headers.entries()) });
      if (response.status === 401 || response.status === 403) {
        throw new ProductionApiError("You are not authorized for this view", "unauthorized", response.status);
      }
      const text = await response.text();
      if (!response.ok) throw new ProductionApiError(`Production request failed (${response.status})`, "network", response.status);
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ProductionApiError("Production response was not JSON", "invalid-response", response.status);
      }
    } catch (error) {
      if (error instanceof ProductionApiError) throw error;
      throw new ProductionApiError(error instanceof Error ? error.message : "Production request failed", "network");
    }
  }

  return {
    auth: options.auth,
    async getProfile() {
      try {
        return parseProfile(await request("/api/profile"), options.auth.currentUser);
      } catch (error) {
        if (error instanceof ProductionApiError && error.status === 404) return null;
        throw error;
      }
    },
    async onboard(role) {
      const profile = parseProfile(
        await request("/api/profile", {
          method: "POST",
          body: JSON.stringify({ role }),
          headers: { "content-type": "application/json" },
        }), options.auth.currentUser,
      );
      if (!profile) throw new ProductionApiError("Onboarding returned no profile", "invalid-response");
      return profile;
    },
    async readStudent() {
      return {
        discovery: await request("/api/v3/shared/mode"),
        tests: await request("/api/v3/shared/tests"),
        analysis: {
          tests: await request(`/api/v3/analysis/tests?user_id=${encodeURIComponent(options.auth.currentUser?.uid ?? "")}`),
          overall: await request(`/api/v3/analysis/overall?user_id=${encodeURIComponent(options.auth.currentUser?.uid ?? "")}`),
          pyq: await request(`/api/v3/analysis/pyq?user_id=${encodeURIComponent(options.auth.currentUser?.uid ?? "")}`),
        },
      };
    },
    async readTeacher() {
      return {
        config: await request("/api/v3/paperdesk/config"),
        jobs: await request("/api/v3/paperdesk/jobs"),
      };
    },
  };
}
