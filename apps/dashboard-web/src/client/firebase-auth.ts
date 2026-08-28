import type { ProductionAuthSession, ProductionUser } from "./production-api";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  getRedirectResult,
  sendEmailVerification,
  signInWithRedirect,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
} from "firebase/auth";

interface FirebaseUserLike {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified?: boolean;
  reload?(): Promise<void>;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

interface FirebaseAuthLike {
  currentUser: FirebaseUserLike | null;
}

export interface FirebaseRuntime {
  auth: FirebaseAuthLike;
  GoogleAuthProvider: new () => unknown;
  signInWithPopup(auth: FirebaseAuthLike, provider: unknown): Promise<{ user: FirebaseUserLike }>;
  signInWithEmailAndPassword(auth: FirebaseAuthLike, email: string, password: string): Promise<{ user: FirebaseUserLike }>;
  createUserWithEmailAndPassword(auth: FirebaseAuthLike, email: string, password: string): Promise<{ user: FirebaseUserLike }>;
  sendEmailVerification(user: FirebaseUserLike): Promise<void>;
  signInWithRedirect(auth: FirebaseAuthLike, provider: unknown): Promise<void>;
  getRedirectResult(auth: FirebaseAuthLike): Promise<{ user: FirebaseUserLike } | null>;
  signOut(auth: FirebaseAuthLike): Promise<void>;
  onAuthStateChanged(auth: FirebaseAuthLike, listener: (user: FirebaseUserLike | null) => void): () => void;
}

function userFromFirebase(user: FirebaseUserLike | null): ProductionUser | null {
  return user
    ? { uid: user.uid, email: user.email, displayName: user.displayName }
    : null;
}

function config() {
  const values = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (Object.values(values).some((value) => !value)) {
    throw new Error("Firebase configuration is missing. Set the NEXT_PUBLIC_FIREBASE_* variables.");
  }
  return values;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Local development only. The production image never sets this variable, and a
 * non-loopback host is ignored, so a deployed browser bundle can never be
 * pointed at someone else's Auth emulator.
 */
export function authEmulatorUrl(host: string | undefined = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST): string | null {
  if (!host) return null;
  const [hostname] = host.split(":");
  if (hostname === undefined || !LOOPBACK_HOSTNAMES.has(hostname)) return null;
  return `http://${host}`;
}

async function loadRuntime(): Promise<FirebaseRuntime> {
  const firebaseConfig = config();
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  let auth: FirebaseAuthLike;
  try {
    // initializeAuth, unlike getAuth, installs no popup/redirect resolver, and
    // signInWithPopup then fails with auth/argument-error. It has to be named
    // explicitly here.
    // Session-scoped, not in-memory. A redirect sign-in navigates away and
    // back, and in-memory state does not survive that, so the viewer returned
    // signed out and bounced to the sign-in screen. sessionStorage is cleared
    // when the tab closes and is not shared with other tabs.
    auth = initializeAuth(app, {
      persistence: browserSessionPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    }) as unknown as FirebaseAuthLike;
  } catch {
    // A hot-reloaded browser can already have an Auth instance for this app.
    auth = getAuth(app) as unknown as FirebaseAuthLike;
    await setPersistence(auth as unknown as Auth, browserSessionPersistence);
  }
  const emulator = authEmulatorUrl();
  if (emulator !== null) {
    connectAuthEmulator(auth as unknown as Auth, emulator, { disableWarnings: true });
  }
  return {
    auth,
    GoogleAuthProvider,
    signInWithPopup: signInWithPopup as unknown as FirebaseRuntime["signInWithPopup"],
    signInWithEmailAndPassword: signInWithEmailAndPassword as unknown as FirebaseRuntime["signInWithEmailAndPassword"],
    createUserWithEmailAndPassword: createUserWithEmailAndPassword as unknown as FirebaseRuntime["createUserWithEmailAndPassword"],
    sendEmailVerification: sendEmailVerification as unknown as FirebaseRuntime["sendEmailVerification"],
    signInWithRedirect: signInWithRedirect as unknown as FirebaseRuntime["signInWithRedirect"],
    getRedirectResult: getRedirectResult as unknown as FirebaseRuntime["getRedirectResult"],
    signOut: signOut as unknown as FirebaseRuntime["signOut"],
    onAuthStateChanged: onAuthStateChanged as unknown as FirebaseRuntime["onAuthStateChanged"],
  };
}

/** Firebase Auth only. Tokens refresh on every API request and live no longer than the browser tab. */
export function createFirebaseAuth(options: { loadRuntime?: () => Promise<FirebaseRuntime> } = {}): ProductionAuthSession {
  let currentUser: ProductionUser | null = null;
  let runtimePromise: Promise<FirebaseRuntime> | null = null;
  const requireRuntime = () => {
    runtimePromise ??= (options.loadRuntime ?? loadRuntime)().then((loaded) => {
      currentUser = userFromFirebase(loaded.auth.currentUser);
      return loaded;
    });
    return runtimePromise;
  };

  const session: ProductionAuthSession = {
    get currentUser() {
      return currentUser;
    },
    async getIdToken(forceRefresh = false) {
      const loaded = await requireRuntime();
      const user = loaded.auth.currentUser;
      if (!user) throw new Error("Sign in to continue");
      currentUser = userFromFirebase(user);
      return user.getIdToken(forceRefresh);
    },
    async signInWithEmailPassword(email: string, password: string) {
      const loaded = await requireRuntime();
      const result = await loaded.signInWithEmailAndPassword(loaded.auth, email, password);
      currentUser = userFromFirebase(result.user);
      return currentUser!;
    },
    /**
     * The server refuses to onboard an unverified principal, so account
     * creation sends the verification email immediately. Firebase delivers it,
     * not this service. Google sign-in stays the path that yields a verified
     * principal without a separate step.
     */
    async createAccountWithEmailPassword(email: string, password: string) {
      const loaded = await requireRuntime();
      const result = await loaded.createUserWithEmailAndPassword(loaded.auth, email, password);
      await loaded.sendEmailVerification(result.user);
      currentUser = userFromFirebase(result.user);
      return currentUser!;
    },
    async resendEmailVerification() {
      const loaded = await requireRuntime();
      const user = loaded.auth.currentUser;
      if (!user) throw new Error("Sign in to continue");
      await loaded.sendEmailVerification(user);
    },
    async isEmailVerified() {
      const loaded = await requireRuntime();
      const user = loaded.auth.currentUser;
      if (!user) return false;
      await user.reload?.();
      return user.emailVerified === true;
    },
    /**
     * Loads Firebase ahead of the click. Initialising inside the click handler
     * spends the browser's transient user activation, and window.open is then
     * blocked silently, which reads as "nothing happened".
     */
    async prepare() {
      await requireRuntime();
    },
    /** Completes a redirect sign-in after the browser navigates back. */
    async completeRedirectSignIn() {
      const loaded = await requireRuntime();
      const result = await loaded.getRedirectResult(loaded.auth);
      if (result === null) return null;
      currentUser = userFromFirebase(result.user);
      return currentUser;
    },
    async signInWithGoogle() {
      const loaded = await requireRuntime();
      const provider = new loaded.GoogleAuthProvider();
      try {
        const result = await loaded.signInWithPopup(loaded.auth, provider);
        currentUser = userFromFirebase(result.user);
        return currentUser!;
      } catch (error) {
        const code = (error as { code?: string }).code;
        // A blocked or dismissed popup is recoverable: the redirect flow needs
        // no popup at all. It navigates away, so this never returns a user.
        if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request" || code === "auth/operation-not-supported-in-this-environment") {
          await loaded.signInWithRedirect(loaded.auth, provider);
          throw Object.assign(new Error("Continuing sign-in in this tab…"), { code: "auth/redirecting" });
        }
        if (code === "auth/popup-closed-by-user") {
          throw Object.assign(new Error("Sign-in was cancelled before it finished."), { code });
        }
        throw error;
      }
    },
    async signOut() {
      const loaded = await requireRuntime();
      await loaded.signOut(loaded.auth);
      currentUser = null;
    },
    subscribe(listener) {
      let active = true;
      let firebaseUnsubscribe: (() => void) | null = null;
      void requireRuntime()
        .then((loaded) => {
          if (!active) return;
          firebaseUnsubscribe = loaded.onAuthStateChanged(loaded.auth, (user) => {
            currentUser = userFromFirebase(user);
            listener(currentUser);
          });
        })
        .catch(() => {
          if (active) listener(null);
        });
      const unsubscribe = () => {
        active = false;
        firebaseUnsubscribe?.();
      };
      return unsubscribe;
    },
  };
  return session;
}
