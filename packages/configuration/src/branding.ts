export interface BrandingInput {
  organisationName: string;
  accent: string;
  logo?: { src: string; alt: string } | null;
  sharedApp?: boolean;
}

export interface ResolvedBranding {
  organisationName: string;
  logo: { src: string; alt: string } | null;
  sharedApp: boolean;
  poweredByVijeeta: boolean;
  colors: {
    accent: string;
    accentHover: string;
    accentContrast: "#FFFFFF" | "#172033";
    focus: string;
  };
}

const SURFACE_COLOR = "#FFFFFF";
const DARK_TEXT_COLOR = "#172033";
const MIN_ACTION_TO_SURFACE_CONTRAST = 3;
const MIN_TEXT_TO_ACTION_CONTRAST = 4.5;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const HTTPS_LOGO_SOURCE_PATTERN =
  /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^\s\\]*)?$/i;

export const DEFAULT_BRANDING: Readonly<ResolvedBranding> = freezeBranding({
  organisationName: "ViJEEta",
  logo: null,
  sharedApp: false,
  poweredByVijeeta: false,
  colors: {
    accent: "#3157C8",
    accentHover: "#2B4DB0",
    accentContrast: "#FFFFFF",
    focus: "#3157C8",
  },
});

export function resolveBranding(input: unknown): {
  branding: Readonly<ResolvedBranding>;
  usedFallbackAccent: boolean;
  issues: readonly string[];
} {
  const value = requireRecord(input, "Branding input");
  const organisationName = resolveOrganisationName(value.organisationName);
  const logo = resolveLogo(value.logo);
  const sharedApp = resolveSharedApp(value.sharedApp);
  const accent = resolveAccent(value.accent);

  return {
    branding: freezeBranding({
      organisationName,
      logo,
      sharedApp,
      poweredByVijeeta: sharedApp,
      colors: accent.colors,
    }),
    usedFallbackAccent: accent.usedFallback,
    issues: Object.freeze(accent.issue === undefined ? [] : [accent.issue]),
  };
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseHexColor(foreground));
  const backgroundLuminance = relativeLuminance(parseHexColor(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function resolveOrganisationName(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Organisation name must be a string.");
  }

  const organisationName = value.trim();
  if (organisationName.length < 1 || organisationName.length > 80) {
    throw new RangeError("Organisation name must contain 1 to 80 characters.");
  }

  return organisationName;
}

function resolveSharedApp(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new TypeError("sharedApp must be a boolean when provided.");
  }

  return value;
}

function resolveLogo(value: unknown): { src: string; alt: string } | null {
  if (value === undefined || value === null) {
    return null;
  }

  const logo = requireRecord(value, "Logo");
  if (typeof logo.src !== "string" || typeof logo.alt !== "string") {
    throw new TypeError("Logo src and alt must be strings.");
  }
  if (!isSafeLogoSource(logo.src)) {
    throw new TypeError("Logo src must be HTTPS or root-relative.");
  }

  return { src: logo.src, alt: logo.alt };
}

function isSafeLogoSource(source: string): boolean {
  if (source.startsWith("/") && !source.startsWith("//") && !source.includes("\\")) {
    return true;
  }

  return HTTPS_LOGO_SOURCE_PATTERN.test(source);
}

function resolveAccent(value: unknown): {
  colors: ResolvedBranding["colors"];
  usedFallback: boolean;
  issue?: string;
} {
  if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) {
    return fallbackAccent("Accent must be a #RRGGBB color.");
  }

  const accent = value.toUpperCase();
  if (contrastRatio(accent, SURFACE_COLOR) < MIN_ACTION_TO_SURFACE_CONTRAST) {
    return fallbackAccent("Accent does not meet the 3:1 action-to-surface contrast requirement.");
  }

  const accentContrast = selectAccentContrast(accent);
  if (accentContrast === undefined) {
    return fallbackAccent("Accent does not meet the 4.5:1 text-to-action contrast requirement.");
  }

  return {
    colors: {
      accent,
      accentHover: mixWithBlack(accent, 0.12),
      accentContrast,
      focus: accent,
    },
    usedFallback: false,
  };
}

function fallbackAccent(issue: string): {
  colors: ResolvedBranding["colors"];
  usedFallback: true;
  issue: string;
} {
  return { colors: DEFAULT_BRANDING.colors, usedFallback: true, issue };
}

function selectAccentContrast(accent: string): "#FFFFFF" | "#172033" | undefined {
  const whiteRatio = contrastRatio("#FFFFFF", accent);
  const darkRatio = contrastRatio(DARK_TEXT_COLOR, accent);

  if (whiteRatio >= MIN_TEXT_TO_ACTION_CONTRAST && whiteRatio >= darkRatio) {
    return "#FFFFFF";
  }
  if (darkRatio >= MIN_TEXT_TO_ACTION_CONTRAST) {
    return DARK_TEXT_COLOR;
  }

  return undefined;
}

function mixWithBlack(color: string, amount: number): string {
  const [red, green, blue] = parseHexColor(color);
  const multiplier = 1 - amount;

  return toHexColor([
    Math.round(red * multiplier),
    Math.round(green * multiplier),
    Math.round(blue * multiplier),
  ]);
}

function relativeLuminance([red, green, blue]: readonly number[]): number {
  const linear = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function parseHexColor(color: string): [number, number, number] {
  if (!HEX_COLOR_PATTERN.test(color)) {
    throw new TypeError("Color must use the #RRGGBB format.");
  }

  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function toHexColor(channels: readonly number[]): string {
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function freezeBranding(branding: ResolvedBranding): Readonly<ResolvedBranding> {
  return Object.freeze({
    ...branding,
    logo: branding.logo === null ? null : Object.freeze({ ...branding.logo }),
    colors: Object.freeze({ ...branding.colors }),
  });
}
