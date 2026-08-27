import { describe, expect, it } from "vitest";

import { DEFAULT_BRANDING, contrastRatio, resolveBranding } from "./branding";

describe("resolveBranding", () => {
  it("falls back atomically when an accent is unsafe", () => {
    const result = resolveBranding({
      organisationName: "Apex Tutorials",
      accent: "#FAFAFA",
      sharedApp: true,
    });

    expect(result.usedFallbackAccent).toBe(true);
    expect(result.branding.colors).toEqual(DEFAULT_BRANDING.colors);
    expect(result.branding.poweredByVijeeta).toBe(true);
  });

  it("trims a valid organisation name and derives accessible color tokens", () => {
    const result = resolveBranding({
      organisationName: "  Apex Tutorials  ",
      accent: "#3157C8",
      logo: { src: "/apex-logo.svg", alt: "Apex Tutorials" },
    });

    expect(result).toMatchObject({
      usedFallbackAccent: false,
      issues: [],
      branding: {
        organisationName: "Apex Tutorials",
        logo: { src: "/apex-logo.svg", alt: "Apex Tutorials" },
        colors: {
          accent: "#3157C8",
          accentHover: "#2B4DB0",
          accentContrast: "#FFFFFF",
          focus: "#3157C8",
        },
      },
    });
  });

  it("falls back when the accent is not a six-digit hexadecimal color", () => {
    const result = resolveBranding({ organisationName: "Apex", accent: "blue" });

    expect(result.usedFallbackAccent).toBe(true);
    expect(result.branding.colors).toEqual(DEFAULT_BRANDING.colors);
  });

  it.each(["javascript:alert(1)", "data:image/svg+xml,x", "http://x/logo.svg", "//x/y"])(
    "rejects unsafe logo source %s",
    (src) =>
      expect(() =>
        resolveBranding({
          organisationName: "Apex",
          accent: "#3157C8",
          logo: { src, alt: "Apex" },
        }),
      ).toThrow(),
  );

  it.each(["/apex-logo.svg", "https://cdn.example.test/apex-logo.svg"])(
    "accepts platform-neutral safe logo source %s",
    (src) =>
      expect(
        resolveBranding({
          organisationName: "Apex",
          accent: "#3157C8",
          logo: { src, alt: "Apex" },
        }).branding.logo?.src,
      ).toBe(src),
  );

  it("uses WCAG contrast arithmetic for black and white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
  });

  it("rejects empty and overlong organisation names", () => {
    expect(() => resolveBranding({ organisationName: "   ", accent: "#3157C8" })).toThrow();
    expect(() =>
      resolveBranding({ organisationName: "a".repeat(81), accent: "#3157C8" }),
    ).toThrow();
  });
});
