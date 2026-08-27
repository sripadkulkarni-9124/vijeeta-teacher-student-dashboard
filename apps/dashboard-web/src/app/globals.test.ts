import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = resolve(process.cwd(), "src/app/globals.css");
const css = existsSync(stylesheet) ? readFileSync(stylesheet, "utf8") : "";

describe("dashboard responsive contract", () => {
  it("keeps interactive controls touch friendly on narrow screens", () => {
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("@media (max-width: 720px)");
  });

  it("exposes reduced-motion and safe-area support", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("safe-area-inset-bottom");
  });

  it("defines distinct teacher and student dashboard layouts", () => {
    expect(css).toContain(".teacher-dashboard__grid");
    expect(css).toContain(".student-test-groups");
    expect(css).toContain(".student-question__choice");
    expect(css).toContain(".teacher-tools");
  });
});
