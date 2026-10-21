/* =====================================================================
   Web Mini Games Hub — Auth Page Controller
   Wires the DOM (tabs, forms, buttons) to auth-service.js.
   No Firebase calls happen directly in this file.
===================================================================== */

import {
  registerWithEmail,
  loginWithEmail,
  continueAsGuest,
  friendlyAuthError
} from "./auth-service.js";

/* Where to send the user once they're authenticated (or guest). */
const HUB_PAGE = "hub.html";

/* ---------------------------------------------------------------
   1. Element refs
--------------------------------------------------------------- */
const tabsBar        = document.querySelector(".tabs");
const tabLogin        = document.getElementById("tabLogin");
const tabSignup       = document.getElementById("tabSignup");
const loginForm       = document.getElementById("loginForm");
const signupForm      = document.getElementById("signupForm");
const banner          = document.getElementById("banner");
const guestBtn        = document.getElementById("guestBtn");
const pwStrengthEl    = document.getElementById("pwStrength");

/* ---------------------------------------------------------------
   2. Tab switching (Login <-> Sign Up)
--------------------------------------------------------------- */
function activateTab(target){
  const isSignup = target === "signup";

  tabLogin.classList.toggle("active", !isSignup);
  tabSignup.classList.toggle("active", isSignup);
  tabLogin.setAttribute("aria-selected", String(!isSignup));
  tabSignup.setAttribute("aria-selected", String(isSignup));

  tabsBar.classList.toggle("signup-mode", isSignup);

  loginForm.classList.toggle("active", !isSignup);
  signupForm.classList.toggle("active", isSignup);

  hideBanner();
}

tabLogin.addEventListener("click", () => activateTab("login"));
tabSignup.addEventListener("click", () => activateTab("signup"));

/* ---------------------------------------------------------------
   3. Password visibility toggles
--------------------------------------------------------------- */
document.querySelectorAll(".pw-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "👁" : "🙈";
    btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
});

/* ---------------------------------------------------------------
   4. Password strength meter (signup only)
--------------------------------------------------------------- */
const signupPassword = document.getElementById("signupPassword");

function scorePassword(pw){
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10 && /[A-Z]/.test(pw) && /[0-9]/.test(pw)) score++;
  if (pw.length >= 12 && /[^A-Za-z0-9]/.test(pw)) score++;
  return score; // 0-3
}

signupPassword.addEventListener("input", () => {
  const score = scorePassword(signupPassword.value);
  pwStrengthEl.classList.remove("weak", "medium", "strong");
  if (signupPassword.value.length === 0) return;
  if (score <= 1) pwStrengthEl.classList.add("weak");
  else if (score === 2) pwStrengthEl.classList.add("medium");
  else pwStrengthEl.classList.add("strong");
});

/* ---------------------------------------------------------------
   5. Banner helpers
--------------------------------------------------------------- */
function showBanner(message, type = "error"){
  banner.textContent = message;
  banner.className = `banner show ${type}`;
}

function hideBanner(){
  banner.className = "banner";
  banner.textContent = "";
}

/* Toggles a submit button into/out of a loading state */
function setLoading(button, loading){
  const label = button.querySelector(".btn-label");
  const spinner = button.querySelector(".spinner");
  button.disabled = loading;
  if (label) label.style.opacity = loading ? "0" : "1";
  if (spinner) spinner.hidden = !loading;
}

function goToHub(){
  window.location.href = HUB_PAGE;
}

/* ---------------------------------------------------------------
   6. Login (email/password)
--------------------------------------------------------------- */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideBanner();

  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const submitBtn = document.getElementById("loginSubmit");

  if (!email || !password){
    showBanner("Please fill in both fields.");
    return;
  }

  setLoading(submitBtn, true);
  try{
    await loginWithEmail({ email, password });
    showBanner("Welcome back! Redirecting…", "success");
    setTimeout(goToHub, 700);
  }catch(error){
    showBanner(friendlyAuthError(error));
  }finally{
    setLoading(submitBtn, false);
  }
});

/* ---------------------------------------------------------------
   7. Sign up (email/password)
--------------------------------------------------------------- */
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideBanner();

  const name     = document.getElementById("signupName").value.trim();
  const email    = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const confirm  = document.getElementById("signupConfirm").value;
  const agreed   = document.getElementById("agreeTerms").checked;
  const submitBtn = document.getElementById("signupSubmit");

  if (!name || !email || !password || !confirm){
    showBanner("Please fill in every field.");
    return;
  }
  if (password.length < 6){
    showBanner("Password must be at least 6 characters.");
    return;
  }
  if (password !== confirm){
    showBanner("Passwords don't match.");
    return;
  }
  if (!agreed){
    showBanner("Please agree to the Terms and Privacy Policy.");
    return;
  }

  setLoading(submitBtn, true);
  try{
    await registerWithEmail({ name, email, password });
    showBanner("Account created! Redirecting…", "success");
    setTimeout(goToHub, 700);
  }catch(error){
    showBanner(friendlyAuthError(error));
  }finally{
    setLoading(submitBtn, false);
  }
});

/* ---------------------------------------------------------------
   8. Continue as guest (client-side only — no Firebase Auth, no record)
--------------------------------------------------------------- */
guestBtn.addEventListener("click", async () => {
  hideBanner();
  guestBtn.disabled = true;
  const label = guestBtn.querySelector("span:last-child");
  const originalLabel = label.textContent;
  label.textContent = "Entering as guest…";

  try{
    await continueAsGuest();
    goToHub();
  }catch(error){
    showBanner(friendlyAuthError(error));
  }finally{
    guestBtn.disabled = false;
    label.textContent = originalLabel;
  }
});
