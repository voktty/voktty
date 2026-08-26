# Buscar y reemplazar en el espacio de trabajo

Voktty permite buscar y reemplazar texto en proyectos locales, WSL y SSH desde el mismo panel.

## Buscar

1. Abre Search con `Ctrl+Shift+F` o desde la barra inferior del panel lateral.
2. Escribe el texto que quieres localizar.
3. Activa, si lo necesitas, mayúsculas y minúsculas, palabra completa o expresiones regulares.
4. Usa los filtros de inclusión y exclusión para acotar archivos, por ejemplo `src/**` o `**/*.test.ts`.
5. Selecciona un resultado para abrirlo como preview. Haz doble clic para fijar su pestaña.

La búsqueda respeta los archivos ignore del proyecto, omite binarios y enlaces simbólicos y limita resultados demasiado grandes. Si aparece `Limitado`, acota la consulta para obtener un conjunto completo.

## Reemplazar

1. Pulsa el icono de edición situado a la derecha del campo de búsqueda.
2. Escribe el texto de reemplazo.
3. Pulsa `Previsualizar`.
4. Revisa los cambios y desmarca los archivos que no quieras modificar.
5. Confirma el botón que indica el número exacto de reemplazos y archivos.

En modo literal, `$1` se escribe literalmente. En modo de expresión regular, `$1`, `$2` y los nombres de captura insertan los grupos correspondientes.

## Protecciones

- Los archivos coincidentes con cambios sin guardar deben guardarse antes de crear o confirmar la preview.
- Los resultados limitados no se pueden reemplazar.
- Voktty comprueba fecha, hash y número de coincidencias antes de escribir.
- Cada archivo se escribe atómicamente.
- Si falla un archivo posterior, Voktty intenta restaurar los anteriores.
- La restauración no pisa cambios externos hechos después de la escritura de Voktty.

Si un archivo cambia después de la preview, la operación informa de un conflicto y no lo sobrescribe. Ejecuta de nuevo la búsqueda y revisa una nueva preview.

## Límites deliberados

Una transacción admite hasta 200 archivos, 32 MiB de texto total y 10.000 reemplazos. Cada archivo puede ocupar hasta 5 MiB. Usa los filtros si el proyecto supera estos límites.
