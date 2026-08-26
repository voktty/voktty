# AGENTS.md — Reglas Operativas para Agentes de IA

1. **Arquitectura y Reglas del Proyecto**: Lee `VOKTTY.md` antes de realizar cambios de código o diseño.
2. **Protocolo Operativo y Relevo**: Consulta y ejecuta el protocolo en `PROMPTS/iniciar.txt`.
3. **Directorio Operativo Exclusivo (`PROMPTS/`)**:
   - Todo documento de continuidad, bitácora, snapshot, plan de trabajo, contexto o prompt operativo debe residir obligatoriamente dentro del directorio `PROMPTS/` (según `PROMPTS/INDICE.md`).
   - No crear planes, bitácoras ni volcados de estado en la raíz del proyecto.
   - `PROMPTS/` se mantiene en español. Fuera de `PROMPTS/`, toda documentación rastreada y README se redacta en inglés, salvo archivos localizados con sufijo explícito, como `README.es.md`.
4. **Navegación de Código**: Utiliza `graphify` (`graphify query`, `graphify explain`, `graphify path`) para orientarte en el grafo de dependencias y `view_file` para lecturas directas.
5. **Verificación Innegociable**: Al concluir cualquier cambio, ejecuta `pnpm check-types` y `pnpm test`.
