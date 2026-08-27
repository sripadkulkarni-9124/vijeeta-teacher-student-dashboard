import { z } from "zod";

export const PLATFORM_META_CONTRACT_VERSION = "2026-08-26" as const;

export const PlatformMetaSchema = z
  .object({
    service: z.literal("vijeeta-platform"),
    api_version: z.literal("4.0.0"),
    contract_version: z.literal(PLATFORM_META_CONTRACT_VERSION),
    status: z.literal("ok"),
    legacy_reference: z.literal("v3"),
  })
  .strict();

export type PlatformMeta = z.infer<typeof PlatformMetaSchema>;

export function parsePlatformMeta(input: unknown): PlatformMeta {
  return PlatformMetaSchema.parse(input);
}
