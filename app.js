import {watchSession, submitLogin, logout} from "./auth.js";
import {renderAdmin, destroyAdmin} from "./admin.js?v=23";
import {renderSeller, destroySeller} from "./seller.js?v=23";
import {$, toast, setBusy, updateConnectionStatus, handleImageError} from "./utils.js";

const loading = $("#loading-screen");
const loginScreen = $("#login-screen");
const appScreen = $("#app-screen");
let currentPanel = null;
let currentProfile = null;

function hasAdminAccess(profile) {
  return profile?.role === "admin" || profile?.canAccessAdmin === true || profile?.isAdmin === true || (Array.isArray(profile?.roles) && profile.roles.includes("admin"));
}

function preferredPanel(profile) {
  if (!hasAdminAccess(profile)) return "seller";
  const saved = localStorage.getItem("preferredPanel");
  if (["admin","seller"].includes(saved)) return saved;
  return profile.role === "seller" ? "seller" : "admin";
}

function switchPanel(panel) {
  if (!currentProfile || !["admin","seller"].includes(panel)) return;
  if (panel === "admin" && !hasAdminAccess(currentProfile)) return toast("No tenés permisos para abrir el panel administrador", "error");
  localStorage.setItem("preferredPanel", panel);
  showApp(currentProfile, panel);
}

function showLogin(error = "") {
  destroyAdmin(); destroySeller(); currentPanel = null; currentProfile = null;
  loading.classList.add("hidden"); appScreen.classList.add("hidden"); loginScreen.classList.remove("hidden");
  $("#login-error").textContent = error;
}

function showApp(profile, forcedPanel = null) {
  loading.classList.add("hidden"); loginScreen.classList.add("hidden"); appScreen.classList.remove("hidden");
  currentProfile = profile;
  const canAccessAdmin = hasAdminAccess(profile);
  const panel = forcedPanel || preferredPanel(profile);
  const nextPanel = panel === "admin" && canAccessAdmin ? "admin" : "seller";
  if (currentPanel && currentPanel !== nextPanel) { destroyAdmin(); destroySeller(); }
  currentPanel = nextPanel;
  const panelOptions = {currentPanel:nextPanel, canAccessAdmin, onPanelChange:switchPanel};
  nextPanel === "admin" ? renderAdmin(appScreen, profile, logout, panelOptions) : renderSeller(appScreen, profile, logout, panelOptions);
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
  if (!hasAdminAccess(profile) && profile.role === "seller" && !(profile.allowedLocationIds || []).length) { await logout(); return showLogin("No tenés ubicaciones asignadas. Consultá al administrador."); }
  showApp(profile);
});

window.addEventListener("online", () => { updateConnectionStatus("online"); toast("Conexión restablecida", "success"); });
window.addEventListener("offline", () => updateConnectionStatus("offline"));
document.addEventListener("error", event => handleImageError(event.target), true);
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
