import type { ResolvedBranding } from "@vijeeta/configuration";

import { DEFAULT_THEME, type DesignTheme } from "./tokens";

export type CssVariables = Record<`--vjt-${string}`, string>;

export function createTheme(
  branding: Pick<ResolvedBranding, "colors">,
): Readonly<DesignTheme> {
  return Object.freeze({
    ...DEFAULT_THEME,
    colors: Object.freeze({
      ...DEFAULT_THEME.colors,
      accent: branding.colors.accent,
      accentHover: branding.colors.accentHover,
      accentContrast: branding.colors.accentContrast,
      focus: branding.colors.focus,
    }),
  });
}

export function createCssVariables(theme: Readonly<DesignTheme>): CssVariables {
  return {
    "--vjt-color-background": theme.colors.background,
    "--vjt-color-surface": theme.colors.surface,
    "--vjt-color-surface-muted": theme.colors.surfaceMuted,
    "--vjt-color-text": theme.colors.text,
    "--vjt-color-support-text": theme.colors.supportText,
    "--vjt-color-border": theme.colors.border,
    "--vjt-color-accent": theme.colors.accent,
    "--vjt-color-accent-hover": theme.colors.accentHover,
    "--vjt-color-accent-contrast": theme.colors.accentContrast,
    "--vjt-color-focus": theme.colors.focus,
    "--vjt-color-success": theme.colors.success,
    "--vjt-color-success-surface": theme.colors.successSurface,
    "--vjt-color-warning": theme.colors.warning,
    "--vjt-color-warning-surface": theme.colors.warningSurface,
    "--vjt-color-danger": theme.colors.danger,
    "--vjt-color-danger-surface": theme.colors.dangerSurface,
    "--vjt-space-xsmall": theme.spacing.xsmall,
    "--vjt-space-small": theme.spacing.small,
    "--vjt-space-medium": theme.spacing.medium,
    "--vjt-space-large": theme.spacing.large,
    "--vjt-space-xlarge": theme.spacing.xlarge,
    "--vjt-radius-small": theme.radii.small,
    "--vjt-radius-medium": theme.radii.medium,
    "--vjt-radius-large": theme.radii.large,
    "--vjt-font-body": theme.typography.body,
    "--vjt-font-support": theme.typography.support,
    "--vjt-font-title": theme.typography.title,
    "--vjt-line-height": theme.typography.lineHeight,
    "--vjt-motion-fast": theme.motion.fast,
    "--vjt-motion-standard": theme.motion.standard,
    "--vjt-motion-slow": theme.motion.slow,
    "--vjt-size-target": theme.sizes.target,
    "--vjt-size-content": theme.sizes.content,
  };
}
