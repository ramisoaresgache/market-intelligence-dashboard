# Seguridad

La API del collector es de sólo lectura en esta etapa. No publicar secretos, claves privadas ni credenciales de exchanges: las fuentes iniciales son públicas.

`CORS_ORIGIN` queda en `*` durante la validación inicial del MVP. Antes de exponer endpoints administrativos o datos privados debe restringirse al dominio del dashboard y agregarse autenticación server-to-server.
