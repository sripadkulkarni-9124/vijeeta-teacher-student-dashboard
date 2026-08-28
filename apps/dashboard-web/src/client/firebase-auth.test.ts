import { describe, expect, it, vi } from "vitest";

import { authEmulatorUrl, createFirebaseAuth, type FirebaseRuntime } from "./firebase-auth";

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
  it("does not initialize Firebase until a browser auth operation or subscription needs it", () => {
    const fake = runtime();
    const loadRuntime = vi.fn(async () => fake.loaded);

    const auth = createFirebaseAuth({ loadRuntime });

    expect(auth.currentUser).toBeNull();
    expect(loadRuntime).not.toHaveBeenCalled();
  });

  it("refreshes tokens in memory and cleans up the Firebase listener", async () => {
    const fake = runtime();
    const auth = createFirebaseAuth({ loadRuntime: async () => fake.loaded });
    expect(auth.currentUser).toBeNull();
    const stop = auth.subscribe(vi.fn());

    await expect(auth.getIdToken(false)).resolves.toBe("fresh-token");
    await expect(auth.getIdToken(true)).resolves.toBe("fresh-token");
    expect(fake.firebaseUser.getIdToken).toHaveBeenNthCalledWith(1, false);
    expect(fake.firebaseUser.getIdToken).toHaveBeenNthCalledWith(2, true);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    stop();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.getListener()).toBeTypeOf("function");
  });
});

describe("auth emulator wiring", () => {
  it("accepts only a loopback emulator host", () => {
    expect(authEmulatorUrl("127.0.0.1:9099")).toBe("http://127.0.0.1:9099");
    expect(authEmulatorUrl("localhost:9099")).toBe("http://localhost:9099");
  });

  it("ignores a remote host, an empty value, and an unset variable", () => {
    expect(authEmulatorUrl("auth.example.com:9099")).toBeNull();
    expect(authEmulatorUrl("")).toBeNull();
    expect(authEmulatorUrl(undefined)).toBeNull();
  });
});
