import type { VerifiedToken } from "./profile-store";

export const PDF_DOWNLOAD_EMAIL_DOMAIN = "@vedantu.com";

/**
 * Server-only PDF download policy. Derived from the verified Firebase token and
 * never from anything the client sends. Fails closed on missing or unverified
 * claims.
 */
export function canDownloadPdf(verified: VerifiedToken): boolean {
  if (verified.admin === true) return true;
  if (verified.emailVerified !== true) return false;
  const email = typeof verified.email === "string" ? verified.email.trim().toLowerCase() : "";
  if (email.split("@").length !== 2 || /\s/.test(email)) return false;
  return email.endsWith(PDF_DOWNLOAD_EMAIL_DOMAIN) && email.length > PDF_DOWNLOAD_EMAIL_DOMAIN.length;
}
