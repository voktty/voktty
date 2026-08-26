# ADR-001: Multiplexar terminales remotas en el helper SSH

## Estado

Aceptado

## Contexto

Voktty ya mantiene un helper Linux por espacio SSH para explorar y editar archivos. Las terminales remotas todavía crean un proceso `ssh` local independiente por pestaña, lo que duplica autenticación, procesos y latencia, y separa el terminal del canal que observa los archivos remotos.

La solución debe conservar el comportamiento local y WSL, permitir varias terminales aisladas dentro de una sesión remota y evitar codificar cada bloque de salida como JSON o Base64.

## Opciones consideradas

| Opción | Ventajas | Costes |
| --- | --- | --- |
| Un proceso SSH por terminal | Implementación existente y sencilla | Más procesos, nueva autenticación y un canal separado por pestaña |
| SSH ControlMaster con terminales separadas | Reutiliza parte de la conexión | Depende de funciones y configuración de OpenSSH y mantiene procesos adicionales |
| PTY administrada por el helper | Un solo canal, control completo y acceso inmediato al mismo host | Requiere multiplexar peticiones, salida y ciclo de vida |

## Decisión

El helper Linux administrará las PTY remotas con `portable-pty`. Cliente y helper usarán un transporte enmarcado sobre la entrada y salida estándar de la conexión SSH persistente:

- longitud `u32` en big endian;
- tipo de mensaje `u8`;
- carga JSON para peticiones y respuestas de control;
- identificador `u64` y bytes directos para entrada y salida PTY;
- identificador `u64` y código `i32` para la salida del proceso.

Cada petición conserva un identificador lógico para resolver respuestas concurrentes. Cada PTY recibe un identificador generado por el cliente y se registra antes de solicitar su apertura, evitando perder salida temprana del shell.

## Invariantes

- Una sesión SSH pertenece a un único espacio remoto y a una única raíz autorizada.
- Una PTY remota solo puede iniciar dentro de la raíz de ese espacio.
- Cerrar o ejecutar `exit` en una PTY no cierra Voktty ni la sesión SSH.
- Cerrar una sesión SSH termina todas sus PTY y resuelve sus peticiones pendientes con error.
- Las terminales locales y WSL continúan usando el transporte PTY actual.
- La ruta crítica de escritura PTY usa bytes directos, sin JSON ni Base64.

## Consecuencias

Positivas:

- una sola negociación SSH y un solo helper por espacio remoto;
- menor consumo por pestaña y respuesta más inmediata;
- terminal, explorador y editor observan el mismo host y raíz;
- el protocolo admite peticiones de archivos mientras una terminal produce salida.

Negativas:

- el lector del canal pasa a ser concurrente y debe enrutar varios tipos de mensaje;
- cliente y helper deben actualizarse juntos al protocolo 2.

Mitigaciones:

- framing y límites de tamaño probados en el crate compartido;
- helper instalado por hash, por lo que una versión incompatible se reemplaza antes del handshake;
- errores de canal propagados a todas las peticiones y PTY activas.

## Condición para revisar

Revisar si necesitamos reconexión transparente después de perder la red, compartir una conexión SSH entre espacios distintos o soportar servidores que no puedan ejecutar el helper.
