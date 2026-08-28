import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = process.cwd();
const layout = readFileSync(resolve(appRoot, "src/app/layout.tsx"), "utf8");
const globals = readFileSync(resolve(appRoot, "src/app/globals.css"), "utf8");
const fontCssPath = resolve(appRoot, "node_modules/@fontsource-variable/inter/wght.css");
const noticesPath = resolve(appRoot, "../../THIRD_PARTY_NOTICES.md");

describe("production typography assets", () => {
  it("loads the bundled Inter variable font and records its license", () => {
    expect(layout).toContain('import "@fontsource-variable/inter/wght.css"');
    expect(globals).toContain('font-family: "Inter Variable", Inter, "Segoe UI", sans-serif');
    expect(existsSync(fontCssPath)).toBe(true);
    const fontCss = readFileSync(fontCssPath, "utf8");
    expect(fontCss).toContain("font-family: 'Inter Variable'");
    expect(fontCss).toContain("inter-latin-wght-normal.woff2");
    expect(existsSync(noticesPath)).toBe(true);
    expect(readFileSync(noticesPath, "utf8")).toMatch(/Inter Project Authors[\s\S]*SIL Open Font License, Version 1\.1/i);
  });
});
