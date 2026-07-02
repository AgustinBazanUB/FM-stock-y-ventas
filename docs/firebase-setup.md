# Preparación de Firebase

El proyecto ya configurado es `fm-stock-y-venta`. No crees otro.

## Servicios

En Firebase Console:

1. Activá Authentication con proveedor **Email/Password**.
2. Creá Cloud Firestore en modo producción y elegí una región cercana.
3. Creá el primer administrador siguiendo `scripts/create-admin.md`.

## Reglas e índices

Instalá Node.js y luego Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase use fm-stock-y-venta
firebase deploy --only firestore
```

El deploy publica `firestore.rules` e `firestore.indexes.json`.

## Imágenes y Storage

La configuración de Storage y `storage.rules` están incluidas por compatibilidad futura. Si el proyecto tiene Storage habilitado, sus reglas se publican con:

```bash
firebase deploy --only storage
```

La versión actual no necesita ese servicio ni el plan Blaze: las imágenes de productos se sirven como archivos estáticos desde `assets/products/`. Para agregar una, guardá una versión WebP/JPG y una miniatura, y agregá ambas rutas a `assets/products/catalog.json`.

La web se hospeda en Netlify, no en Firebase Hosting.

La configuración incluida en `firebase-config.js` es pública por diseño. La seguridad está en las reglas. Nunca agregues `serviceAccountKey.json` al repositorio.
