/** Platform-neutral values shared by DOM and native presentation adapters. */
export const PLATFORM_SEMANTIC_TOKENS = {
  colors: {
    background: "#F5F7FB",
    surface: "#FFFFFF",
    surfaceMuted: "#EEF2F7",
    text: "#172033",
    supportText: "#5E687A",
    border: "#D8DEE9",
    accent: "#3157C8",
    accentContrast: "#FFFFFF",
    success: "#16794A",
    successSurface: "#EAF7F0",
    warning: "#9A6700",
    warningSurface: "#FFF7E0",
  },
  spacing: {
    xsmall: 4,
    small: 8,
    medium: 12,
    large: 16,
    xlarge: 24,
    xxlarge: 32,
  },
  radius: { small: 8, medium: 12, large: 16 },
  targets: { web: 44, mobile: 48 },
} as const;
