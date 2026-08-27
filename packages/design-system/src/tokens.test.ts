import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "./tokens";

describe("DEFAULT_THEME", () => {
  it("provides calm semantic colors and accessible sizing tokens", () => {
    expect(DEFAULT_THEME.colors).toMatchObject({
      background: "#F5F7FB",
      surface: "#FFFFFF",
      text: "#172033",
      supportText: "#5E687A",
      border: "#D8DEE9",
      success: "#16794A",
      warning: "#9A6700",
      danger: "#B42318",
    });
    expect(DEFAULT_THEME.sizes.target).toBe("44px");
    expect(DEFAULT_THEME.typography.body).toBe("15px");
    expect(DEFAULT_THEME.typography.support).toBe("12px");
  });

  it("limits radius and motion tokens to the product contract", () => {
    expect(DEFAULT_THEME.radii).toEqual({
      small: "8px",
      medium: "12px",
      large: "16px",
    });
    expect(DEFAULT_THEME.motion).toEqual({
      fast: "120ms",
      standard: "160ms",
      slow: "200ms",
    });
  });
});
