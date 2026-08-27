import {
  VerifiedPrincipalSchema as ContractVerifiedPrincipalSchema,
  type VerifiedPrincipal as ContractVerifiedPrincipal,
} from "@vijeeta/api-contracts";

export type VerifiedPrincipal = ContractVerifiedPrincipal & { authTime: string };

const PRINCIPAL_KEYS = new Set(["uid", "email", "emailVerified", "displayName", "authTime"]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export const VerifiedPrincipalSchema = {
  parse(input: unknown): VerifiedPrincipal {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new Error("Verified principal must be an object");
    }

    const candidate = input as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => !PRINCIPAL_KEYS.has(key))) {
      throw new Error("Verified principal contains unknown fields");
    }

    const uid = candidate.uid;
    if (typeof uid !== "string" || uid !== uid.trim()) {
      throw new Error("Verified principal UID is invalid");
    }

    const email = typeof candidate.email === "string"
      ? candidate.email.trim().toLowerCase()
      : candidate.email;
    const principal = ContractVerifiedPrincipalSchema.parse({
      uid,
      email,
      emailVerified: candidate.emailVerified,
      displayName: candidate.displayName,
    });

    const authTime = candidate.authTime;
    if (typeof authTime !== "string" || authTime.length > 64 || !ISO_TIMESTAMP.test(authTime)) {
      throw new Error("Verified principal authentication time is invalid");
    }
    const parsedAuthTime = Date.parse(authTime);
    if (!Number.isFinite(parsedAuthTime)) {
      throw new Error("Verified principal authentication time is invalid");
    }

    return { ...principal, authTime: new Date(parsedAuthTime).toISOString() };
  },
};
