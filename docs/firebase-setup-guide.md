# Firebase Setup Guide — Web Mini Games Hub

Follow these steps in order. By the end, your auth page (Email/Password, Google, Guest) and Firestore profile writes will work end to end.

---

## Step 1 — Create the Firebase project

1. Go to **https://console.firebase.google.com**
2. Click **Add project**
3. Enter a project name, e.g. `web-mini-games-hub`
4. Click **Continue**
5. Google Analytics toggle — you can turn this **off** (not needed for this app). Click **Continue** / **Create project**
6. Wait for provisioning, then click **Continue** to land in the project dashboard

---

## Step 2 — Register a Web App

1. On the project **Overview** page, click the **`</>`** (web) icon under "Get started by adding Firebase to your app"
2. Give the app a nickname, e.g. `wmgh-web`
3. Leave **"Also set up Firebase Hosting"** unchecked for now (you can add it later)
4. Click **Register app**
5. Firebase shows a config object like this — **copy the whole thing**:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
     authDomain: "web-mini-games-hub.firebaseapp.com",
     projectId: "web-mini-games-hub",
     storageBucket: "web-mini-games-hub.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef1234567890"
   };
   ```

6. Click **Continue to console** (you don't need the SDK snippet it shows — your project already has the imports)

7. Open **`firebase-init.js`** in your project and replace the placeholder object with the real values:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
     authDomain: "web-mini-games-hub.firebaseapp.com",
     projectId: "web-mini-games-hub",
     storageBucket: "web-mini-games-hub.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef1234567890"
   };
   ```

> You can always find this config again later at **⚙️ Project settings → General → Your apps → SDK setup and configuration**.

---

## Step 3 — Enable Authentication providers

1. Left sidebar → **Build → Authentication**
2. Click **Get started**
3. You'll land on the **Sign-in method** tab. Enable three providers:

### Email/Password
1. Click **Email/Password** in the provider list
2. Toggle **Enable** (top option) → leave "Email link (passwordless sign-in)" off
3. Click **Save**

### Google
1. Click **Google** in the provider list
2. Toggle **Enable**
3. Set a **Project support email** (required — pick your own email from the dropdown)
4. Click **Save**

### Anonymous — not needed
Guest Mode does **not** use Firebase's Anonymous Auth provider — it never signs in
to Firebase at all, so there's no Firebase Auth record and no Firestore document
for a guest. You don't need to enable this provider.

You should now see Email/Password and Google listed as **Enabled** on the Sign-in method tab.

---

## Step 4 — Add authorized domains (for Google Sign-In)

1. Still in **Authentication**, click the **Settings** tab → **Authorized domains**
2. `localhost` is already there by default — good for local testing
3. Once you deploy, click **Add domain** and add your real domain (e.g. `webminigameshub.com` or your Firebase Hosting URL `web-mini-games-hub.web.app`)

Without this step, Google popup sign-in will throw `auth/unauthorized-domain` on any domain not listed.

---

## Step 5 — Create the Firestore database

1. Left sidebar → **Build → Firestore Database**
2. Click **Create database**
3. Choose a location (pick the region closest to your users — this can't be changed later). Click **Next**
4. Choose **Start in test mode** for now (open read/write for 30 days — you'll lock it down in Step 6). Click **Create**
5. Wait for provisioning — you'll land in the Firestore data viewer, empty for now

Your app writes to a `users` collection automatically the first time someone signs up — you don't need to create it manually.

---

## Step 6 — Lock down security rules

Test mode rules expire after 30 days and, more importantly, let anyone read or write anyone else's data until then. Replace them now:

1. In **Firestore Database**, click the **Rules** tab
2. Replace the contents with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

3. Click **Publish**

This means: a signed-in (registered) user can only read/write their **own** profile document — never anyone else's. Guests never reach Firestore in the first place (their progress lives only in that browser tab's memory/sessionStorage), so this rule doesn't apply to them at all.

---

## Step 7 — Serve the app over HTTP

Your JS files use ES module imports (`type="module"`), which browsers block on `file://` for security reasons. Pick one:

**Option A — VS Code Live Server (easiest)**
1. Install the "Live Server" extension
2. Right-click `index.html` → **Open with Live Server**
3. It opens at something like `http://127.0.0.1:5500`

**Option B — Node's `serve` package**
```bash
npx serve .
```
Open the `http://localhost:...` URL it prints.

**Option C — Firebase Hosting (also deploys it)**
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# When asked for your public directory, point it at the folder with index.html
firebase serve
```

---

## Step 8 — Add a placeholder hub page

Every successful login/signup/guest sign-in redirects to `hub.html`. Create a temporary stub so you're not redirected to a 404 while testing:

```html
<!DOCTYPE html>
<html>
<body style="background:#0a0e27;color:#fff;font-family:sans-serif;padding:40px">
  <h1>You're in! 🎮</h1>
  <p>Hub page coming soon.</p>
</body>
</html>
```

Save it as `hub.html` in the same folder as `index.html`.

---

## Step 9 — Test the full flow

With the app open via `http://localhost...`:

1. **Sign up** with a test email/password → check **Authentication → Users** tab in the console — you should see the new user appear
2. Check **Firestore Database → Data** tab → `users` collection → a document with that user's UID should exist, containing `coins: 0`, empty `achievements`, default `avatar`/`theme`, and zeroed `statistics`
3. **Log out** (once your hub page has a logout button wired to `logoutUser()`), then **log back in** with the same credentials — the `lastLogin` field in Firestore should update, everything else stays intact
4. Click **Continue with Google** → a popup should appear, ask you to pick an account, then redirect to `hub.html`
5. Click **Continue as Guest** → should redirect immediately. Nothing new should appear in **Authentication → Users** or **Firestore Database → Data** — guests never create a record on either. Earn some coins, log out, click **Continue as Guest** again → coins should be back at the starting default, every time.
6. Try **Forgot password** with a real email you have access to → check your inbox for the reset link

---

## Troubleshooting quick reference

| Error you see | Cause | Fix |
|---|---|---|
| `auth/unauthorized-domain` | Domain not in the authorized list | Step 4 |
| `auth/operation-not-allowed` | Provider not enabled | Step 3 |
| `Failed to resolve module specifier` | Opened via `file://` | Step 7 |
| `Missing or insufficient permissions` (Firestore) | Rules too strict, or user not signed in yet | Step 6 — confirm `request.auth.uid` matches the doc's `uid` |
| Google popup opens then closes instantly | Popup blocked by browser | Allow popups for the site, or check for adblockers interfering |
| `auth/api-key-not-valid` | Wrong or partially-copied config | Re-copy config from Step 2 |

---

Once this is all wired up, the next natural step is building out `hub.html` — the profile view, coin balance, and game launcher that everything redirects to.
