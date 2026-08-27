import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("health route", () => {
  it("exposes only status, build, and mode", async () => {
    const response = await GET();
    expect(Object.keys(await response.json()).sort()).toEqual(["build", "mode", "status"]);
  });
});
