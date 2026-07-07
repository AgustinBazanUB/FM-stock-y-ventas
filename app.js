import {watchSession, submitLogin, logout} from "./auth.js";
import {renderAdmin, destroyAdmin} from "./admin.js?v=18";
import {renderSeller, destroySeller} from "./seller.js";
import {$, toast, setBusy, updateConnectionStatus, handleImageError} from "./utils.js";

const loading = $("#loading-screen");
const loginScreen = $("#login-screen");
const appScreen = $("#app-screen");
let currentRole = null;

function showLogin(error = "") {
  destroyAdmin(); destroySeller(); currentRole = null;
  loading.classList.add("hidden"); appScreen.classList.add("hidden"); loginScreen.classList.remove("hidden");
  $("#login-error").textContent = error;
}

function showApp(profile) {
  loading.classList.add("hidden"); loginScreen.classList.add("hidden"); appScreen.classList.remove("hidden");
  if (currentRole && currentRole !== profile.role) { destroyAdmin(); destroySeller(); }
  currentRole = profile.role;
  profile.role === "admin" ? renderAdmin(appScreen, profile, logout) : renderSeller(appScreen, profile, logout);
}

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  $("#login-error").textContent = "";
  setBusy(button, true, "Ingresando…");
  try { await submitLogin($("#login-email").value, $("#login-password").value); }
  catch (error) { $("#login-error").textContent = error.message; }
  finally { setBusy(button, false); }
});

watchSession(async (user, profile, error) => {
  if (!user) return showLogin();
  if (error) { await logout(); return showLogin("No se pudo leer tu perfil. Revisá la conexión y los permisos."); }
  if (!profile) { await logout(); return showLogin("Tu usuario no tiene un perfil configurado en Firestore."); }
  if (!profile.active) { await logout(); return showLogin("Tu usuario está inactivo. Consultá al administrador."); }
  if (!["admin","seller"].includes(profile.role)) { await logout(); return showLogin("Tu usuario no tiene un rol válido."); }
  if (profile.role === "seller" && !(profile.allowedLocationIds || []).length) { await logout(); return showLogin("No tenés ubicaciones asignadas. Consultá al administrador."); }
  showApp(profile);
});

window.addEventListener("online", () => { updateConnectionStatus("online"); toast("Conexión restablecida", "success"); });
window.addEventListener("offline", () => updateConnectionStatus("offline"));
document.addEventListener("error", event => handleImageError(event.target), true);
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
