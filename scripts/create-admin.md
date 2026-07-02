# Crear el primer administrador

1. Abrí Firebase Console y elegí `fm-stock-y-venta`.
2. En **Authentication → Sign-in method**, activá **Email/Password**.
3. En **Authentication → Users**, elegí **Add user** y cargá email y contraseña.
4. Copiá el UID del usuario creado.
5. En **Firestore Database**, creá la colección `users` y un documento cuyo ID sea exactamente ese UID.
6. Agregá estos campos:

```text
name                 string    Nombre del administrador
email                string    Su email
role                 string    admin
active               boolean   true
allowedLocationIds   array     []
createdAt             timestamp ahora
updatedAt             timestamp ahora
```

No se necesita ni se debe guardar una clave privada en este proyecto.
