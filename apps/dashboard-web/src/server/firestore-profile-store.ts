import { randomUUID } from "node:crypto";

import {
  DashboardProfileV2Schema,
  DashboardProfileSchema,
  type DashboardProfile,
  type DashboardProfileV2,
  type DashboardRole,
} from "@vijeeta/api-contracts";

import { ProfileStoreError, type ProfileStore } from "./profile-store";

export interface FirestoreDocumentSnapshot {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface FirestoreDocumentReference {
  id: string;
  get(): Promise<FirestoreDocumentSnapshot>;
}

export interface FirestoreTransaction {
  get(reference: FirestoreDocumentReference): Promise<FirestoreDocumentSnapshot>;
  create(reference: FirestoreDocumentReference, data: Record<string, unknown>): void;
}

export interface FirestoreLike {
  collection(name: string): { doc(id: string): FirestoreDocumentReference };
  runTransaction<T>(work: (transaction: FirestoreTransaction) => Promise<T>): Promise<T>;
}

interface FirestoreProfileStoreOptions {
  firestore: FirestoreLike;
  serverTimestamp: () => unknown;
  randomUuid?: () => string;
}

export class FirestoreProfileStore implements ProfileStore {
  private readonly firestore: FirestoreLike;
  private readonly serverTimestamp: () => unknown;
  private readonly randomUuid: () => string;

  constructor(options: FirestoreProfileStoreOptions) {
    this.firestore = options.firestore;
    this.serverTimestamp = options.serverTimestamp;
    this.randomUuid = options.randomUuid ?? randomUUID;
  }

  async getByFirebaseUid(firebaseUid: string): Promise<DashboardProfile | null> {
    const snapshot = await this.profileReference(firebaseUid).get();
    if (!snapshot.exists) return null;
    return profileFromSnapshot(snapshot, firebaseUid);
  }

  async onboard(firebaseUid: string, role: DashboardRole): Promise<DashboardProfile> {
    const reference = this.profileReference(firebaseUid);
    try {
      await this.firestore.runTransaction(async (transaction) => {
        const existing = await transaction.get(reference);
        if (existing.exists) throw new ProfileStoreError("Profile is already onboarded", "profile_exists");
        const timestamp = this.serverTimestamp();
        transaction.create(reference, {
          internalProfileId: this.randomUuid(),
          firebaseUid,
          verifiedEmail: null,
          displayName: null,
          roles: role === "student" ? { student: "active" } : { teacher: "pending" },
          activeRole: role === "student" ? "student" : null,
          onboardingCompleted: true,
          schemaVersion: 2,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      });
    } catch (error) {
      if (error instanceof ProfileStoreError) throw error;
      if (isAlreadyExists(error)) throw new ProfileStoreError("Profile is already onboarded", "profile_exists");
      throw error;
    }

    const created = await reference.get();
    if (!created.exists) throw new Error("Profile transaction completed without a persisted profile");
    return profileFromSnapshot(created, firebaseUid);
  }

  private profileReference(firebaseUid: string): FirestoreDocumentReference {
    if (!isSafeFirebaseUid(firebaseUid)) throw new Error("Verified Firebase UID must be a safe Firestore document ID");
    return this.firestore.collection("profiles").doc(firebaseUid);
  }
}

function isSafeFirebaseUid(firebaseUid: string): boolean {
  return firebaseUid.trim().length > 0
    && firebaseUid.length <= 128
    && !firebaseUid.includes("/")
    && !Array.from(firebaseUid).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    });
}

function profileFromSnapshot(snapshot: FirestoreDocumentSnapshot, verifiedUid: string): DashboardProfile {
  const data = snapshot.data();
  if (!data) throw new Error("Persisted profile data is unavailable");
  if (data.firebaseUid !== verifiedUid) throw new Error("Persisted profile identity does not match verified Firebase UID");
  const normalized = {
    ...data,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
  const canonical = DashboardProfileV2Schema.safeParse(normalized);
  if (canonical.success) return projectCanonicalProfile(canonical.data);
  return DashboardProfileSchema.parse(normalized);
}

function projectCanonicalProfile(profile: DashboardProfileV2): DashboardProfile {
  const allowedRoles: DashboardRole[] = [];
  if (profile.roles.student === "active") allowedRoles.push("student");
  if (profile.roles.teacher === "active") allowedRoles.push("teacher");
  const activeRole = profile.activeRole !== null
    && (profile.activeRole === "student" || profile.activeRole === "teacher")
    && allowedRoles.includes(profile.activeRole)
    ? profile.activeRole
    : null;
  return DashboardProfileSchema.parse({
    internalProfileId: profile.internalProfileId,
    firebaseUid: profile.firebaseUid,
    allowedRoles,
    activeRole,
    onboardingCompleted: profile.onboardingCompleted,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  });
}

function timestampToIso(value: unknown): string {
  if (typeof value === "string") return new Date(value).toISOString();
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  throw new Error("Persisted profile timestamp is invalid");
}

function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 6 || code === "6" || code === "already-exists" || code === "ALREADY_EXISTS";
}
