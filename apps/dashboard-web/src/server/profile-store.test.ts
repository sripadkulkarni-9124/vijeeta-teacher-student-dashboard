import { describe, expect, it } from "vitest";
import { InMemoryProfileStore } from "./profile-store";

describe("InMemoryProfileStore", () => {
  it("creates one profile for the verified UID and preserves it on read", async () => {
    const store = new InMemoryProfileStore({ now: () => "2026-08-27T00:00:00.000Z" });
    expect(await store.getByFirebaseUid("uid-1")).toBeNull();
    const created = await store.onboard("uid-1", "teacher");
    expect(created.firebaseUid).toBe("uid-1");
    expect(await store.getByFirebaseUid("uid-1")).toEqual(created);
  });

  it("does not silently change an existing role", async () => {
    const store = new InMemoryProfileStore();
    await store.onboard("uid-1", "teacher");
    await expect(store.onboard("uid-1", "student")).rejects.toMatchObject({ code: "profile_exists" });
  });
});
