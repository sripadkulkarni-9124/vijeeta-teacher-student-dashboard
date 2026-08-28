import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = resolve(process.cwd(), "src/app/globals.css");
const css = existsSync(stylesheet) ? readFileSync(stylesheet, "utf8") : "";

describe("dashboard responsive contract", () => {
  it("defines the exact Academic Precision visual tokens and structural dimensions", () => {
    expect(css).toContain("--color-primary: #3525cd");
    expect(css).toContain("--color-primary-container: #4f46e5");
    expect(css).toContain("--color-surface: #f7f9fb");
    expect(css).toContain("--color-success: #005338");
    expect(css).toContain("--color-warning: #9a6700");
    expect(css).toContain("--space-unit: 4px");
    expect(css).toContain("--card-radius: 16px");
    expect(css).toContain("--sidebar-width: 256px");
    expect(css).toContain("--header-height: 64px");
    expect(css).toContain('font-family: "Inter Variable", Inter, "Segoe UI", sans-serif');
  });

  it("defines 12, 8, and 4-column layout contracts", () => {
    expect(css).toContain("grid-template-columns: repeat(12, minmax(0, 1fr))");
    expect(css).toContain("grid-template-columns: repeat(8, minmax(0, 1fr))");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain("@media (min-width: 768px) and (max-width: 1279px)");
    expect(css).toContain('grid-template-areas: "brand spacer logout" "workspace workspace workspace"');
  });

  it("keeps interactive controls touch friendly on narrow screens", () => {
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("@media (max-width: 720px)");
  });

  it("exposes reduced-motion and safe-area support", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("safe-area-inset-bottom");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline: 3px solid var(--color-primary)");
    expect(css).toContain("animation-duration: 0.01ms !important");
  });

  it("styles only semantically current Admin subsection links", () => {
    expect(css).toContain('.admin-section-nav a[aria-current="location"]');
    expect(css).not.toContain(".admin-section-nav a:first-child");
  });

  it("defines distinct teacher and student dashboard layouts", () => {
    expect(css).toContain(".teacher-dashboard__grid");
    expect(css).toContain(".student-test-groups");
    expect(css).toContain(".student-question__choice");
    expect(css).toContain(".teacher-tools");
  });
});
