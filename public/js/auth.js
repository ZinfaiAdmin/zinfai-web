/* =====================================================================
   Zinfai account layer — registration, email verification, gated downloads
   ---------------------------------------------------------------------
   Loaded as a module (`<script type="module" src="/js/auth.js">`) so it can
   pull the Firebase SDK straight from the CDN. That keeps the site's "no
   build step" property intact — there is still nothing to compile.

   It exposes window.ZinfaiAuth and fires a `zinfai-auth` event on document
   whenever the signed-in state changes, so plain classic scripts and inline
   page code can react without importing anything.

   The gate itself lives in the Cloud Function. Everything here is UI: it can
   be bypassed with devtools and that is fine, because a bypassed client just
   gets a 401 or 403 from /api/download.
   ===================================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect,
    GoogleAuthProvider,
    sendEmailVerification,
    sendPasswordResetEmail,
    updateProfile,
    signOut as fbSignOut,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

/* The Firebase web config is public by design — the apiKey identifies the
   project, it does not authorise anything. Access is controlled by the
   Firestore rules and by the token checks in functions/index.js. */
const app = initializeApp({
    apiKey: "AIzaSyDoNScd7piqjfUSZrlToBJzVeuleVZpqIo",
    authDomain: "zinfai-web.firebaseapp.com",
    projectId: "zinfai-web",
    storageBucket: "zinfai-web.firebasestorage.app",
    messagingSenderId: "160179727078",
    appId: "1:160179727078:web:187a419329062591156927",
});

const auth = getAuth(app);
auth.useDeviceLanguage();

/* ---- friendlier wording than Firebase's raw error codes ---- */
const MESSAGES = {
    "auth/email-already-in-use": "That email already has an account. Try signing in instead.",
    "auth/invalid-email": "That doesn't look like a valid email address.",
    "auth/weak-password": "Please choose a password of at least 8 characters.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/user-not-found": "No account found for that email address.",
    "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
    "auth/popup-closed-by-user": "The Google sign-in window was closed before finishing.",
    "auth/popup-blocked": "Your browser blocked the sign-in popup. Please allow popups and retry.",
    "auth/network-request-failed": "Network problem — check your connection and try again.",
};

function describe(err) {
    return MESSAGES[err && err.code] || (err && err.message) || "Something went wrong. Please try again.";
}

/* ---- API calls ---------------------------------------------------------
   Same-origin thanks to the /api/** hosting rewrite, so no CORS dance. */
async function callApi(path, { method = "POST", body, auth: needsAuth = true } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (needsAuth) {
        const user = auth.currentUser;
        if (!user) throw new Error("Please sign in first.");
        headers.Authorization = "Bearer " + (await user.getIdToken());
    }
    const res = await fetch("/api" + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || "Request failed.");
        err.code = data.code;
        err.status = res.status;
        throw err;
    }
    return data;
}

/* Records the registration server-side. Called on every sign-in, not just
   the first, so lastSeenAt and emailVerified stay current. */
function syncProfile() {
    return callApi("/profile").catch((e) => console.warn("profile sync failed", e));
}

/* ---- verification ------------------------------------------------------ */

const verifySettings = {
    url: location.origin + "/register?verified=1",
    handleCodeInApp: false,
};

async function sendVerification() {
    if (!auth.currentUser) throw new Error("Please sign in first.");
    await sendEmailVerification(auth.currentUser, verifySettings);
}

/* Firebase caches email_verified in the ID token, so a user who has just
   clicked the link still looks unverified until the token is refreshed.
   Reload the user record, then force a fresh token. */
async function refreshVerification() {
    const user = auth.currentUser;
    if (!user) return false;
    await user.reload();
    await user.getIdToken(true);
    if (user.emailVerified) await syncProfile();
    return user.emailVerified;
}

/* ---- public surface ---------------------------------------------------- */

const ZinfaiAuth = {
    describe,

    get user() {
        return auth.currentUser;
    },

    get isVerified() {
        return !!(auth.currentUser && auth.currentUser.emailVerified);
    },

    /* Resolves once Firebase has restored (or ruled out) a session, so pages
       can await a settled state instead of flashing the signed-out UI. */
    ready: new Promise((resolve) => {
        const stop = onAuthStateChanged(auth, (user) => {
            stop();
            resolve(user);
        });
    }),

    async signUp(email, password, displayName) {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) await updateProfile(cred.user, { displayName });
        await sendEmailVerification(cred.user, verifySettings);
        await syncProfile();
        return cred.user;
    },

    async signIn(email, password) {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await syncProfile();
        return cred.user;
    },

    /* Google accounts arrive already verified, so these users skip the
       email step entirely. */
    async signInWithGoogle() {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        try {
            const cred = await signInWithPopup(auth, provider);
            await syncProfile();
            return cred.user;
        } catch (err) {
            /* Popups are blocked outright in some embedded browsers. */
            if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
                await signInWithRedirect(auth, provider);
                return null;
            }
            throw err;
        }
    },

    signOut: () => fbSignOut(auth),
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    sendVerification,
    refreshVerification,
    syncProfile,

    /* Asks the function for a short-lived signed GitHub URL and starts the
       download. Throws with code "email-not-verified" if the gate rejects. */
    async download(product, platform) {
        const data = await callApi("/download", { body: { product, platform } });
        location.href = data.url;
        return data;
    },

    /* Public: current version and file names, no URLs. */
    manifest: (product) =>
        callApi("/manifest?product=" + encodeURIComponent(product), { method: "GET", auth: false }),
};

window.ZinfaiAuth = ZinfaiAuth;

onAuthStateChanged(auth, (user) => {
    document.documentElement.classList.toggle("is-signed-in", !!user);
    document.documentElement.classList.toggle("is-verified", !!(user && user.emailVerified));
    document.dispatchEvent(new CustomEvent("zinfai-auth", { detail: { user } }));
});

export default ZinfaiAuth;
