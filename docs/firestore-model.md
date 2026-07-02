# Modelo de Firestore

- `users/{uid}`: perfil, rol, estado, ubicaciones permitidas y datos de baja lógica.
- `locations/{locationId}`: local o evento, código de venta, fechas, vendedores y datos de baja/restauración.
- `products/{productId}`: catálogo general, imagen, precio sugerido, tecla y datos de baja/restauración.
- `locationStock/{locationId}/items/{productId}`: precio, tecla, alertas y stock propios de cada ubicación. Una baja guarda `deleted: true`, `active: false` y `currentStock: 0`.
- `stockMovements/{movementId}`: auditoría inmutable de entradas, ventas, ediciones, anulaciones (`sale_cancel`) y restauraciones (`sale_restore`).
- `discounts/{discountId}`: descuentos fijos o porcentuales y datos de baja/restauración.
- `sales/{saleId}`: cabecera, productos, descuento, totales y estado `active` o `cancelled`. Una anulación conserva `cancelledAt`, `cancelledBy` y `cancelledByName`; una restauración agrega `restoredAt`, `restoredBy` y `restoredByName`.
- `counters/{PREFIX_YYYYMMDD}`: correlativo diario por ubicación.

Las entidades recuperables usan `deleted`, `deletedAt`, `deletedBy`, `restoredAt` y `restoredBy`. Las ventas usan códigos `FM-{PREFIJO}-{AAAAMMDD}-{0001}`. Crear, editar o anular una venta actualiza stock y movimientos en una transacción atómica.

No confíes en ocultar botones: la interfaz mejora la experiencia, pero `firestore.rules` y `storage.rules` son la seguridad real.
