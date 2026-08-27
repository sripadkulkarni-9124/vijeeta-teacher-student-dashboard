export interface DesignTheme {
  colors: {
    background: string;
    surface: string;
    surfaceMuted: string;
    text: string;
    supportText: string;
    border: string;
    accent: string;
    accentHover: string;
    accentContrast: string;
    focus: string;
    success: string;
    successSurface: string;
    warning: string;
    warningSurface: string;
    danger: string;
    dangerSurface: string;
  };
  spacing: {
    xsmall: string;
    small: string;
    medium: string;
    large: string;
    xlarge: string;
  };
  radii: {
    small: string;
    medium: string;
    large: string;
  };
  typography: {
    body: string;
    support: string;
    title: string;
    lineHeight: string;
  };
  motion: {
    fast: string;
    standard: string;
    slow: string;
  };
  sizes: {
    target: string;
    content: string;
  };
}

export const DEFAULT_THEME: Readonly<DesignTheme> = Object.freeze({
  colors: Object.freeze({
    background: "#F5F7FB",
    surface: "#FFFFFF",
    surfaceMuted: "#EEF2F7",
    text: "#172033",
    supportText: "#5E687A",
    border: "#D8DEE9",
    accent: "#3157C8",
    accentHover: "#2B4DB0",
    accentContrast: "#FFFFFF",
    focus: "#3157C8",
    success: "#16794A",
    successSurface: "#EAF7F0",
    warning: "#9A6700",
    warningSurface: "#FFF7E0",
    danger: "#B42318",
    dangerSurface: "#FFF0EE",
  }),
  spacing: Object.freeze({
    xsmall: "4px",
    small: "8px",
    medium: "12px",
    large: "16px",
    xlarge: "24px",
  }),
  radii: Object.freeze({ small: "8px", medium: "12px", large: "16px" }),
  typography: Object.freeze({
    body: "15px",
    support: "12px",
    title: "20px",
    lineHeight: "1.5",
  }),
  motion: Object.freeze({ fast: "120ms", standard: "160ms", slow: "200ms" }),
  sizes: Object.freeze({ target: "44px", content: "72rem" }),
});
