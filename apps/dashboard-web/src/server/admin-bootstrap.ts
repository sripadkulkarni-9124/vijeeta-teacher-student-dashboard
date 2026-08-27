import { AdminBootstrapConfigSchema, type AdminBootstrapConfig } from "@vijeeta/api-contracts";

import type { VerifiedPrincipal } from "./principal";

export function parseAdminBootstrap(secretJson: string): AdminBootstrapConfig {
  try {
    const parsed: unknown = JSON.parse(secretJson);
    const config = AdminBootstrapConfigSchema.parse(parsed);
    if (config.firebaseUids.some((uid) => uid !== uid.trim())) {
      throw new Error("Invalid Firebase UID");
    }
    return config;
  } catch {
    throw new Error("Admin bootstrap configuration is invalid");
  }
}

export function matchesAdminBootstrap(
  principal: VerifiedPrincipal,
  config: AdminBootstrapConfig,
): boolean {
  if (config.firebaseUids.includes(principal.uid)) return true;
  if (!principal.emailVerified || principal.email === null) return false;
  return config.verifiedEmails.includes(principal.email.trim().toLowerCase());
}
