import { resolveBranding } from "@vijeeta/configuration";
import { describe, expect, it } from "vitest";

import { createCssVariables, createTheme } from "./theme";
import { DEFAULT_THEME } from "./tokens";

describe("theme", () => {
  it("maps resolved branding into semantic theme slots without exposing tenant properties", () => {
    const branding = resolveBranding({
      organisationName: "Apex",
      accent: "#3157C8",
    }).branding;
    const theme = createTheme(branding);

    expect(theme.colors.accent).toBe(branding.colors.accent);
    expect(theme.colors.surface).toBe(DEFAULT_THEME.colors.surface);
    expect(Object.keys(createCssVariables(theme))).not.toContain(
      "--vjt-tenant-accent",
    );
    expect(createCssVariables(theme)).toMatchObject({
      "--vjt-color-accent": "#3157C8",
      "--vjt-color-surface": "#FFFFFF",
      "--vjt-radius-medium": "12px",
    });
  });

  it("copies only the safe branding color contract", () => {
    const branding = resolveBranding({
      organisationName: "Apex",
      accent: "#3157C8",
      logo: { src: "https://cdn.example/logo.svg", alt: "Apex" },
    }).branding;

    const theme = createTheme(branding);
    const variables = createCssVariables(theme);

    expect(JSON.stringify(theme)).not.toContain("organisationName");
    expect(JSON.stringify(theme)).not.toContain("cdn.example");
    expect(
      Object.keys(variables).every((name) => name.startsWith("--vjt-")),
    ).toBe(true);
  });
});
