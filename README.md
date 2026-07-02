# Flor Mia · Stock y Ventas

Aplicación web liviana para registrar stock y ventas desde celulares Android, iPhone o computadora. Incluye panel administrador, punto de venta, botonera Bluetooth, descuentos, alertas, métricas, exportación CSV y edición/anulación de ventas con ajuste automático de stock.

## Puesta en marcha

La app usa el proyecto Firebase existente `fm-stock-y-venta`. Antes de abrirla en producción:

1. Activá Firebase Auth y Firestore siguiendo [docs/firebase-setup.md](docs/firebase-setup.md).
2. Creá el primer administrador con [scripts/create-admin.md](scripts/create-admin.md).
3. Publicá reglas e índices:

```bash
npm install -g firebase-tools
firebase login
firebase use fm-stock-y-venta
firebase deploy --only firestore
```

`firebase deploy --only firestore` publica reglas e índices. La configuración opcional de Storage también está incluida; sólo si activás ese servicio en el futuro, publicá sus reglas con `firebase deploy --only storage`.

No inicializa Analytics y no contiene claves privadas. `firebase-config.js` sólo contiene la configuración pública de la web.

### Activar el acceso y crear el primer administrador

1. En Firebase Console abrí **Authentication → Sign-in method** y activá **Email/Password**.
2. En **Authentication → Users** creá el usuario administrador.
3. Copiá su UID y creá `users/{UID}` en Firestore con `name`, `email`, `role: "admin"`, `active: true` y `allowedLocationIds: []`.
4. Seguí el ejemplo exacto de [scripts/create-admin.md](scripts/create-admin.md).

## Abrir localmente

Los módulos del navegador necesitan un servidor local; no abras `index.html` con doble clic. Una opción simple, con Python instalado, es:

```bash
python -m http.server 8080
```

Después abrí `http://localhost:8080`. Para probar la PWA completa conviene usar el sitio HTTPS de Netlify.

## Publicar en Netlify y conectar GitHub

1. Creá un repositorio en GitHub y subí esta carpeta.
2. En Netlify elegí **Add new site → Import an existing project → GitHub**.
3. Elegí el repositorio. No hace falta comando de compilación ni carpeta especial: la carpeta de publicación es la raíz (`.`).
4. Publicá. `_redirects` mantiene la navegación y `netlify.toml` configura caché y cabeceras.
5. Cada cambio enviado a la rama principal se volverá a publicar automáticamente.

## Primeros pasos del administrador

1. **Vendedores:** creá nombre, email, contraseña temporal, estado y ubicaciones. La app crea su usuario de Authentication sin cerrar tu sesión.
2. **Ubicaciones:** creá Local o una feria, definí prefijo, fechas y vendedores. Un vendedor sólo puede abrir las asignadas.
3. **Productos:** cargá nombre, abreviación de hasta 8 caracteres y precio entero. Elegí la imagen desde el catálogo incluido en `assets/products/`; Firestore guarda solamente su ruta.
4. **Botonera:** editá cada producto, tocá **Grabar tecla** y presioná la tecla física.
5. **Stock:** elegí ubicación, agregá productos, cargá stock inicial, precio y alertas. Amarilla debe ser mayor o igual a roja. **Mercadería** suma nuevas unidades y deja un movimiento de auditoría.
6. **Descuentos:** creá montos fijos o porcentajes y activalos.

### Agregar imágenes sin Firebase Storage

La app usa un catálogo local para no requerir Blaze:

1. Prepará una imagen WebP o JPG vertical/cuadrada, sin rotarla. Full HD (`1080×1920`) es suficiente; procurá que pese menos de 500 KB.
2. Creá una miniatura de aproximadamente `360×360` o `360×480`, también comprimida.
3. Guardá ambas en `assets/products/` con nombres simples, sin espacios.
4. Agregá una entrada en `assets/products/catalog.json` con `id`, `name`, `imageUrl` y `thumbUrl`.
5. Publicá la web y elegí esa imagen al crear o editar el producto. Firestore guarda sólo las rutas.

### Operación diaria del administrador

- Elegí la ubicación en el selector superior antes de revisar stock o ventas.
- **Mercadería** suma unidades y crea un movimiento auditable.
- La alerta roja aparece cuando el stock es menor o igual al límite rojo; la amarilla aparece entre los límites rojo y amarillo.
- En **Vendedores**, creá el acceso y asigná una o más ubicaciones. Al eliminarlo se bloquea su operación, aunque Firebase Auth conserve su cuenta.
- En **Ventas**, una anulación devuelve stock y deja la venta marcada como anulada.
- En **Exportar**, filtrá por fecha o vendedor y descargá ventas o stock en CSV.

La sección **Ayuda** del panel resume el orden de configuración y el uso diario. Todos los precios, descuentos y totales se manejan sin decimales.

Las bajas son lógicas: nunca borran ventas ni movimientos históricos. Productos, ubicaciones y descuentos se pueden recuperar desde sus secciones **… eliminados**. Para eliminar una ubicación, el administrador debe volver a confirmar su email y contraseña. Los vendedores eliminados pierden sus asignaciones y no se restauran desde el panel; su cuenta de Firebase Authentication sigue existiendo, pero queda bloqueada por el perfil inactivo.

En **Stock**, **Eliminar stock** lo deja en cero y lo oculta de esa ubicación. Si el producto se agrega otra vez, siempre comienza con stock inicial `0`.

## Vender

1. Ingresá como vendedor y elegí ubicación si hay más de una.
2. Tocá productos o usá sus teclas: la botonera queda activa automáticamente al abrir **Nueva venta**. Se pausa mientras escribís en un campo o hay una ventana abierta y vuelve a enfocarse al continuar.
3. Corregí cantidades con `+` y `-`, y aplicá un descuento si corresponde.
4. Tocá **Continuar**. La app valida stock, genera el código, guarda la venta y descuenta unidades en una sola transacción.

El botón **Tiquet** queda reservado para una futura integración fiscal. Sin internet se puede armar el carrito, pero no confirmar: esto evita vender el mismo stock desde dos dispositivos desconectados.

## Editar o anular ventas

En el menú del vendedor abrí **Ventas totales**, tocá una venta propia y elegí **Editar** o **Anular**. Editar calcula diferencias; anular cambia el estado a `cancelled`, registra quién y cuándo la anuló, crea movimientos de auditoría y devuelve todas las unidades en la misma transacción. Nada se borra físicamente.

En el administrador, las ventas activas quedan en **Ventas** y las anuladas pasan a **Ventas anuladas**. Desde allí el administrador puede restaurarlas: la app comprueba que todos los productos sigan activos y que haya stock suficiente, vuelve a descontar las unidades y registra movimientos `sale_restore`.

## Alertas, métricas y CSV

El resumen administrativo muestra primero alertas rojas y luego amarillas, siempre para la ubicación elegida. También calcula total, cantidad de ventas, productos, ticket promedio, ranking, ventas por vendedor/hora y stock restante sobre las ventas recientes escuchadas en tiempo real.

En **Exportar** descargá ventas o stock en CSV. Las ventas se pueden filtrar por fecha y vendedor; la descarga incluye código, fecha/hora, ubicación, vendedor, productos, cantidades, subtotal, descuento, total y estado.

## Datos iniciales opcionales

El método recomendado es crear los datos desde el panel. Si preferís cargar ejemplos por script, usá credenciales de aplicación fuera del repositorio:

```bash
npm install firebase-admin --no-save
gcloud auth application-default login
node scripts/seed-data.js
```

El script agrega productos, tres ubicaciones y descuentos de ejemplo; no crea usuarios ni stock. No lo ejecutes dos veces porque generará duplicados. Nunca copies una clave privada dentro de esta carpeta.

## Solución de problemas

Si la botonera no responde:

1. Confirmá que siga conectada por Bluetooth.
2. Tocá **Reactivar botonera**.
3. Revisá Num Lock y el modo Android/iOS del teclado.
4. Confirmá que Chrome esté activo y que no haya un campo de texto o modal abierto.
5. Si una tecla envía otro código, volvé a grabarla desde el mismo celular.

También podés seguir [docs/botonera-bluetooth.md](docs/botonera-bluetooth.md).

Si los datos no actualizan: revisá conexión, refrescá Chrome, cerrá y abrí la app, confirmá que las reglas estén desplegadas y que el usuario esté activo y asignado a la ubicación. Un error que pide un índice suele indicar que falta desplegar `firestore.indexes.json`.

La PWA guarda sólo los archivos de la aplicación. No cachea manualmente ventas ni respuestas de Firestore. El carrito queda local hasta confirmar y el administrador escucha en tiempo real únicamente la ubicación seleccionada.
