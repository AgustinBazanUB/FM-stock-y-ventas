import {login, logout, observeAuth, getUserProfile} from "./firebase-service.js";

export function watchSession(callback) {
  return observeAuth(async user => {
    if (!user) return callback(null, null);
    try {
      const profile = await getUserProfile(user.uid);
      callback(user, profile ? {id:user.uid, ...profile} : null);
    } catch (error) {
      callback(user, null, error);
    }
  });
}

export async function submitLogin(email, password) {
  try {
    return await login(email.trim(), password);
  } catch (error) {
    const messages = {
      "auth/invalid-credential":"Email o contraseña incorrectos.",
      "auth/user-not-found":"No existe un usuario con ese email.",
      "auth/wrong-password":"La contraseña es incorrecta.",
      "auth/too-many-requests":"Demasiados intentos. Esperá unos minutos y volvé a probar.",
      "auth/network-request-failed":"No hay conexión. Revisá internet y volvé a probar."
    };
    throw new Error(messages[error.code] || "No se pudo iniciar sesión.");
  }
}

export {logout};
