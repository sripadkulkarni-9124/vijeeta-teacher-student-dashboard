import { describe, expect, it, vi } from "vitest";

import { createFirebaseAuth, type FirebaseRuntime } from "./firebase-auth";

function runtime() {
  const firebaseUser = {
    uid: "uid-1",
    email: "aarav@example.test",
    displayName: "Aarav",
    getIdToken: vi.fn(async () => "fresh-token"),
  };
  const auth = { currentUser: firebaseUser };
  let listener: ((user: typeof firebaseUser | null) => void) | undefined;
  const unsubscribe = vi.fn();
  const loaded: FirebaseRuntime = {
    auth,
    GoogleAuthProvider: class {},
    signInWithPopup: vi.fn(async () => ({ user: firebaseUser })),
    signOut: vi.fn(async () => undefined),
    onAuthStateChanged: vi.fn((_auth, next) => {
      listener = next;
      return unsubscribe;
    }),
  };
  return { loaded, firebaseUser, unsubscribe, getListener: () => listener };
}

describe("Firebase production auth", () => {
  it("refreshes tokens in memory and cleans up the Firebase listener", async () => {
    const fake = runtime();
    const auth = createFirebaseAuth({ loadRuntime: async () => fake.loaded });
    expect(auth.currentUser).toBeNull();
    const stop = auth.subscribe(vi.fn());

    await expect(auth.getIdToken()).resolves.toBe("fresh-token");
    expect(fake.firebaseUser.getIdToken).toHaveBeenCalledWith(true);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    stop();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.getListener()).toBeTypeOf("function");
  });
});
