# ADR-002: Ejecutar el reemplazo global como transacción compartida

## Estado

Aceptado

## Contexto

El panel de búsqueda debe poder reemplazar contenido en varios archivos locales, WSL o SSH. Coordinar una escritura por archivo desde React permite carreras entre la previsualización y el guardado, deja cambios parciales si una escritura falla y duplicaría reglas distintas en el proceso Tauri y en `voktty-remote`.

## Opciones consideradas

| Opción | Ventajas | Costes |
| --- | --- | --- |
| Escribir cada archivo desde React | Poca infraestructura inicial | Sin transacción, rollback frágil y reglas duplicadas |
| Implementaciones Rust separadas | Cada runtime controla su sistema de archivos | Riesgo de diferencias en regex, conflictos y recuperación |
| Núcleo Rust compartido con adaptadores | Un único contrato probado para preview, commit y rollback | Añade un crate pequeño y adaptadores por runtime |

## Decisión

`voktty-workspace-edit` contiene el motor puro de reemplazo y el coordinador transaccional. El proceso Tauri y el helper SSH aportan adaptadores que solo resuelven rutas autorizadas, leen metadatos y realizan escrituras atómicas.

La operación se divide en dos fases explícitas:

1. Preview calcula todas las coincidencias, el contenido propuesto y una muestra acotada. Devuelve `mtime`, hash SHA-256 y número de reemplazos por archivo.
2. Commit recibe únicamente los archivos seleccionados, vuelve a calcular el plan y valida todos los valores esperados antes de escribir.

Los archivos se procesan en orden determinista. Antes de cada escritura se repiten las comprobaciones. Si una escritura posterior falla, los archivos ya aplicados se restauran en orden inverso. La restauración solo ocurre si el contenido actual coincide con el que escribió Voktty, evitando borrar una modificación externa posterior.

## Invariantes

- Ninguna ruta absoluta, travesía o enlace simbólico puede entrar en la transacción.
- La raíz local debe estar registrada como espacio autorizado.
- Una preview limitada por el buscador no puede confirmarse.
- Un archivo abierto con cambios sin guardar bloquea la operación.
- El reemplazo literal trata `$` como texto; el modo regex admite capturas como `$1`.
- Los patrones que pueden coincidir con texto vacío se rechazan.
- Una transacción admite como máximo 200 archivos, 32 MiB leídos y 10.000 reemplazos.

## Consecuencias

Positivas:

- semántica idéntica en local, WSL y SSH;
- conflictos detectados antes de sobrescribir;
- recuperación probada ante fallos parciales;
- React no recibe ni conserva el contenido completo de los archivos.

Negativas:

- el rollback restaura contenido, pero no el `mtime` anterior;
- una modificación externa durante la ventana mínima entre la última comprobación y el cambio atómico sigue dependiendo de las garantías del sistema de archivos;
- las transacciones grandes deben dividirse mediante filtros por sus límites deliberados.

Mitigaciones:

- hash y `mtime` se comprueban antes del lote y justo antes de cada escritura;
- cada archivo se sustituye mediante un temporal exclusivo y rename;
- las operaciones locales se serializan y el helper SSH procesa sus peticiones en serie;
- los fallos de rollback se devuelven como rutas explícitas para revisión manual.

## Condición para revisar

Revisar si se necesita seleccionar coincidencias individuales, editar archivos binarios o coordinar transacciones entre varias raíces o máquinas.
