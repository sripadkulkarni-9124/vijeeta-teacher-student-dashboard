import { randomUUID } from "node:crypto";
import { DashboardProfileSchema, type DashboardProfile, type DashboardRole } from "@vijeeta/api-contracts";

export class ProfileStoreError extends Error {
  constructor(message: string, readonly code: "profile_exists") { super(message); this.name = "ProfileStoreError"; }
}

export class TokenVerificationError extends Error {
  constructor(message: string, readonly status: 401 | 503) { super(message); this.name = "TokenVerificationError"; }
}

export interface ProfileStore {
  getByFirebaseUid(firebaseUid: string): Promise<DashboardProfile | null>;
  onboard(firebaseUid: string, role: DashboardRole): Promise<DashboardProfile>;
}

export class InMemoryProfileStore implements ProfileStore {
  private readonly profiles = new Map<string, DashboardProfile>();
  private readonly now: () => string;

  constructor(options: { now?: () => string; profiles?: DashboardProfile[] } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    for (const profile of options.profiles ?? []) this.profiles.set(profile.firebaseUid, DashboardProfileSchema.parse(profile));
  }

  async getByFirebaseUid(firebaseUid: string): Promise<DashboardProfile | null> { return this.profiles.get(firebaseUid) ?? null; }

  async onboard(firebaseUid: string, role: DashboardRole): Promise<DashboardProfile> {
    if (this.profiles.has(firebaseUid)) throw new ProfileStoreError("Profile is already onboarded", "profile_exists");
    const timestamp = this.now();
    const profile = DashboardProfileSchema.parse({ internalProfileId: randomUUID(), firebaseUid, allowedRoles: [role], activeRole: role, onboardingCompleted: true, createdAt: timestamp, updatedAt: timestamp });
    this.profiles.set(firebaseUid, profile);
    return profile;
  }
}

export interface TokenVerifier { verify(authorization: string): Promise<{ uid: string }>; }

export class UnavailableTokenVerifier implements TokenVerifier {
  async verify(): Promise<{ uid: string }> { throw new TokenVerificationError("Firebase token verifier is not configured", 503); }
}

export function bearerToken(authorization: string | null): string {
  if (!authorization || !/^Bearer\s+[^\s]+$/.test(authorization)) throw new Error("Bearer Firebase token required");
  return authorization;
}
