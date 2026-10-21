/* =====================================================================
   Firebase Initialization — Web Mini Games Hub
   v10 modular SDK. Import { auth, db } wherever needed.
===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDB27DoxV83es6x0cuB86ggwCIBPAKpFig",
  authDomain: "web-mini-games-hub.firebaseapp.com",
  projectId: "web-mini-games-hub",
  storageBucket: "web-mini-games-hub.firebasestorage.app",
  messagingSenderId: "750714594482",
  appId: "1:750714594482:web:06f96d465cf0d90f1dd5ab",
  measurementId: "G-TKMP3FLPW6"
};

// Single shared app/auth/db instances — every other module imports these
// rather than calling initializeApp() again, so Firebase is only ever
// bootstrapped once per page load no matter how many services use it.
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
