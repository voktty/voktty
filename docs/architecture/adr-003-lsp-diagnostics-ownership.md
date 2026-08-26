# ADR-003: Conservar diagnósticos detallados en la sesión LSP

## Estado

Aceptado

## Contexto

CodeMirror recibe `textDocument/publishDiagnostics` para pintar errores en el documento abierto. Usar esas vistas como fuente del panel Problems perdería resultados al desmontar o cambiar una pestaña, duplicaría publicaciones cuando dos vistas muestran el mismo archivo y no capturaría diagnósticos de archivos que el servidor publica sin una vista activa.

Problems necesita agregar resultados del workspace sin iniciar servidores, escanear archivos ni cargar el cliente LSP de forma eager. También debe retirar resultados obsoletos de manera determinista cuando un servidor publica un lote vacío, termina o falla.

## Opciones consideradas

| Opción | Ventajas | Costes |
| --- | --- | --- |
| Agregar diagnósticos desde cada vista CodeMirror | Reutiliza el reporte visual existente | Estado ligado al montaje, duplicados y pérdida al cambiar de pestaña |
| Consultar todos los documentos al abrir Problems | Panel sin estado compartido | LSP no ofrece una consulta estándar equivalente; generaría trabajo y resultados incompletos |
| Capturar publicaciones en el cliente y asignarlas a la sesión | Fuente única, ciclo de vida definido y coste cero sin LSP | Requiere normalización y almacenamiento acotado |

## Decisión

`VokttyLspClient` intercepta cada notificación `textDocument/publishDiagnostics` antes de delegarla a la integración CodeMirror. Convierte la URI a una ruta local, valida los diagnósticos y normaliza sus rangos LSP de base cero a ubicaciones UTF-16 de base uno.

Cada lote se identifica por la clave de la sesión LSP y la ruta del documento. Una publicación sustituye el lote anterior del mismo documento; un lote vacío lo elimina. `sessionManager.ts` limpia todos los lotes de su propietario antes de cerrar una sesión y también cuando el proceso termina inesperadamente.

La UI agrega únicamente rutas contenidas en la raíz activa, deduplica diagnósticos equivalentes de varios servidores y ordena por gravedad, ruta y posición. La navegación usa el mismo abridor canónico de Quick Open, Search, Outline y saltos LSP.

## Invariantes

- El rail y el panel no inician un servidor ni escanean el workspace.
- Un propietario conserva como máximo 500 documentos.
- Un documento conserva como máximo 1.000 diagnósticos válidos.
- El panel renderiza como máximo 500 resultados filtrados y comunica el truncado.
- Los rangos negativos, invertidos o mal formados se descartan.
- La ruta debe pertenecer al workspace activo para hacerse visible.
- El estado detallado de Problems no sustituye el contador estrecho del archivo actual.

## Consecuencias

Positivas:

- los resultados sobreviven a cambios de pestaña y vistas desmontadas;
- no se duplican por el número de editores que muestran un archivo;
- cerrar o perder un servidor elimina su estado obsoleto;
- servidores distintos pueden contribuir al mismo workspace;
- el cliente y el panel pesados continúan detrás de importaciones dinámicas.

Negativas:

- el estado conserva mensajes y metadatos mientras viva la sesión;
- un servidor que publique miles de documentos puede provocar evicción de los lotes más antiguos;
- Problems depende de la calidad y frecuencia de publicación del servidor configurado.

Mitigaciones:

- límites por documento, propietario, mensaje, metadatos y renderizado;
- reemplazo completo por documento en vez de historial acumulativo;
- limpieza explícita en todos los finales de sesión conocidos;
- estados vacíos que explican que Problems depende de LSP.

## Condición para revisar

Revisar si Voktty añade diagnósticos propios de tareas, linters sin LSP o agentes. En ese caso deberán entrar mediante otro propietario con el mismo contrato acotado, no simulando una sesión LSP.
