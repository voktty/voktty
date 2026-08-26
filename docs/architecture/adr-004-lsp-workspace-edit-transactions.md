# ADR-004: Aplicar WorkspaceEdit LSP mediante una transacción estructural

## Estado

Aceptado

## Contexto

El renombrado de símbolos puede devolver cambios en varios documentos mediante `WorkspaceEdit`. La integración CodeMirror existente aplica esa respuesta directamente desde el webview, sin una vista previa común, autorización de rutas, comprobación de versiones ni recuperación ante fallos parciales.

Reutilizar el reemplazo global como búsqueda textual tampoco es correcto. Los rangos LSP son posiciones UTF-16 calculadas por el servidor y pueden contener cambios distintos para cada ubicación. Convertirlos en una expresión regular perdería precisión semántica y podría modificar coincidencias ajenas al símbolo.

## Opciones consideradas

| Opción | Ventajas | Costes |
| --- | --- | --- |
| Aplicar el `WorkspaceEdit` desde React | Menos infraestructura inicial | Sin transacción, rutas no autorizadas y rollback frágil |
| Traducir el renombrado a reemplazo textual | Reutiliza la API existente | Semántica incorrecta y cambios ajenos al símbolo |
| Extender el núcleo Rust con ediciones estructurales | Preview y commit idénticos en local, WSL y SSH | Añade normalización LSP y otro contrato acotado |

## Decisión

`voktty-workspace-edit` incorpora una transacción de ediciones estructurales independiente del reemplazo textual. Cada archivo recibe una lista de rangos de línea y columna UTF-16 junto con el texto nuevo. El núcleo convierte las posiciones a offsets UTF-8, rechaza posiciones inválidas o que dividan un par sustituto, detecta rangos solapados y aplica los cambios en orden inverso.

La operación mantiene dos fases:

1. Preview lee todos los archivos, valida y aplica las ediciones en memoria, y devuelve por archivo el `mtime`, hash SHA-256, número de ediciones y una muestra acotada del antes y después.
2. Commit recibe los archivos seleccionados con sus ediciones y valores esperados. Vuelve a construir el plan, comprueba también el hash del resultado revisado, valida el lote completo antes de escribir, revalida cada archivo inmediatamente antes del cambio y restaura en orden inverso ante un fallo posterior.

React normaliza `changes` y `documentChanges` de LSP, convierte URI `file:` en rutas relativas a la raíz y presenta la preview. Rust conserva la autoridad sobre rutas, archivos y commit. Las mismas estructuras serializadas se usan en Tauri y en `voktty-remote`.

## Invariantes

- Solo se aceptan archivos regulares UTF-8 dentro de la raíz autorizada, sin rutas absolutas, travesía ni enlaces simbólicos.
- Una transacción admite como máximo 200 archivos, 32 MiB leídos y 5.000 ediciones.
- Cada archivo admite como máximo 5 MiB y cada preview muestra una cantidad acotada de cambios.
- Los rangos deben ser válidos, no invertidos, no solapados y expresados en posiciones UTF-16 exactas.
- Un archivo abierto con cambios sin guardar bloquea el commit completo.
- El commit solo usa una preview vigente y vuelve a comprobar hash de origen, hash de resultado, `mtime` y número de ediciones.
- Las operaciones LSP de crear, renombrar o eliminar recursos se rechazan explícitamente hasta disponer de una transacción reversible específica.
- El cliente declara `workspace.applyEdit: false`; ningún servidor puede escribir sin pasar por la preview de Voktty.

## Consecuencias

Positivas:

- el renombrado conserva la precisión del servidor de lenguaje;
- preview, conflictos y rollback tienen la misma semántica en local, WSL y SSH;
- un `WorkspaceEdit` no puede escapar de la raíz activa;
- el webview no coordina escrituras parciales ni conserva el contenido completo de todos los archivos.

Negativas:

- un archivo sucio debe guardarse o descartarse antes del commit;
- este primer contrato no ejecuta comandos LSP ni operaciones de recursos;
- el servidor sigue siendo responsable de calcular rangos coherentes con los documentos sincronizados.

Mitigaciones:

- la preview hace visible cada cambio antes de confirmar;
- los archivos se vuelven a leer y validar en ambas fases;
- las respuestas se normalizan con límites antes de cruzar a la capa transaccional;
- las capacidades no soportadas se muestran como bloqueadas, nunca se aplican parcialmente.

## Condición para revisar

Revisar cuando Voktty implemente buffers multiarchivo transaccionales sin guardado, operaciones reversibles de recursos o selección por cambio individual.
