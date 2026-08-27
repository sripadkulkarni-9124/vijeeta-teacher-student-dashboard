/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cssText = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarationBlocksFor(selector: string): string[] {
  return Array.from(cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) =>
      match[1]
        .split(",")
        .map((candidate) => candidate.trim())
        .includes(selector),
    )
    .map((match) => match[2]);
}

describe("web styles", () => {
  it("keeps interactive targets, radii, type, and motion within the accessibility contract", () => {
    expect(cssText).toMatch(/min-height:\s*var\(--vjt-size-target,\s*44px\)/);
    expect(cssText).toContain("--vjt-radius-small: 8px");
    expect(cssText).toContain("--vjt-radius-medium: 12px");
    expect(cssText).toContain("--vjt-radius-large: 16px");
    expect(cssText).toMatch(/font-size:\s*var\(--vjt-font-body,\s*15px\)/);
    expect(cssText).toMatch(/font-size:\s*var\(--vjt-font-support,\s*12px\)/);
    expect(cssText).toMatch(
      /transition[^;]*var\(--vjt-motion-(?:fast|standard|slow),\s*(?:120|160|200)ms\)/,
    );
  });

  it("uses semantic variables, visible keyboard focus, and reduced-motion overrides", () => {
    expect(cssText).toContain(":focus-visible");
    expect(cssText).toContain("@media (prefers-reduced-motion: reduce)");
    expect(cssText).toContain("transition-duration: 0.01ms");
    expect(cssText).not.toMatch(/--vjt-tenant-/);
    expect(cssText).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("gives links the same 44px minimum target as other interactive controls", () => {
    expect(declarationBlocksFor(".vjt-link")).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/min-height:\s*var\(--vjt-size-target,\s*44px\)/),
      ]),
    );
  });

  it("keeps button text at the body-size token after native font normalization", () => {
    const buttonBlocks = declarationBlocksFor(".vjt-button");

    expect(buttonBlocks).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/font-size:\s*var\(--vjt-font-body,\s*15px\)/),
      ]),
    );
    expect(buttonBlocks.join("\n")).not.toMatch(/font:\s*inherit/);
  });

  it("preserves primary contrast and button treatment when an action is a link", () => {
    const primaryLinkBlocks = declarationBlocksFor(
      ".vjt-link.vjt-button--primary",
    );

    expect(primaryLinkBlocks).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/color:\s*var\(--vjt-color-accent-contrast\)/),
        expect.stringMatching(/text-decoration:\s*none/),
      ]),
    );
  });
});
