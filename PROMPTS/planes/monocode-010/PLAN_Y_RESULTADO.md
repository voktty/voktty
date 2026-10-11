# Sincronizacion reproducible del harness con MonoCode 0.10

Fecha: 2026-10-11.
Estado: los 102 commits del rango tienen una decision registrada y la prueba aislada esta terminada. Codex, OpenCode 2.x de escritorio, OpenCode remoto por SSH nativo/tmux y exploracion remota de carpetas ya avanzaron por hitos. Quedan 7 ports parciales. Stage, unstage, discard, stage del buffer, contexto de commit, commit, push/pull/sync, ramas y stash para perfiles SSH directos estan implementados y commitados. Siguen pendientes historial Git para perfiles directos, catalogo y recuperacion de sesiones por tmux, recuperacion del tunel durante un turno y smoke con un host Docker real.

Checkpoint Git: `c0952ff` contiene los lotes 1 y 2, creado por peticion del usuario. Los hitos posteriores de producto y ledger se registran en commits separados. Sin push.

## Alcance autorizado

El usuario acepta el inventario 1:1, la priorizacion de correcciones y una prueba de integracion con upstream fijado antes de elegir la migracion estructural. No se interpreta como autorizacion de push, publicacion, instalacion de servicios SSH ni sustitucion completa del runtime.

Base historica registrada: `6bd432cada0f492f076cc93f7ccb3027f4ff7102`.
Destino local: `d68bfa8` (MonoCode 0.10.0).
Voktty examinado: `3386eb4` (1.0.16).

No se hizo fetch. El destino describe el checkout disponible, no garantiza ser el ultimo commit remoto. Graphify se actualiza en los hitos de codigo; su extractor mantiene dos errores previos en `host/child-backend.test.ts` y `src/modules/mcp/index.ts`.

## Artefactos y reproduccion

- `auditar.py`: lee los dos repositorios y genera el inventario sin alterar sus fuentes.
- `inventario.json`: SHA completos, 102 commits, sus archivos, 374 rutas modificadas y correspondencias candidatas.
- `inventario.md`: tabla legible de commits y archivos.
- `proof/`: parser de preguntas Codex del destino y sus tests upstream, con adaptacion de imports a los contratos existentes de Voktty y branding. La copia es experimental y no participa en el bundle.

```bash
python3 PROMPTS/planes/monocode-010/auditar.py ../monocode
pnpm exec vitest run --config PROMPTS/planes/monocode-010/proof/vitest.config.ts
```

No confundir candidato por nombre con equivalencia funcional. Tres archivos modificados son identicos byte a byte al destino, 149 distintos, uno ambiguo y 221 sin candidato. Estas cifras incluyen host, distribucion y nuevas superficies, y no son porcentajes de paridad. Las categorias por commit son triage para revision, no decisiones definitivas de integrar/excluir.

## Prueba real de actualizacion

Se hizo un merge de tres vias en archivos temporales: Voktty actual, upstream base y upstream destino.

| Archivo | Conflictos reales | Sin imports ni branding |
| --- | --- | --- |
| codexQuestions.ts | 0 | 0 |
| codex.ts | 12 | 10 |
| child.ts | 3 | 3 |

La segunda columna adaptada es una medicion textual, no una variante compilable. Muestra que el coste del controlador no viene solo de imports o nombres. Se ejecuto tambien el parser del destino con el modelo compartido de preguntas y el protocolo de Voktty: 20 tests upstream pasan. Esto prueba compatibilidad del parser, no el lifecycle asincrono completo, turn/steer ni la UI de preguntas.

No se traslado el parser a produccion porque sin el wiring del controlador no resuelve la funcionalidad. El futuro port debe incluir los cinco archivos del commit `98da85a` y preservar cancelacion, cola de preguntas y aprobaciones.

## Hallazgos funcionales verificados

1. **Preguntas asincronas Codex (`98da85a`).** Voktty tiene preguntas via solicitudes del servidor, pero no exporta codexAsyncQuestions/codexAsyncQuestionResponse. Upstream añade preguntas sobre agentMessage con delivery async. El parser es reutilizable; el controlador requiere adaptacion.
2. **Codex sin modelo (`c2b479d`).** buildTurnStartParams en codexProtocol.ts de Voktty siempre emite collaborationMode, incluso con model null. Revisar y portar el comportamiento y prueba upstream para evitar una configuracion no admitida.
3. **Resolucion del ejecutable Codex (`db006a4`).** resolve_codex de Voktty pone los candidatos fijos antes del login shell. El fix upstream mueve el shell delante. Mantener la resolucion particular de Windows y verificar prioridades con un core puro; no reemplazar host.rs completo.
4. **OpenCode 2.x (`0eb2773`).** El destino añade opencodeService.ts y opencodeV2Events.ts, sus tests y soporte nativo/host. No se encontraron esos modulos ni comandos de servicio en Voktty. Port transversal, con tests de admision, eventos y compaction; no basta con actualizar el catalogo.
5. **Sesiones remotas (`b93b95a`).** remoteSessionTabs.ts no existe en Voktty. El commit valida proyecto y shell antes de reutilizar la asociacion remota. Revisar el flujo equivalente en HarnessApp y projectReturn; no asumir que la falta del archivo implica exactamente el mismo bug.
6. **Host remoto.** Voktty conserva cliente y bootstrap, pero no hay directorio host ni job de empaquetado correspondiente. remote_ssh.rs construye la URL con sergewinters/voktty y CARGO_PKG_VERSION; remote_bootstrap.sh espera terax-host o monocode-host. release.yml construye voktty-remote, un servicio distinto. No se verificaron los assets publicados ni una conexion real: la distribucion es un hueco local demostrado, el fallo en release no se declara probado.
7. **Mono y Artifacts.** No hay candidatos por nombre para 73 archivos frontend de monos y seis de artifacts; faltan tambien los modulos Rust mono/artifacts/codex_mono_store. Introducen memoria, habitos, ventanas y persistencia nuevas. Revisar convivencia con Cortex, automations, quick composer y planes propios antes de decidir su integracion.

## Decision tecnica

Mantener por ahora el harness existente. Actualizar funcionalmente en lotes trazables y reducir gradualmente los parches sobre modulos reutilizables. La evidencia no justifica reemplazar toda la aplicacion por el entrypoint upstream.

Separar cuatro fronteras estables:

- Montaje: pestañas, espacios, foco, cwd y cierre en Voktty.
- Presentacion: temas, traducciones, accesibilidad y notificaciones.
- Plataforma: IPC, procesos, filesystem, secretos, lifecycle y persistencia en Rust.
- Upstream: protocolos de proveedores, parsers, estado de sesiones y componentes cuando sean compatibles con las tres fronteras anteriores.

MonoCode no ofrece hoy un paquete desktop embebible completo: su lib.rs construye su propio Builder Tauri, registra plugins/estados y gobierna ventanas. ChildBackend es una frontera existente para el host de Node, pero por si sola no abstrae toda la aplicacion. Compilar su frontend dentro de Voktty necesita tambien el backend, migraciones y empaquetado compatibles.

La siguiente prueba estructural debe conservar el arbol de upstream fijado, aplicar un manifiesto de imports/adaptadores y ejecutar dos actualizaciones reales. Solo adoptar subtree/submodule cuando esa prueba demuestre que los patches son pequenos y estables; el formato de almacenamiento no elimina conflictos por si mismo.

Decision de conexion remota (2026-10-10): cuando el barrido llegue a la gestion de ordenadores remotos del Harness, se unificara con el agente SSH nativo de Voktty y tmux para recuperar sesiones. No se adoptara el transporte Node `voktty-host` de MonoCode para esa superficie; el flujo local debe conservar compatibilidad con hosts Docker. La integracion debe partir de los contratos y lifecycle existentes en `src-tauri/src/modules/remote.rs` y los modulos nativos relacionados.

## Lotes de ejecucion y puertas

1. Codex: preguntas asincronas, collaborationMode opcional y prioridad de ejecutable. Tests de protocolo y lifecycle, tipos, suite completa; Rust para el resolver.
2. OpenCode 2.x: protocolo/client/catalog/eventos y comandos nativos, despues host. Mantener compatibilidad v1 y pruebas de respuestas fuera de orden/cancelacion.
3. Conexiones y distribucion: correspondencia desktop-host, runtime Node fijado, paquetes por plataforma, checksums y version propia. Probar autenticacion, reintento idempotente, cierre sin matar sesiones y smokes SSH aislados. No apuntar a latest ni instalar servicios reales durante tests.
4. Transcript/composer/editor: revisar diffs de scroll, IME, Markdown, arrastres y render contra los equivalentes de Voktty; trasladar las pruebas de browser cuando protejan un fallo real.
5. Producto nuevo: decidir Mono/Artifacts, carpetas y plataformas, preservando la decision previa de no portar carpetas de sesion salvo revision explicita del alcance. Documentar excluidos con motivo.
6. Extraccion incremental: mapear imports y comandos, conservar atribucion MIT, fijar upstream y registrar cada patch local con razon y tests. El objetivo es reducir cambios editados a mano en cada actualizacion.

Una fila se marca integrada solo al inspeccionar el comportamiento y pasar sus pruebas. Ninguno de los 102 commits se considera automaticamente sincronizado por este inventario. No avanzar el SHA de sincronizacion historico hasta cerrar todas las filas o documentar las exclusiones aceptadas.

## Verificacion de esta fase

- Inventario reproducido: 102 commits y 374 archivos.
- Merge aislado: resultados registrados arriba.
- Parser experimental: una suite, 20 tests, correcto.
- pnpm check-types: correcto.
- pnpm test: siete contratos Cortex y portable paths correctos; 603 suites Vitest correctas, una fallida; 4382 tests correctos y uno fallido en ssh-native/handles.test.ts, ensureNativeHandle, backs off failed attempts then retries. Esperaba una llamada a connect y recibio dos. Ningun archivo productivo fue modificado por esta fase.
- Repeticion focalizada: pnpm exec vitest run src/modules/ssh-native/handles.test.ts reproduce el mismo fallo, con 17 tests correctos y uno fallido. No se atribuye a los artefactos experimentales, que no son importados por esa suite.
- Rust, build de host y smokes Tauri/SSH no ejecutados; no hay cambios productivos que validar con ellos en esta fase.
- git diff --check correcto y arbol tracked limpio. Sin commit ni push.

PROMPTS esta ignorado por Git. Estos artefactos quedan disponibles en este workspace, pero no viajan con un clon. Cuando se implemente el mecanismo permanente, su manifiesto y herramienta deben quedar rastreados fuera de PROMPTS; la continuidad operativa sigue aqui.

## Lote 1: Codex implementado

Se portaron las correcciones de `98da85a`, `c2b479d` y `db006a4`, adaptadas al controlador de Voktty:

- Preguntas `agentMessage` con `delivery: async`, normalizadas mediante el modelo existente. Rechazo explicito de preguntas secretas, conservando la proteccion local.
- Respuesta mediante `turn/steer`, sin cerrar la pregunta antes del acuse. Evita envios duplicados, permite reintentar un error y conserva la cola compartida con preguntas del servidor. Deduplicacion por item y cancelacion al finalizar, cancelar o detener el turno; ignora preguntas de turnos anteriores.
- `collaborationMode` se omite sin un modelo no vacio. El modelo se normaliza y los turnos de plan conservan `readOnly` y `approvalPolicy: never`.
- El ejecutable Codex encontrado por el login shell precede a los candidatos de instalacion. Se mantienen los fallbacks y las ramas Windows existentes.

Se inspecciono el wiring de la UI existente: los adapters responden mediante estas funciones y la pregunta se retira al recibir `question.resolved`. No se sustituyeron componentes ni se anadio una copia paralela de la interfaz upstream.

Verificacion:

- Seis suites focalizadas de parser, protocolo y lifecycle: 97 tests correctos.
- `pnpm check-types`: correcto.
- `pnpm test`: contratos Cortex y portable paths correctos; 606 suites y 4407 tests correctos, un fallo previo en `ssh-native/handles.test.ts` (backoff, espera una llamada y recibe dos), ya reproducido antes del port.
- `pnpm lint`: bloqueado por el texto previo de `ssh-native/handles.ts:70` detectado por i18n. Biome lint de los tres archivos productivos TypeScript modificados: correcto. Los tests nuevos siguen el patron de fixtures upstream con assertions no nulas, que Biome marca como warnings.
- `cargo clippy --all-targets --locked -- -D warnings`: correcto en Linux.
- `rustfmt --edition 2021 --check src/modules/harness/host.rs`: correcto. `cargo fmt --all -- --check` encuentra formato previo fuera del lote en remote, ssh_native y tunnel; no se reformatean esos archivos.
- `cargo nextest run --locked`: 1249 tests correctos, uno omitido; Nextest marca un test como leaky. Incluye la regresion nueva de prioridad y fallback del ejecutable Codex.
- `graphify update .`: correcto, grafo generado con 23438 nodos y 70204 aristas. El extractor avisa de un error de sintaxis en el archivo previo `src/modules/mcp/index.ts`; ese nodo puede estar incompleto.
- `git diff --check`: correcto; siete archivos del lote, sin cambios de dependencias ni lockfiles.

Limites: no smoke de Codex real ni validacion de ejecucion Windows/macOS. No hay commit ni push. No se avanza el SHA global de sincronizacion: OpenCode 2.x, distribucion remota y demas filas siguen pendientes. Siguiente paso seguro: lote OpenCode 2.x con revision del contrato v1/v2 y sus comandos nativos.

## Lote 2: OpenCode 2.x desktop

Port funcional del lado frontend y Rust de `0eb2773`, contrastado con el destino local `d68bfa8`. Los cambios del directorio upstream `host/` quedan para el lote 3, porque Voktty no tiene ese host distribuido. No se declara el commit entero sincronizado.

Implementacion:

- Seleccion por version: v1 desde 1.14.19, v2 desde 2.0.15, otros majors rechazados. v1 conserva el servidor `serve` propio.
- v2 descubre o inicia el servicio CLI compartido, obtiene su password en memoria y usa Basic auth en HTTP/SSE `/api`. Catalogo global sin contexto de carpeta, IDs de modelos seleccionables (incluidos aliases), variantes y agentes; la ausencia del endpoint opcional de agentes no pierde el catalogo.
- Sesiones, modelos, agentes, prompt, steering, interrupt, revert, permisos y formularios adaptados al contrato existente. Multiselect siempre como lista y campos numericos vacios sin forzar cero.
- Traductor de eventos durables a transcript, razonamiento, herramientas y uso de contexto. Correlacion de la admision y finalizacion por inbox ID, incluyendo eventos adelantados, cancelacion tardia, compaction con o sin ID y errores. v1 mantiene su finalizacion por `session.status`.
- Sesiones retomadas de otra carpeta se bifurcan y se confirma el traslado del fork; no se mueve la sesion original. Fork fallido se limpia; sesion vacia empieza nueva.
- Generacion de texto v2 por `generate`, con borrado de la sesion temporal al terminar o fallar. El servicio compartido queda en manos de OpenCode.
- El selector nativo de modelos en Settings fuerza el refresco al recibir foco o interaccion del puntero, equivalente a la apertura explicita upstream. No se cambian las traducciones existentes.

Adaptaciones de seguridad y lifecycle de Voktty:

- `harness_exec` amplia el contrato con `binaryProvider` opcional. Los tres comandos exactos `service status/start/get password` requieren provider opencode, coincidencia con su ruta resuelta y cwd local existente autorizado por el registro de workspaces. Sin nuevas dependencias ni registro de comandos.
- El arranque del daemon no hereda la marca de orfandad de Voktty; conserva el aislamiento del proceso corto y su timeout. Cerrar una sesion no detiene el servicio compartido.
- El servicio v2 no puede aplicar el proxy de red por sesion: se rechaza un allowlist configurado, incluso si ya hay una sesion live. v1 conserva su allowlist al spawn. No se desactiva la proteccion silenciosamente.
- URL loopback parseada en Rust, sin credenciales en URL y sin redirecciones HTTP/SSE. Regresion con servidor local que intenta redirigir una peticion autenticada.
- Cierre limpio o fallido del stream v2 rechaza la espera, invalida la sesion live y permite reconectar. Eventos de su callback antiguo no completan el turno nuevo.
- Se mantiene la atribucion MIT existente en NOTICE. El contrato permanente se documenta en `docs/architecture/two-process-model.md` (ingles).

Verificacion final:

- Suites focalizadas: 70 tests correctos en siete archivos (bridge child y seis suites nuevas).
- `pnpm check-types` y `pnpm build`: correctos.
- `pnpm test`: siete contratos Cortex y portable paths correctos; 612 suites y 4470 tests correctos, un fallo previo de backoff en `ssh-native/handles.test.ts:115` (espera una llamada y recibe dos).
- `pnpm lint`: bloqueo previo de i18n en `ssh-native/handles.ts:70`. Biome lint de nueve archivos productivos del lote: sin errores, siete warnings en codigo previo. No se modifican los archivos SSH ajenos al lote.
- `node scripts/check-i18n-keys.mjs`: las 3682 claves estaticas resuelven en ingles.
- `cargo clippy --all-targets --locked -- -D warnings`: correcto.
- `cargo nextest run --locked --status-level fail --final-status-level fail`: 1254 tests correctos, uno omitido.
- `rustfmt --edition 2021 --check src/modules/harness/host.rs`: correcto.
- `graphify update .`: correcto, 23525 nodos y 70479 aristas; mantiene el aviso del extractor sobre `src/modules/mcp/index.ts`.
- `git diff --check`: correcto. Sin cambios de dependencias ni lockfiles.

Limites: no arranque de un servicio OpenCode real, no validacion de ejecucion Windows/macOS/Android y no smoke SSH. No se instalan servicios ni se publica nada. Arbol conserva los cambios del lote Codex anterior; sin commit ni push. Siguiente paso: distribucion y protocolo del host remoto, antes de afirmar paridad OpenCode sobre SSH.

## Lote 3a: frontera de procesos del host

Implementado el adaptador Node necesario para reutilizar los controladores de Voktty. Todavia no es un servidor remoto distribuible.

- `ChildBackend` configurable una sola vez antes del bridge, con Tauri como backend desktop por defecto. Dos regresiones protegen la seleccion y evitan cambiar backend con listeners activos.
- `host/child-backend.ts`, `process.ts` y `provider-guard.mjs` portados desde `d68bfa8`, con registro de fuentes SHA-256 y adaptaciones en `host/upstream.json`, rastreado. Se preserva licencia MIT en `host/LICENSE`.
- Provider propio Gemini conservado en lugar de Antigravity. Resolucion de launchers ambiguos sin ejecutarlos y wrappers npm Windows conocidos sin interpretar shells arbitrarios.
- Registro explicito de roots canonicos, rechazo de cwd fuera de ellos y de escapes por symlink. Spawn usa solo ejecutables resueltos. Cancelacion de un spawn pendiente impide crear el proceso tarde.
- Allowlist de red rechazado cuando el host no puede aplicarlo, tanto en v1 como en v2. Comandos de servicio exactos y exclusivos de OpenCode, con provider explicito. Catalogos existentes sin `binaryProvider` aceptados solo sobre una ruta ya resuelta.
- HTTP/SSE loopback sin credenciales en URL ni redirects. HTTP limitado a 16 MiB y timeout acotado; frames SSE limitados. El callback de un stream sustituido no emite fin ni datos sobre su sucesor.
- Watchdog por pipe protege el arbol de procesos, incluso tras perdida inesperada del host y descendientes que ignoran SIGTERM. Servicio OpenCode compartido fuera de ese ownership.
- No se porta el lector generico de archivos de upstream: la futura lectura de transcripts requiere contrato de ownership y protecciones de secretos. No se abre ningun endpoint remoto.
- `pnpm check-types` incluye `check-types:host`; `pnpm test` ejecuta `test:host` antes de la suite frontend; Biome incluye las fuentes del nuevo directorio. Sin dependencias nuevas ni lockfile modificado.

Verificacion:

- `pnpm check-types`: correcto, incluidos desktop y host.
- `pnpm test`: siete contratos Cortex y portable paths correctos; tres suites host con 16 tests correctos; frontend con 612 suites y 4472 tests correctos y el mismo fallo previo de backoff SSH.
- Bridge focalizado: nueve tests correctos. La fixture OpenCode 2.x usa el controlador real, un CLI de prueba y HTTP/SSE autenticados locales; cerrar la sesion conserva el servicio de prueba.
- `pnpm lint`: conserva el bloqueo previo por texto SSH sin traducir. Lint focalizado de host y bridge: nueve archivos, sin errores, ocho warnings heredados de patrones upstream/locales.
- `graphify update .`: correcto, 23597 nodos y 70665 aristas. El extractor omite simbolos de `host/child-backend.test.ts` por una construccion TypeScript valida no soportada y mantiene el aviso previo sobre `src/modules/mcp/index.ts`; TypeScript y Vitest pasan para la fixture del host.
- `git diff --check`: correcto. No hay cambios Rust en este sublote, por lo que no se repiten Clippy/Nextest ya verificados en el checkpoint.

Limites y siguiente paso seguro: incorporar HostStore, HostEngine, servidor autenticado y CLI con contratos compatibles con `src/modules/connections/model/protocol.ts`; autorizar workspaces desde el alta explicita de proyectos. Despues empaquetar runtime Node fijado, checksums, bootstrap con identidad Voktty y job de release. Falta validar Windows/macOS y SSH real; no se instalan servicios ni se modifica estado remoto. No declarar el lote 3 cerrado ni avanzar el SHA global de sincronizacion.

## Correccion de bloqueos SSH autorizada por el usuario

El usuario pide corregir los fallos encontrados, incluidos los previos. Se corrigen los bloqueos de tests y lint antes de continuar el host remoto.

- Causa del fallo de backoff: `openHandle` repetia `sshNativeConnect` con las mismas credenciales tras `auth_failed`, antes de solicitar una credencial nueva. Ahora solo reintenta cuando hay una clave de servidor aprobada, una frase de contraseña o una contraseña introducida. No se cambia el test de backoff para aceptar llamadas duplicadas.
- Se conserva el error de autenticacion y la aprobacion exacta de clave al pasar a contraseña. Claves revocadas, rechazadas o presentadas para un puerto distinto no se aprueban.
- Cinco textos de verificacion y autenticacion pasan a i18n, con entradas inglesas y espanolas; otros idiomas usan el fallback establecido. Se tipa explicitamente la sesion SSH, eliminando el error de Biome que aparecia al superar el chequeo i18n.
- Cinco regresiones nuevas: puerto distinto, rechazo de clave, passphrase, aprobacion seguida de contraseña y aviso de clave cambiada en español. Se ajusta la prueba de contraseña al flujo correcto de dos conexiones.

Verificacion:

- SSH focalizado: 43 tests correctos en handles y adapt.
- `pnpm check-types`: correcto en desktop y host.
- `pnpm test`: siete contratos Cortex y portable paths correctos; 16 tests host y 4478 tests frontend correctos, 613 suites frontend correctas. Sin fallos.
- `pnpm lint`: correcto, sin errores. 3687 claves estaticas resuelven y no hay textos UI hardcoded detectados. Biome conserva warnings preexistentes; no se hace una limpieza masiva de estilo o accesibilidad.
- `graphify update .`: correcto, 23597 nodos y 70670 aristas; conserva las limitaciones del extractor registradas en el sublote 3a.
- `git diff --check`: correcto. No hay cambios Rust en esta correccion. Sin commit nuevo ni push; se preserva el adaptador Node pendiente.

Los bloqueos previos de SSH quedan resueltos. Continua pendiente el servidor autenticado, la persistencia y la distribucion del lote 3.

## Checkpoint de commits y lote 3b: persistencia y sincronizacion

Peticion del usuario: hacer commit, explicar cuanto de cuanto y continuar los merges. Se crean commits separados por responsabilidad:

- `1be7c30`: adaptador de procesos headless, ownership, transportes y verificaciones del lote 3a.
- `ccbf15d`: correccion de reintentos SSH y traduccion de prompts nativos.
- `c7e4cb2`: HostStore SQLite y SyncTransfers del lote 3b.

Estado cuantificado: 102/102 commits catalogados y 374 rutas inventariadas; 3/102 commits upstream cerrados y OpenCode 2.x parcial. Plan: 2/6 lotes implementados, lote 3 en progreso, lotes 4-6 pendientes. Esta proporcion no representa porcentaje de esfuerzo ni de paridad. No se avanza el SHA global de sincronizacion.

Sublote 3b:

- Port de `host/store.ts`, `host/sync-transfer.ts` y pruebas de transferencias desde `d68bfa8`. Fuente y parches registrados en `host/upstream.json`.
- Persistencia de identidad, proyectos, sesiones, eventos, recibos y hashes de credenciales. No se incorpora todavia un endpoint ni se conecta a la persistencia desktop.
- Fallo encontrado y corregido: un `save` fuera de una transaccion podia guardar el snapshot y fallar al insertar el evento. Ahora ambos se guardan juntos; rollback invalida cache. Se mantiene la transaccion externa del futuro motor para atomizar tambien recibos.
- Deltas compatibles con el cliente actual, incluyendo bloques modificados, anadidos y eliminados. Transferencias grandes acotadas por fragmento, TTL y ocho transferencias retenidas; limites invalidos y offsets dentro de pares Unicode rechazados.
- Siete pruebas de store y cinco de transferencias. Sin nuevas dependencias ni cambios Rust o lockfile.

Verificacion final:

- `pnpm check-types`: correcto, desktop y host.
- `pnpm test`: siete contratos Cortex y portable paths correctos; 28 tests host en cinco suites y 4478 tests frontend en 613 suites correctos.
- `pnpm lint`: correcto, cero errores, 1593 warnings y 17 infos; sin limpieza ajena de estilo.
- `pnpm exec biome format host/store.ts host/store.test.ts host/sync-transfer.ts host/sync-transfer.test.ts`: correcto.
- `graphify update .`: correcto, 23641 nodos, 70790 aristas, 584 comunidades; conserva los dos avisos previos del extractor TypeScript.
- `git diff --check` y diff staged: correctos; arbol limpio tras commits. No push.

Limites: validado con Node 22.23.3 en Linux, donde SQLite emite aviso experimental. Pendientes motor de sesiones, adjuntos, servidor autenticado, autorizacion desde alta explicita de proyectos, permisos privados de datos, CLI, runtime fijado y empaquetado. No validacion Windows/macOS ni smoke SSH real. Siguiente paso seguro: portar HostEngine con pruebas de idempotencia, recuperacion tras reinicio, aprobaciones obsoletas y cierre del proveedor antes de liberar el siguiente turno; conectar autorizacion explicita al adaptador sin exponer lectura generica de archivos.

## Goal lote 3, hito 1: adjuntos del host

Port de `host/attachments.ts` desde `d68bfa8`, con hash de fuente en `host/upstream.json`. Mantiene IDs UUID, 20 adjuntos por comando, 20 MiB por adjunto, fragmentos de 512 KiB, offsets secuenciales e idempotencia de fragmentos repetidos. El lector de imagenes solo acepta IDs presentes en una sesion guardada.

Correccion de seguridad upstream: verificar directorio de adjuntos y desestimar enlaces simbolicos, archivos no regulares y enlaces duros. Leer y escribir sobre un descriptor verificado y contrastar su tamano con `fstat`, no seguir una ruta una segunda vez durante la lectura. Se anade `readAttachmentBytes` para que el futuro motor embeba imagenes sin `readFileSync(path)`.

Pruebas: reintento identico, orden de fragmentos y ruta invalida; enlaces simbolicos en archivo y directorio, enlace duro a fichero externo. Las tres pruebas de enlaces se omiten en Windows, donde su creacion requiere permisos que la CI puede no tener; la guarda de runtime sigue activa mediante `lstat`. Validado en Linux con Node 22.23.3.

Verificacion: `pnpm check-types` correcto; `pnpm test` correcto, 32 tests host en seis suites, 4478 tests frontend en 613 suites, siete contratos Cortex y rutas portables; `pnpm lint` correcto sin errores, 1595 warnings y 17 infos; Biome format de dos archivos correcto; `graphify update .` correcto, 23653 nodos y 70832 aristas, mismos avisos previos del extractor; `git diff --check` correcto. Sin cambios Rust, lockfile ni dependencias. Siguiente hito: motor de sesiones y providers con pruebas de idempotencia, reinicio, cancelacion y autorizacion.

## Goal lote 3, hito 2: motor de sesiones y providers

Port del motor, mapa de diez providers y operaciones de worktrees desde `d68bfa8`, con hashes de fuente en `host/upstream.json`. El mapa usa los providers de Voktty, incluido Gemini/Antigravity bajo el ID `gemini`; su importacion real en Node tiene una prueba. El nombre de rama se extrae a una funcion pura compartida para evitar que el host importe Tauri desde el modulo de UI.

El motor valida comandos, guarda recibos antes del efecto externo, conserva la identidad del provider al reanudar, interrumpe turnos persistidos como running tras un reinicio sin repetir su ejecucion, descarta respuestas a requests obsoletos y espera el cierre del provider antes de liberar el turno. El alta de proyecto canoniza y llama al autorizador configurado antes de persistir; los cambios de rama exigen proyecto registrado. Worktrees admitidos por la sesion deben estar registrados en Git.

Correcciones locales del port: lectura de imagenes por descriptor verificado; duracion del turno recuperado calculada con el timestamp persistido y no con el reloj del reinicio; maximo de claves y longitud de nombre en respuestas custom; mensajes de log sin errores crudos que puedan contener paths o contenido privado. Cobertura añadida para autorizacion de proyectos, accion sobre proyecto desconocido y respuestas custom grandes.

Verificacion: `pnpm check-types` correcto; `pnpm test` correcto con 65 pruebas host en nueve suites y 4478 frontend en 613 suites, mas siete contratos Cortex y rutas portables; `pnpm lint` correcto, cero errores, 1600 warnings y 17 infos; `pnpm build` correcto; Biome format de los siete archivos afectados correcto; `graphify update .` correcto, 23706 nodos y 71123 aristas, mismos avisos previos del extractor; `git diff --check` correcto. Sin cambios Rust ni dependencias. Sigue pendiente conectar el motor al servidor autenticado y CLI; el store del host aun no participa del desktop.

## Goal lote 3, hito 3: operaciones de workspace del host

Port de navegacion de proyectos, ramas Git y comandos de workspace desde el commit fijado de MonoCode. Los hashes de los siete archivos upstream se registran en `host/upstream.json`; `workspace-commands.test.ts` es una prueba propia de Voktty. El indice Git conserva los campos adicionales `head` y `headPushed` sin cambiar el contrato tipado de la UI. Los comandos mantienen las rutas dentro de proyectos y worktrees registrados y bloquean `.git` y escapes mediante enlaces simbolicos.

El guardado del editor acepta `expectedContent`, verifica el contenido antes y justo antes de sustituir el archivo, escribe un temporal sincronizado y preserva los permisos. Las pruebas cubren conflicto, creacion, permisos y enlace simbolico fuera del proyecto. El helper `writeHostFile` aplica el mismo patron a su contrato de solo archivos existentes.

Verificacion: `pnpm check-types` correcto; `pnpm test` correcto con 80 pruebas host en 13 suites y 4478 frontend en 613 suites, mas siete contratos Cortex y rutas portables; `pnpm lint` correcto sin errores y con avisos; Biome format de ocho archivos correcto; `graphify update .` correcto, 23803 nodos y 71476 aristas, mismos dos avisos previos del extractor; `git diff --check` correcto. No hay cambios Rust ni dependencias. Siguiente hito: servidor HTTP autenticado y autorizacion de worktrees; no hay servicio expuesto ni CLI todavia.

## Goal lote 3, hito 4: servidor autenticado

Port de `host/server.ts` y su suite de integracion HTTP desde `d68bfa8`; hashes en `host/upstream.json`. El endpoint RPC exige Bearer de dispositivo, comprueba revocacion antes y despues de leer el cuerpo, rechaza Origin y limita el cuerpo a 16 MiB. Expone sesiones, eventos, adjuntos, proyectos, modelos, Git y workspace a traves de sus adaptadores ya portados. La suite comprueba reanudacion desde otro dispositivo, revocacion, rutas fuera del workspace, worktrees y guardado.

Para adaptar los catalogos de Voktty, las funciones de descubrimiento existentes aceptan un cwd explicito opcional. El desktop conserva homeDir como valor por defecto; el host exige proyecto registrado y pasa su cwd. Los sondeos del mismo proveedor se serializan entre proyectos para proteger los IDs de proceso compartidos. Al crear o elegir un worktree, el servidor autoriza su cwd en el backend de procesos antes de entregar la sesion. Pruebas propias cubren proyecto desconocido, cwd de catalogo, sondeos simultaneos y autorizacion de nuevo worktree.

Verificacion: `pnpm check-types` correcto; `pnpm test` correcto con 97 pruebas host en 14 suites y 4478 frontend en 613 suites, mas siete contratos Cortex y rutas portables; `pnpm lint` correcto sin errores y con avisos; `pnpm build` correcto; Biome format de los 12 archivos afectados correcto; `graphify update .` correcto, 23819 nodos y 71631 aristas, mismos dos avisos previos del extractor; `git diff --check` correcto. Sin cambios Rust ni dependencias. Pendiente la CLI que limita la escucha a loopback y gestiona el ciclo de vida.

## Goal lote 3, hito 5: CLI y servicio local

Port de CLI, lock de dueno, definiciones de servicios por usuario y ACL Windows desde el upstream fijado. Se cambian nombres y rutas a Voktty; los hashes de las fuentes quedan en `host/upstream.json`. `serve` adquiere el lock antes de abrir/migrar SQLite, rechaza directorio de datos enlazado, restaura autorizacion de proyectos y worktrees registrados, y vincula al motor el autorizador de procesos. Escucha exclusivamente en 127.0.0.1. Credenciales de dispositivo se emiten una vez y el secreto administrativo de ciclo de vida no se expone a la UI.

El build de host usa la capacidad SSR de Vite ya presente en el repositorio y genera un unico modulo ESM y el guard del proveedor, sin nueva dependencia. `pnpm test:host` compila primero este modulo para probar la CLI real con directorio temporal y sin instalar servicios. Se comprueban arranque independiente, bloqueo de segundo dueno, credencial y revocacion, parada, configuraciones de servicio escapadas, rechazo de directorio enlazado y funciones de Windows; dos pruebas de Windows se omiten en Linux.

Verificacion: `pnpm check-types` correcto; `pnpm test` correcto con 107 pruebas host en 18 suites, dos omisiones de plataforma y 4478 frontend en 613 suites, mas siete contratos Cortex y rutas portables; `pnpm lint` correcto sin errores y 1613 avisos; Biome format de nueve archivos correcto; `graphify update .` correcto, 23868 nodos y 71804 aristas, mismos dos avisos previos del extractor; `git diff --check` correcto. Se ignora `/build/` para excluir el artefacto generado. Sin cambios Rust ni dependencias. Todavia falta empaquetar un runtime fijado, validar sus checksums y conectar el bootstrap desktop al nuevo host.

## Goal lote 3, hito 6: distribucion y bootstrap SSH

`host/package.mjs` toma Node 24.21.0 con los seis SHA-256 fijados por upstream, valida cada descarga, empaqueta la CLI de Voktty y genera un checksum por archivo. Normaliza timestamps y metadatos del tar/zip para que la misma entrada produzca el mismo SHA-256. Se generaron los seis targets en Linux, todos pasaron `sha256sum -c`; el paquete Linux x64 ejecuto `--version`, `pair`, `devices` y `revoke` con su Node incluido. Dos ejecuciones sucesivas de Linux x64 y Windows x64 dieron hashes identicos. No se subio ni instalo nada remoto.

El workflow de release construye y publica los seis archivos y sus checksums antes de sacar la release de draft; valida que tag, package.json y Cargo.toml tengan la misma version. El bootstrap Unix y Windows descarga solo nombres `voktty-host`, verifica SHA y version antes de publicar el runtime, usa `~/.voktty-host` y no borra directorios previos de Terax/MonoCode. Pairing y upgrade de Rust usan esas rutas. El contrato queda descrito en `VOKTTY.md`.

Una prueba aislada del bootstrap Unix sustituye la descarga por un archivo temporal y CLI ficticia: verifica instalacion, reutilizacion sin red y rechazo de checksum alterado sin registrar un servicio real. `sh -n` correcto. No hay PowerShell en esta maquina: el bootstrap Windows queda validado por inspeccion y sus pruebas de parser/ACL pendientes en Windows. Tampoco hay smoke SSH contra un servidor real. Rust: `cargo clippy --all-targets --locked -- -D warnings` correcto; `cargo nextest run --locked` 1255 pruebas correctas y una omitida. `pnpm check-types` correcto; `pnpm test` correcto con 108 pruebas host y dos omisiones de plataforma en 19 suites, 4478 frontend en 613 suites, siete contratos Cortex y rutas portables; `pnpm lint` correcto sin errores, 1613 avisos y 17 infos; Biome format y `git diff --check` correctos; `graphify update .` correcto, 23881 nodos y 71828 aristas. La release aun no se ha ejecutado ni publicado. Sigue una auditoria final de las pruebas host upstream omitidas y de la cobertura Windows/macOS.

## Goal lote 3, hito 7: barrido final de pruebas del host

Se portan las pruebas restantes del host upstream fijado: sincronizacion de bloques mayores de 16 MiB, transporte OpenCode v1, transportes de providers con procesos reales simulados y bootstrap PowerShell. Sus hashes de fuente quedan en `host/upstream.json`. La fixture de OpenCode es ejecutable y las pruebas registran explicitamente el workspace antes de lanzar procesos. Gemini se comprueba con su protocolo `stream-json` actual, mientras Cursor, Grok, Fx y Hermes usan ACP. Se amplia la prueba Unix de bootstrap con actualizacion forzada y reciclado del servicio ficticio.

La concurrencia de ocho sondeos de modelos encontro una colision real: Codex, Claude, Pi y Omp usaban un ID fijo y un sondeo podia cancelar otro. Cada invocacion usa ahora un ID aleatorio propio. El servidor conserva su serializacion por proveedor. Las pruebas cubren resultados iguales en paralelo, turnos completos y reanudacion, asi como effort aplicado entre turnos.

Verificacion: `pnpm check-types` correcto; `pnpm test` correcto con 123 tests host en 22 suites, cinco omisiones de plataforma y 4478 tests frontend en 613 suites, mas siete contratos Cortex y rutas portables; `pnpm lint` correcto, cero errores, 1615 warnings y 17 infos; `pnpm build` correcto; Biome format de los ocho archivos TS afectados correcto; `graphify update .` correcto, 23893 nodos y 71923 aristas, con los dos avisos de extractor ya conocidos; `git diff --check` correcto. Windows PowerShell no esta disponible en Linux, asi que sus tres pruebas se omiten aqui y quedan para CI Windows. Tampoco se ha hecho smoke SSH real ni ejecucion macOS. No se modifica ningun servicio remoto ni se publica release.

El lote 3 queda implementado y probado en Linux hasta la frontera de despliegue. Los lotes 4-6 del plan general permanecen pendientes; no se adelanta el SHA global de sincronizacion ni se declara paridad de todos los commits upstream. Siguiente paso: revisar el inventario por commit para el lote 4 y calificar la distribucion en Windows/macOS y SSH real antes de publicar.

## Lote 4, hito 1: legibilidad de tablas Markdown

Se adapta `51b561b` sobre la hoja de estilos propia de Voktty. Las celdas de tablas Streamdown en `AgentMarkdown` usan `min-width: 10rem` y alineacion vertical superior. El cambio conserva el componente y el scroller existentes. No se porta el changelog upstream, que describe la release de MonoCode.

Verificacion: `pnpm check-types` y `pnpm test` correctos, con 123 tests host, cinco omisiones de plataforma y 4478 tests frontend. `pnpm build` correcto y el CSS generado contiene la regla. `git diff --check` correcto. No se agrega test que replique una regla CSS; queda pendiente comprobar su presentacion en una ventana de ancho reducido en las plataformas de escritorio. El resto de commits del lote 4 sigue por revisar.

## Goal lote 4, hito 2: composicion IME del composer

Port funcional de `680e1ab9`. El textarea mantiene su `defaultValue` de montaje para evitar que los polls remotos reescriban su nodo de texto y fuerzen el cierre de composicion en WebKit. El efecto existente conserva la aplicacion de borradores posteriores. Se porta la prueba DOM upstream; antes del fix falla al observar el cambio de `defaultValue`, despues pasa. Sin cambio de IPC, persistencia, traducciones o dependencias.

Verificacion: `pnpm check-types` correcto; `pnpm test` correcto con 123 tests host y cinco omisiones de plataforma, 4479 tests frontend en 614 suites, contratos Cortex y rutas portables; `pnpm lint` correcto con cero errores, 1616 warnings y 17 infos; formato de la prueba correcto; `graphify update .` correcto con los avisos previos del extractor; `git diff --check` correcto. No se ejecuta un IME nativo en macOS: la prueba protege la mutacion DOM que causa el fallo. Siguiente hito: preservar el espacio del composer durante la medicion de altura; despues revisar scroll/pacing, Markdown grande, editor y arrastres.

## Goal lote 4, hito 3: altura del composer y posicion del transcript

Port parcial de `7933972a`. El helper reserva temporalmente la altura del contenedor durante la medicion y restaura su minHeight previo, evitando que el viewport del transcript se reduzca y limite su scroll. La restauracion de borradores usa el mismo helper. Tres regresiones reproducen la perdida de espacio antes del cambio; se cubren crecimiento, reduccion, limite de altura y elementos ocultos.

Verificacion: `pnpm check-types` correcto; `pnpm test` correcto con 123 tests host, cinco omisiones de plataforma y 4483 tests frontend; `pnpm lint` correcto con cero errores, 1616 warnings y 17 infos; formato de helper y pruebas y `git diff --check` correctos. El resto de scroll/pacing de este commit sigue pendiente. Siguiente hito: permitir el scroll de elementos internos cuando el transcript llega a un borde.

## Goal lote 4, hito 4: scroll de elementos internos

Se porta el guard de overscroll upstream: al llegar al borde del contenedor, recorre los ancestros del target y permite el gesto cuando un elemento interno tiene espacio en el eje permitido por su overflow. Mantiene la proteccion contra rebote y el desmontaje del listener. Se sustituyen dos pruebas que duplicaban la implementacion por doce pruebas sobre las funciones reales y eventos DOM, incluidas textarea, SVG/path y gestos diagonales.

Verificacion: `pnpm check-types` correcto; `pnpm test` correcto con 123 tests host, cinco omisiones y 4493 tests frontend en 614 suites; `pnpm lint` correcto, cero errores, 1616 warnings y 17 infos; Biome format, `git diff --check` y `graphify update .` correctos con los avisos conocidos del extractor. No se ha comprobado el rebote nativo macOS. Siguiente hito: cancelar arrastres de reordenado cuando se pierde pointerup, adaptando `829fede6` al hook propio de Voktty.

## Goal lote 4, hito 5: arrastres con pointerup perdido

Se adapta `829fede6` a `useSortable`, conservando el hook de Voktty. El movimiento del mismo puntero de raton con buttons=0 cancela y limpia captura, cursor y bloqueo de seleccion, sin reordenar. Se ignoran movimientos de otros punteros. Cinco pruebas DOM cubren cancelacion antes/despues del umbral, touch, puntero ajeno y suelta normal; las dos regresiones de cancelacion fallaban antes del cambio.

Verificacion: `pnpm check-types` correcto; `pnpm test` correcto con 123 tests host, cinco omisiones de plataforma y 4498 tests frontend; prueba focalizada correcta; `pnpm lint` correcto, cero errores, 1616 warnings y 17 infos, tras corregir el tipo del boton de la fixture; `git diff --check` correcto. No se sustituyen las animaciones o geometria existentes de Voktty. Sigue pendiente revisar Markdown grande, scroll/pacing y editor.

## Goal lote 4, hito 6: resaltado incremental de fences

Port parcial de `d68bfa8`: el resaltador reutiliza tokens y estado de gramatica de las lineas completas, recalculando la linea abierta. Conserva un unico checkpoint limitado por el presupuesto existente, descarta continuaciones incompatibles y mantiene coalescing y LRU. Siete pruebas upstream adicionales comparan tokens con el resaltado completo para CRLF, Markdown, Python, sintaxis multilinea, fuentes intercaladas y temas. La prueba de identidad de tokens falla antes del cambio y pasa despues.

Verificacion: `pnpm check-types` correcto; `pnpm test` correcto con 123 tests host, cinco omisiones y 4505 tests frontend; las catorce pruebas focalizadas pasan; `pnpm lint` correcto, cero errores, 1616 warnings y 17 infos; formato del archivo de produccion y `git diff --check` correctos. El formato del archivo de pruebas senala dos bloques preexistentes (confirmado frente a HEAD); las nuevas pruebas no agregan avisos de formato. No se actualiza Shiki ni se anaden dependencias. Faltan el renderer que conserva lineas DOM, el parser de fences y la medicion de frames en navegador; no se declara integrado todo `d68bfa8`.

Revision de `e65ed823`: `FilePane` envia las pestanas de review a `@/modules/editor/GitDiffPane`; su unico caller de `FileEditor` no pasa showDiff. Voktty conserva su visor Git en fuente y no usa el preview Markdown para review. No se porta una opcion para una ruta sin caller. Sigue pendiente revisar el resto del editor y sus marcadores.

## Goal lote 4, hito 7: renderer de lineas de codigo

Se porta `HighlightedCodeBlock` de `d68bfa8` y se conecta en AgentMarkdown, conservando Mermaid, enlaces de archivo e i18n. Mantiene elementos de lineas completas por identidad de tokens y descarta callbacks de renders anteriores. Tres pruebas DOM protegen ausencia de mutaciones en una linea completa, resultados obsoletos, lineas vacias y cambios de numeracion. Se incluyen estilos de tokens y numeracion en la hoja existente de resaltado. La inspeccion de Streamdown 2.6 exige declarar block y estilos del contenedor, que su componente anterior suministraba.

Verificacion final: `pnpm check-types`, `pnpm test`, `pnpm lint` y `pnpm build` correctos. Tests: 123 host, cinco omisiones, 4508 frontend en 616 suites; lint cero errores, 1619 warnings y 17 infos. Biome format de los dos archivos nuevos correcto; `git diff --check` correcto; `graphify update .` correcto con avisos conocidos. Fixture local ignorada bajo este directorio y Chromium headless contra Vite: 1500 lineas renderizadas, geometria vertical separada, contenido completo, offset 42 y cambio de colores light/dark correctos. Logs en /tmp/voktty-lot4-render-*; no se usa contenido de usuario. No equivale a medicion de frames de streaming ni validacion WebKit/macOS.

Siguiente paso: declarar el remend ya instalado transitivamente como import directo, portar parseStreamingMarkdown y sus regresiones para evitar reparacion cuadratica de fences, y despues integrar pacing/scroll del transcript y revisar el editor. El goal sigue activo y no se adelanta el SHA global upstream.

## Goal lote 4, hito 8: parser de fences en streaming

Se porta parseStreamingMarkdown de `d68bfa8` y se conecta mediante el callback de Streamdown, desactivando su reparacion global. La reparacion por bloque conserva enfasis/enlaces incompletos de prosa y deja los fences superiores literales, incluso abiertos, indentados, con tildes o delimitadores anidados. Nueve pruebas upstream pasan; se adapta Array.at al target existente de Voktty tras un fallo de typecheck. Listas y blockquotes conservan su reparacion normal.

Remend 1.3.1 ya estaba instalado por Streamdown. Se declara la misma dependencia directa compatible con upstream; `pnpm install --offline --ignore-scripts` descarga cero paquetes, no cambia versiones y anade solo tres lineas al importer del lockfile. Apache-2.0, sin dependencia nueva en el bundle frente a Streamdown ni acceso nativo.

Verificacion: `pnpm check-types`, `pnpm test`, `pnpm lint` y `pnpm build` correctos; 123 tests host, cinco omisiones y 4517 frontend; lint cero errores, 1619 warnings y 17 infos; pruebas focalizadas, Biome format y `git diff --check` correctos. Medicion Node local orientativa con fence Markdown de 1500 lineas: parser medio de tres ejecuciones 0.14 ms y reparacion completa 5.32 ms; no es benchmark de frames ni criterio multiplataforma. Pendientes: pacing/fade y estabilidad del scroll, medicion de streaming en navegador y auditoria del editor/inventario. El goal permanece activo.

## Goal lote 4, hito 9: pacing y fade de Markdown

Se porta wordFade y su integracion en AgentMarkdown. La revelacion usa rAF y conserva el reloj entre chunks; mantiene palabras completas, libera una palabra cuando el stream pausa y termina a ritmo despues de finalizar la respuesta. La prosa usa spans temporales y los elimina al acabar el fade. El contexto de fade cambia la key de la prosa, manteniendo la key de fences para preservar su DOM. Se ofrece revealOnMount para respuesta nueva ya completada; su caller del transcript sigue pendiente. El historial no streaming conserva presentacion completa inmediata.

Se reutilizan los tipos de arbol locales de hardBreaks, con los mismos guards que usa esa implementacion, sin dependencia nueva. El plugin corre despues del hardening y antes de hardBreaks. Los estilos incluyen prefers-reduced-motion. Trece pruebas protegen pacing, chunks antes de frames, palabras, spans, enlaces/codigo, finalizacion, opt-in de mount y conservacion del nodo de codigo. Seis pruebas fallaban antes de conectarlo.

Verificacion: tipos, suite completa final y lint correctos; 123 tests host, cinco omisiones y 4530 frontend en 618 suites; lint cero errores, 1619 warnings y 17 infos. Build, formato de los dos archivos nuevos, diff check y graphify update correctos. Chromium real mediante CDP sobre fixture local ignorada: 381 lineas de 1500 tras 100 ms, contenido completo final, nodo de codigo conservado y fade retirado. La prueba CLI con tiempo virtual fallo y no se usa como evidencia; CDP necesita seleccionar el target de tipo page, no browser_ui. No se mide presupuesto de frames ni se ejecuta WebKit/macOS.

Siguiente hito: conectar revealOnMount para bloques nuevos conservando historial y visibilidad; despues portar los guards de scroll y sus regresiones, y revisar editor y resto del inventario. Goal activo, sin push/publicacion ni cambio del SHA global.

## Goal lote 4, hito 10: procedencia de respuestas para el pacing

Se conecta revealOnMount del Markdown desde TranscriptBlock. El transcript inicializa los IDs con texto como vistos y los registra despues del render: un bloque nuevo visible puede revelarse aunque llegue ya completado. Los bloques vacios no cuentan como vistos. Al abrir una conversacion o activar una pestana que recibio output oculta, se muestra el contenido completo inmediatamente. La paginacion y reveal por busqueda de Voktty usan la coleccion completa ya conocida.

Se portan cuatro regresiones upstream y se adaptan dos de historial a la paginacion local y onRevealReady actuales. Las seis pasan. El parametro de procedencia de paginas historicalBlockIds corresponde al store Mono con carga incremental, ausente de este flujo; no se introduce una prop sin caller. Queda para el lote 5 si se integra ese store. La cola de entrada de herramientas de AgentTranscriptPacing upstream sigue pendiente de portar en el lote 4.

Verificacion: `pnpm check-types`, `pnpm test` y `pnpm lint` correctos; 123 tests host, cinco omisiones y 4536 frontend; lint cero errores, 1619 warnings y 17 infos; pruebas focalizadas, formato de la nueva prueba y diff check correctos. No se modifica IPC, persistencia ni traducciones. Se ha leido AgentTranscript completo y revisado el caller SessionPane. Siguiente hito: guards de seguimiento de scroll, wheel consumido por elementos internos y conservacion de la posicion durante resize/streaming; despues anclaje de turnos, cola de herramientas y editor.

## Goal lote 4, hito 11: seguimiento del scroll principal

Se adaptan los guards de `7933972a`, `3e05e032` y el hold de wheel del upstream fijado. El transcript registra la posicion tras cada pin y distingue movimiento manual, eventos atrasados sin movimiento y ajustes de layout que limitan el offset al fondo. Reconciliacion antes de resize/streaming; solo se vuelve a seguir al llegar al final, con tolerancia de 1 px. Un wheel consumido por un scroller interno no suelta el pin exterior. Los observers/listeners actuan con el panel visible y conectado; el timer neutral de 150 ms se limpia al desmontar.

Se portan once regresiones del scroll principal y se anaden dos para el gesto neutral de trackpad y su giro hacia arriba. Nueve fallaban antes del cambio; las trece pasan despues. Los escenarios de paginacion de base de datos y bottomAligned Mono se conservan en el inventario del lote 5, porque esos contratos no existen en el caller actual. No se sustituyen el layout ni la paginacion de Voktty.

Verificacion: `pnpm check-types`, `pnpm test` y `pnpm lint` correctos; 123 tests host, cinco omisiones y 4549 frontend en 620 suites; lint cero errores, 1623 warnings y 17 infos. Prueba focalizada, formato de la nueva prueba, diff check y revision del diff correctos. Pruebas DOM con geometria declarada, sin validacion de trackpad nativo/WebKit. Pendientes del scroll: fase interna y anclaje de turnos; despues cola de herramientas y auditoria del editor/inventario. Goal activo.

## Goal lote 4, hito 12: seguimiento de la fase interna

Se adapta useLivePhaseScroll del upstream fijado para compartir el guard de movimiento del transcript principal. Cada pin registra el offset y reconcilia movimientos manuales antes de resize o actualizaciones de pasos; un evento atrasado sin movimiento no vuelve a activar el seguimiento. Volver al fondo lo activa de nuevo. Se elimina el margen anterior de 16 px que provocaba saltos.

Una regresion DOM sobre la fase real reproduce el fallo antes del cambio (320 pasa indebidamente a 360) y pasa despues; cubre wheel, evento atrasado, reanudacion al fondo y movimiento de scrollbar antes de su evento. Las catorce pruebas de scroll pasan. Verificacion: pnpm check-types, pnpm test y pnpm lint correctos; 123 tests host y cinco omisiones, 4550 frontend en 620 suites; lint cero errores, 1630 warnings y 17 infos. Formato de prueba, diff check y revision correctos. Sin validacion nativa de trackpad/WebKit.

Siguiente hito: anclaje de turnos ante cambios de altura por encima del viewport; despues cola de herramientas y editor/inventario. Goal activo, sin push y sin cambiar el SHA global.

## Goal lote 4, hito 13: anclaje de turnos

Se porta el anclaje explicito upstream para los turnos que cambian de altura por encima del viewport. El hook del modulo separa el calculo puro de deltas del ResizeObserver, ordena las entradas segun el DOM y corrige solo turnos que estaban completamente por encima de la lectura. Registra el offset ajustado para que el guard de seguimiento no interprete la correccion como movimiento manual. Guarda alturas con WeakMap, observa turnos nuevos y desconecta/reobserva tras eliminaciones sin retener nodos retirados. Limpia ambos observers al desmontar o desactivar la vista.

Dos regresiones upstream fallaban antes del port y pasan despues; se agregan dos variantes que impiden correcciones durante seguimiento y con el panel desconectado. Dieciocho pruebas focalizadas correctas. Verificacion: pnpm check-types, pnpm test y pnpm lint correctos; 123 tests host y cinco omisiones, 4554 frontend en 620 suites; lint cero errores, 1634 warnings y 17 infos. Formato del hook/pruebas, diff check y revision correctos. Graphify query/explain/path confirma SessionPane como caller; su grafo precede a los nuevos cambios. Pruebas DOM con geometria declarada, sin validacion WebKit nativa.

Siguiente hito: cola de entrada de herramientas, despues auditoria del editor y resto del inventario. Goal activo, sin push y sin actualizar el SHA global.

## Goal lote 4, hito 14: cola de entrada de herramientas

Se porta useStepQueue/PhaseStep del upstream fijado al modulo local, conservando ActivityRow y sus traducciones. Los pasos existentes al montar o recibidos con la fase cerrada quedan asentados; los nuevos activos conservan su turno entre renders. Ritmo inicial 480 ms, aceleracion del backlog hasta 160 ms. El timer de espera se limpia al desmontar y solo la animacion del hijo directo asienta la fila. CSS upstream abre espacio, dibuja rail y rama, y revela el contenido con mascara; reduced-motion retira animaciones y clipping.

La regresion de rafaga fallaba antes del cambio y pasa despues, adaptada a la fase local con dos herramientas iniciales. Incluye renders repetidos, espera sucesiva y animationend de la fila. Siete pruebas de pacing correctas. pnpm check-types, pnpm test, pnpm lint y pnpm build correctos; 123 tests host con cinco omisiones y 4555 frontend en 620 suites; lint cero errores, 1634 warnings y 17 infos. Formato de helper/prueba, diff check y revision correctos. No se valida la mascara en WebKit nativo; build y pruebas DOM no equivalen a esa validacion.

Siguiente hito: gutter de diffs del editor (185b5005), paletas accesibles y marcadores (e188ff1e), despues resto del inventario y medicion de frames. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 15: marcadores y layout del gutter

Se portan las partes del editor de e188ff1e y 185b5005: signos +/menos por linea, un widget por linea eliminada, numeros originales, tintado de todas las celdas del gutter, precedencia baja del carril de signos y orden fold/numeros en FileEditor cuando showDiff esta activo. Se reserva el ancho de los numeros originales y se elimina al quitar la base. El editor usa los tokens diff de upstream con defaults claros/oscuros en globals; sus contadores y overview usan los mismos tokens. Se conserva la geometria e interaccion actual del overview, cuyo cambio upstream corresponde a otra integracion del scrollbar.

Dos regresiones upstream fallaban antes del port. Se anade una para reserva/limpieza de digitos; las tres DOM y las dieciseis existentes del editor pasan. pnpm check-types, pnpm test y pnpm lint correctos; 123 host y cinco omisiones, 4558 frontend en 621 suites; lint cero errores, 1636 warnings y 17 infos. Formato de editorGit/prueba, diff check y revision correctos. No se ejecuta validacion de geometria en WebKit nativo. No se declara portada toda la funcionalidad de paletas.

Pendiente: selector/persistencia de paletas, tokens en las otras vistas y sus signos, incluido GitDiffPane de Voktty que recibe el review real. SettingsView de Harness limita Appearance al fondo del chat; revisar settings/sections/HarnessSection y GeneralSection para colocar la preferencia sin duplicar ajustes globales. Siguen pendientes performance/frames y resto del inventario. Goal activo, sin push ni SHA global actualizado.

## Goal lote 4, hito 16: persistencia y tokens de paletas

Se incorpora la preferencia monocode.diffPalette y las paletas colorblind/high-contrast de e188ff1e. Helper independiente con validacion enum, default seguro y manejo de almacenamiento no disponible. Main y settings inicializan la clase antes de render; cambios storage de la otra ventana actualizan el documento y notifican a futuros controles. Listener con cleanup, sin IPC nuevo. Guardar aplica la paleta aunque falle la escritura. Las clases solo cambian tokens diff, conservando las clases de tema de Voktty; los overrides claros usan .light en lugar del nombre exclusivo de upstream.

Ocho pruebas verifican preferencias invalidas, roundtrip de tres paletas, init, clases exclusivas, mantenimiento del tema, eventos de otra ventana/clear y cleanup, fallos de lectura/escritura. pnpm check-types, pnpm test, pnpm lint y pnpm build correctos; 123 host con cinco omisiones y 4566 frontend en 622 suites; lint cero errores, 1636 warnings y 17 infos. Formato de helper/prueba y diff check correctos. No se ejecutan dos ventanas nativas ni contraste medido en navegador; la sincronizacion esta probada mediante StorageEvent DOM.

La funcionalidad de paletas sigue incompleta: falta selector localizado en los ajustes centrales y tokens/marcadores en las restantes vistas, especialmente GitDiffPane. HarnessSection ya contiene las preferencias de presentacion; no se duplicara un selector dentro de SettingsView local. Siguiente paso: leer en/es completos antes de agregar keys y conectar el control con la preferencia compartida. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 17: selector localizado de paletas

Se conecta el selector de las tres paletas en HarnessSection, junto a transcriptLayout. El control pertenece al modulo Harness y reutiliza la persistencia e inicializacion del hito 16. Restablece el valor inicial, escucha cambios de la misma ventana y de otra ventana mediante la notificacion compartida, limpia el listener y conserva la seleccion visible cuando falla la escritura. Cuatro keys nuevas en ingles/espanol; otros idiomas heredan ingles conforme al resolver existente. en/es se han leido completos antes de editarlos.

Cuatro pruebas DOM nuevas cubren las tres selecciones/restauracion, cambios locales/remotos/clear, fallo de almacenamiento y etiquetas espanolas. Las doce focalizadas pasan. pnpm check-types, pnpm test, pnpm lint y pnpm check:i18n-coverage correctos: 123 host con cinco omisiones; 4570 frontend en 623 suites. Lint cero errores, 1636 warnings y 17 infos. Espanol cubre explicitamente las 4858 keys. Formato de archivos nuevos, diff check y revision correctos. Graphify query/path confirma SettingsModal como caller; el grafo precede al nuevo control. No se prueba sincronizacion de dos ventanas nativas ni contraste medido; no se repite build para este selector.

Siguiente hito: tokens y marcadores en GitDiffPane y restantes vistas de cambios, seguido de performance/frames y resto del inventario. La funcionalidad global de paletas y el lote 4 siguen incompletos. Goal activo, sin push ni actualizacion del SHA global.

## Goal lote 4, hito 18: paletas y signos en el review real

GitDiffPane recibe los tokens compartidos en texto/filas/gutter de adiciones y eliminaciones, botones de staging y contadores del fallback. Se adaptan los signos por linea al DOM real de unifiedMergeView: pseudo-elementos +/menos en filas nuevas/eliminadas, carril reservado tambien en contexto, sin alterar el documento ni la seleccion copiada. Se conservan staging de hunks, revisiones incrementales, permisos, watchers, modos locales/remotos y controles. El color verde del estado Reviewed sigue indicando revision, no adicion.

Se inspecciona el DOM de @codemirror/merge instalado y graphify query/explain/path confirma FilePaneComponent como caller directo y GitReviewTab/GitDiffStack como consumidores. Fixture local ignorada monta el GitDiffPane real con respuesta de commit sintetica y ThemeProvider. Chromium/CDP pasa seis checks: dos filas nuevas con +, dos eliminadas con menos, contexto sin signo, texto intacto, seis combinaciones distintas de tres paletas por claro/oscuro, seleccion de codigo sin glifo. La primera fixture fallo por faltar ThemeProvider; corregida pasa tanto CDP real como CLI con tiempo virtual. No se atribuye ese primer fallo al renderer del producto. No se prueba WebKit nativo, screen reader ni operacion de staging real con esta fixture.

pnpm check-types, pnpm test y pnpm lint correctos: 123 host con cinco omisiones; 4570 frontend en 623 suites. Lint cero errores, 1636 warnings y 17 infos. Diff check y revision correctos. Cambio visual sin nueva logica core; verificacion de comportamiento en navegador en vez de prueba que copie declaraciones CSS.

Pendiente: tokens y signos en UnifiedDiffView y las otras vistas/contadores del Harness; performance/frames, arrastres y resto del inventario. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 19: signos y tokens en UnifiedDiffView

Se porta la parte de UnifiedDiffView de e188ff1e: colores de filas, gutter y contadores usan tokens; carril w-7 con +/menos y cue sr-only fuera del span de codigo. Se aumenta el ancho horizontal de max+8 a max+10 para incluir el carril. El contexto reserva el mismo ancho sin signo/cue. Los cues reutilizan keys traducidas de gitHistory.status y responden a cambios de idioma; no se introducen keys duplicadas. Se conserva virtualizacion, comentarios, folds, staging y menu existentes.

La regresion DOM upstream se adapta al modulo local y comprueba texto separado, cuatro signos/cues y select-none del carril. Otra comprueba el cambio a espanol. La fixture inicial necesitaba mock de useColorScheme porque este hook local exige ThemeProvider; la expectativa espanola se ajusta a la traduccion existente Anadido. No se declara fallo previo funcional a partir de esos errores de fixture. Graphify query/explain/path confirma SessionChangesDiff, InboxPrDiff y GitCommitDiffPane como consumidores. UnifiedDiffView se ha leido completo, cubriendo aparte el tramo truncado del primer output.

pnpm check-types, pnpm test y pnpm lint correctos: 123 host con cinco omisiones; 4572 frontend en 624 suites. Lint cero errores, 1636 warnings y 17 infos. Formato de prueba, diff check y revision correctos. Pruebas DOM, sin medicion de geometria horizontal ni copia nativa/WebKit en este hito.

Siguiente: FilePreview/ToolDiffPreview y SessionReview (archivos completos ya leidos), luego FileTree, Sidebar, ProjectRail e InboxPrOverview; comprobar equivalente local de GitChangesPanel. Seguir despues con performance/frames, arrastres y resto del inventario. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 20: previews de herramientas y contadores de sesion

Se portan los doce reemplazos de clases de e188ff1e en FilePreview y SessionReview: filas, barras, signos y contadores de adicion/eliminacion usan los tokens compartidos. ToolDiffPreview delega su contenido a FilePreview, confirmado por graphify query/explain/path y lectura completa; no requiere duplicar el cambio. Los tres archivos se han leido completos en el hito anterior. Se conserva sintaxis, limite de lineas, contenido original, traducciones, acciones Keep/Undo, callbacks y persistencia de checkpoints. No se cambia el color de rechazo ni el resaltado de palabras clave, que no significan adicion/eliminacion.

pnpm check-types, pnpm test y pnpm lint correctos: 123 host con cinco omisiones; 4572 frontend en 624 suites. Lint cero errores, 1636 warnings y 17 infos. Diff check y revision correctos. Cambio de clases visual, sin nuevas pruebas que reproduzcan CSS ni medicion nativa de paletas en estas superficies.

Quedan FileTree, Sidebar, ProjectRail e InboxPrOverview (este ultimo ya leido completo). El equivalente local de GitChangesPanel es SourceControl, wrapper de SourceControlPanel de Voktty; wrapper de 52 lineas leido completo, requiere inspeccionar el panel real antes de cambiar sus estados de archivos. Performance/frames, arrastres y resto del inventario siguen pendientes. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 21: arbol de archivos y resumen de PR

Se portan los tres colores de estado de FileTree y seis clases de InboxPrOverview: archivos nuevos/eliminados, contadores y barras usan la paleta compartida. Se conserva el amber de modificaciones y las operaciones de filesystem, watchers, arrastres y apertura existentes. FileTree leido completo; InboxPrOverview ya estaba leido. Graphify query/explain/path confirma consumidores. ProjectRail leido hasta la linea 1200, pendiente completar antes de editar.

pnpm check-types, pnpm test y pnpm lint correctos: 123 host con cinco omisiones; 4572 frontend en 624 suites. Lint cero errores, 1636 warnings y 17 infos. Diff check y revision correctos. Cambio visual sin nuevas pruebas que reproduzcan CSS; sin validacion nativa de estas superficies.

Siguiente: completar lectura de ProjectRail, leer Sidebar y SourceControlPanel y portar juntos los contadores/estados restantes aplicables. Performance/frames, arrastres y resto del inventario siguen pendientes. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 22: contadores restantes y generacion real de paletas

Se portan los contadores de Sidebar/ProjectRail y se adapta GitChangesPanel al panel compartido SourceControlPanel: acentos de archivos A/D usan tokens, conservando U/M/R, staging, permisos y operaciones nativas. Los tres archivos leidos completos. Graphify query/explain/path confirma SourceControl como caller del panel y DiffPane como consumidor adicional. No se cambian colores de errores, agentes terminados ni tipos de commit.

La inspeccion del build descubre un fallo previo: los tokens de :root no estaban registrados en @theme, por lo que Tailwind omitia las clases diff de los hitos anteriores. Se registran ocho referencias en @theme inline sin fijar la paleta en las utilities. Globals leido completo antes de editar. El CSS compilado genera foreground, fondos, gutter y modificadores de opacidad. Fixture temporal en /tmp monta ese CSS compilado; Chromium pasa las seis combinaciones claro/oscuro y tres paletas, con colores distintos de adicion/eliminacion y fondos/gutter/acento no transparentes. Esta comprobacion corrige la evidencia insuficiente de los hitos visuales anteriores: sus typechecks/tests no probaban generacion de utilities. GitDiffPane usaba variables directamente y su fixture previa no cubria esas clases. No se valida WebKit nativo ni contraste medido.

Tras la correccion se repiten pnpm check-types, pnpm test, pnpm lint y pnpm build: todos correctos; 123 host y cinco omisiones, 4572 frontend en 624 suites. Lint cero errores, 1636 warnings y 17 infos. Diff check y revision correctos. Sin pruebas que reproduzcan declaraciones CSS; comportamiento comprobado con CSS de produccion.

Siguiente hito: fd10730 evita duplicar el primer parrafo al abrir Thinking. Confirmado aplicable a ActivityThinkingRow usado por ActivityRow local (no exclusivo de Mono); etiquetas traducidas existentes disponibles. AgentTranscript.test.ts leido completo, AgentTranscript.tsx solo tramo relevante inspeccionado en este hito: completar lectura antes de editar. Siguen performance/frames, composer file drops, spellcheck y resto del inventario. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 23: resumen del pensamiento abierto

Se porta fd10730 a ActivityThinkingRow: al abrir, el encabezado usa harness.chrome.thinking; al cerrar recupera proseSummary. Reutiliza traducciones existentes Thinking.../Pensando... y conserva el cuerpo completo, pulsacion, aria-label y disclosure. AgentTranscript.tsx leido completo (3053 lineas) en cuatro tramos antes de editar; graphify query/explain/path confirma ActivityRow como caller. La etiqueta localizada contiene puntos conforme al contrato local, sin nueva key ni cambio de idioma.

Dos regresiones DOM en ingles/espanol cubren resumen cerrado, apertura, aria-expanded, etiqueta abierta, primer parrafo una sola vez, segundo parrafo visible y cierre/restauracion. La primera fixture intentaba usar la vista clasica, que elimina reasoning antes de render: ajustada a Zen. Despues ambas fallaban por conservar el resumen abierto antes del port y pasan tras el cambio. Se conserva la vista real de AgentTranscript, con el hook Zen fijado por la fixture y ResizeObserver simulado. Pruebas DOM, sin WebKit nativo.

pnpm check-types, pnpm test y pnpm lint correctos: 123 host y cinco omisiones; 4574 frontend en 625 suites. Lint cero errores, 1636 warnings y 17 infos; warning nuevo de template corregido. Biome check de prueba, diff check y revision correctos. No se repite build para este cambio de texto condicionado.

Siguiente hito: 0bfa5c61 rendimiento. Se han inspeccionado los diffs de HarnessEventQueue, TranscriptTurnCache y TranscriptPool; el local no tiene estos helpers/pool y HarnessApp aun usa una cola con un solo schedule. AgentTranscript agrupaciones locales groupTurns(blocks)/groupTurnItems(turn, zen) difieren del upstream managed/settled: adaptar semantica, no copiar parametros. HarnessApp tiene 7427 lineas, pendiente lectura completa antes de editar; fileIndex 303. AgentTranscript ya leido completo y disponible para portar cache. Composer file drops, spellcheck, frames y resto del inventario pendientes. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 24: cache de agrupaciones del transcript

Se porta TranscriptTurnCache de 0bfa5c61 y se conecta a AgentTranscript con instancia por componente. Reutiliza turnos cuya longitud y referencias de bloques no cambian; conserva el array de turnos si una copia inmutable es equivalente. Cache de items por identidad de turno y modo Zen/clasico mediante WeakMap, con dos variantes como maximo por turno. Se adapta el parametro local zen en lugar de managed/settled upstream; no se filtran campos de orquestacion inexistentes ni se cambian folds, texto, permisos o IPC. El reducer local patchStreaming sustituye array y bloque, inspeccionado como contrato de identidad. AgentTranscript fue leido completo en el hito anterior; diff actual estrecho. Graphify explain/path confirma sus agrupaciones.

Cinco pruebas del helper verifican diecinueve turnos reutilizados frente a un ultimo actualizado, edicion historica aislada, modo Zen/clasico, handoffs, rewind, vaciado y arrays equivalentes. Regresion del componente real monta veinte turnos, cuenta veinte agrupaciones iniciales, ninguna extra para array equivalente y una sola al cambiar el ultimo; ocultar/reactivar no vuelve a agrupar. Comprueba ademas contenido historico y nuevo. Veinticuatro pruebas focalizadas iniciales y la regresion de componente correctas; no se afirma fallo previo de esta nueva prueba ni se mide frame budget con ella.

pnpm check-types, pnpm test y pnpm lint correctos; ultima suite completa incluye los tres archivos nuevos: 4580 frontend en 627 suites, 123 host y cinco omisiones. Lint cero errores, 1636 warnings y 17 infos. Biome check de helper/pruebas, diff check y revision correctos. Sin build ni medicion de frames en navegador en este hito.

Siguiente: fileIndex de 0bfa5c61. fileIndex.ts (303) y fileIndex.test.ts (186) leidos completos aqui; diff upstream inspeccionado. El local mantiene un solo checkout y epoch global; upstream retiene ocho indices LRU y promesas por checkout, invalida inactivos al reanudar. Callers confirmados por graphify: Composer, SearchView, FilePicker y resolveOpenablePath. HarnessApp prefetch al cambiar sidebarCwd; invalidacion global al mover/borrar, scoped desde nudgeWorkspace. Inspeccion de esos tramos no equivale a lectura completa de HarnessApp. Pendientes adicionales del commit: cola foreground/background, guards de medicion de UserMessageBlock y evaluar equivalente del pool (no hay TranscriptPool local). Siguen arrastres, spellcheck, frames y auditoria restante. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 25: indices de archivos por proyecto y reanudacion

Se porta fileIndex de 0bfa5c61: ocho snapshots LRU, promesas por cwd, deduplicacion por proyecto y descarte de respuestas reemplazadas/invalidadas mediante identidad de promesa. Reanudar foco/visibilidad descarta indices inactivos y revalida el activo; ocultar la ventana no invalida ni dispara escaneos. Se conserva busqueda, ranking, resolucion de links, paths exactos, recents, debounce y notificaciones existentes. Claves cwd sin normalizacion nueva; listProjectFiles sigue usando invokeWorkspace, que separa rutas remote:// del invoke nativo. Se inspeccionan sus ramas y looksLikeProject (Windows/UNC/remotos), sin cambiar acceso, autorizacion ni IPC. No se ejecutan escaneos SSH/Windows/macOS nativos en este hito.

Cinco regresiones de cache upstream y tres de resume se adaptan al modulo local. Cuatro fallaban antes del port; despues pasan las diecinueve focalizadas: alternancia repetida de dos proyectos, escaneos independientes, invalidacion scoped, respuesta antigua, limite/recencia, foco/visibilidad y ventana oculta, ademas de los once casos locales previos. FileIndex y su prueba existente se habian leido completos en el hito 24; cambios estrechos, sin formatear bloques ajenos. Nueva prueba DOM resume pasa Biome check. Graphify path desambiguado confirma Composer como caller.

pnpm check-types, pnpm test y pnpm lint correctos: 4588 frontend en 628 suites, 123 host y cinco omisiones. Lint cero errores, 1636 warnings y 17 infos. Diff check y revision correctos. Sin Rust modificado ni build en este hito.

Siguiente: retener FileTree oculto en Sidebar al cambiar chats/worktrees (otra parte de 0bfa5c61, diff y tres regresiones upstream inspeccionados aqui), y guards de medicion de UserMessageBlock. Sidebar fue leido completo en hito 22 y AgentTranscript en hito 23. Pruebas locales disponibles SidebarSessionId/SidebarInsertMotion; no existe SidebarRename local. La cola foreground/background requiere lectura completa pendiente de HarnessApp (7427 lineas). Evaluar pool local, frame budget, arrastres, spellcheck y resto del inventario. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 26: explorer oculto y mediciones del transcript

Se adaptan dos cambios de 0bfa5c61. Sidebar monta FileTree al visitar Archivos y conserva su cwd y DOM mientras se navega por chats de otros proyectos; al mostrar Archivos actualiza el root inmediatamente. Se usa sidebarVisible local, sin introducir drawer ni rootLabel inexistentes. Cerrar Sidebar conserva el comportamiento previo de desmontar su contenido; la retencion de DOM corresponde a las pestanas ocultas. UserMessageBlock evita medir si visible=false, si el elemento esta desconectado o si checkVisibility disponible informa contenido omitido. Repite la medicion con contentvisibilityautostatechange al mostrarse y elimina observer/listener al ocultarse. La API opcional mantiene fallback en navegadores sin checkVisibility; no se introduce CSS content-visibility en este hito.

Tres regresiones fallaban antes del cambio. Cuatro casos nuevos y el de cache existente pasan: montaje diferido, DOM/scroll retenidos, cambio de proyecto visible, mediciones omitidas y retirada de observers/listeners. Pruebas DOM con native y FileTree mockeados: no validan escaneos nativos ni layout WebKit. Sidebar y AgentTranscript leidos completos en hitos previos; pruebas nuevas/existentes leidas completas aqui. Se retira formato ajeno del diff. El primer typecheck detecto null en un fixture cuyo contrato exige string|undefined, corregido antes de repetir el gate.

pnpm check-types, pnpm test y pnpm lint correctos. Suite completa: 4592 frontend en 629 suites, 123 host y cinco omisiones. Cinco focalizadas repetidas tras ajustar el fixture correctas. Biome check de ambas pruebas sin diagnosticos; lint general cero errores, 1635 warnings y 17 infos existentes. Diff check y revision correctos. Sin build, cambios Rust ni validacion nativa en este hito.

Siguiente: cola foreground/background de 0bfa5c61; leer HarnessApp completo antes de editar (7427 lineas). Evaluar equivalente del pool local, MarkdownModeToggle, composer file drops, spellcheck nativo, content-visibility/scroll y frame budget en navegador, y cerrar auditoria restante del inventario. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 27: colas foreground/background

HarnessApp leido completo (ocho tramos sin truncar), junto al helper y las pruebas upstream de 0bfa5c61. Se porta HarnessEventQueue a lib/harnessFlush: dos schedules independientes, rAF para sesiones visibles y timeout de 100 ms para sesiones ocultas o ventana hidden. Aprobaciones y preguntas entregan inmediatamente los eventos anteriores de su misma sesion, sin vaciar las demas. Cambiar tabs/panes/superficies pone al dia solo los visibles antes de pintar; visibilitychange vacia todo para cancelar frames antes de suspenderse. Submit, stop, compact, removal y quit conservan flush total; reap pagehide/beforeunload y cierre nativo ahora vacian antes de guardar incluso sin sesiones busy. Cleanup cancela ambos schedules. No se cambia reducer, IPC, autorizacion ni persistencia nativa.

Clasificacion adaptada mediante funcion pequena con tests: todos los chats del split activo son foreground aunque el foco este en un editor; las superficies de Search/Inbox/Notes/Automations/Settings y el Inbox clasico ocultan el workspace, mientras el portal de Inbox visible sigue avanzando. No se copian agent file tabs ni Mono standalone inexistentes localmente. Graphify query encuentra HarnessApp y path confirma applyHarnessEvent; explain flushHarnessEvents no encuentra el callback local, por lo que se inspeccionan sus callers directamente. Imports nuevos con alias; diff sin formato ajeno.

Quince pruebas focalizadas correctas: trece upstream adaptadas y dos de clasificacion local. Protegen batching de dos streams ocultos con veinte frames foreground, entrega completa y ordenada, cambio de chat sin retrasar timer ajeno, preguntas/aprobaciones, ventana hidden sin frames, flush total sin duplicados y cancelacion de ambos schedules. Primer typecheck detecto diferencia de generic it.each en Vitest 5 y decision obligatoria en question.resolved local; fixture corregido y gates repetidos. pnpm check-types, pnpm test y pnpm lint finales correctos: 4607 frontend en 630 suites, 123 host y cinco omisiones. Biome check de helper/pruebas sin diagnosticos; lint general cero errores, 1634 warnings y 17 infos. Diff check y revision correctos. No se ejecutan frame budget, ventanas Tauri/WebKit nativas ni build en este hito.

Auditoria adicional: TranscriptPool completo upstream y SessionSurface completo local inspeccionados. MonoCode ya tenia el pool en la base 6bd432c; 0bfa5c61 evita emisiones con props equivalentes. Local conserva tabs montados y AgentTranscript salta renders mientras visible=false, pero no tiene un pool para conservar transcripts tras cerrar pane/tab. No se declara equivalencia para cierre/reapertura ni se introduce un pool sin revisar todo su ciclo. SessionPane local (540 lineas) leido completo; PaneTree solo tramos relevantes, pendiente lectura completa antes de editar. MarkdownModeToggle local completo leido: falta fallback de useMarkdownMode, pero reviews actuales usan GitDiffPane, no showDiff de FileEditor. Pendiente resolver el alcance aplicable con callers.

Siguiente: completar auditoria del pool y MarkdownModeToggle, composer file drops, spellcheck nativo, content-visibility/scroll y frame budget en navegador, y resto del inventario. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 28: retencion LRU de transcripts

Se integra TranscriptPool en HarnessApp, PaneTree y SessionPane. El outlet conserva hasta doce transcripts estacionados tras cerrar panes; al reabrir usa el mismo contenedor/DOM y recibe props nuevas. Las entradas activas permanecen en su host y no cuentan en el limite estacionado. Se incluye el portal de conversaciones Inbox bajo el mismo pool. Comparacion superficial de tipo, key y props evita notificar al outlet cuando props equivalentes llegan de nuevo. La delegacion de mousedown a cada contenedor mantiene el foco del pane a traves del portal y se retira al estacionar; callback estable evita notificaciones por cada render. Sin cambios de protocolo, nativos, persistencia o i18n.

Once regresiones locales derivadas de TranscriptPool upstream: reuso por diez chats sin remontar, colocacion en el host, snapshot estable para props equivalentes, callback de foco nuevo, visibilidad/props sin desmontar, estacionar y reabrir, marca hidden, eviccion LRU sobre limite, forwarding de foco, proteccion contra cleanup de host obsoleto y fallback sin pool. Las once pasan en happy-dom; esto verifica ciclo React/DOM, no cuantifica ahorro de memoria ni frames de WebKit. SessionPane y SessionSurface leidos completos en hitos previos; PaneTree (637 lineas) y HarnessApp completos leidos antes. Se verifican callers: dos usos de LazySessionPane, tabs y portal Inbox. Graphify path consultado al mapear PaneTree/HarnessApp; la relacion de pooling no existia en el grafo viejo, por lo que se valida con callers directos.

pnpm check-types, pnpm test y pnpm lint correctos. Suite: 4618 frontend en 631 archivos/suites Vitest; 123 host, cinco omisiones, siete pruebas de Cortex eval y build host correctos. Lint cero errores, 1635 warnings y 17 infos. Biome check de pool/prueba sin errores y un warning de compatibilidad por hasOwnProperty, necesario con lib TypeScript pre-ES2022. Diff check correcto. No se ejecuta build de app nativa ni benchmark de memoria/frame.

Siguiente: adaptar fallback source para diff Markdown solo tras comprobar caller efectivo; revisar y portar file drops del Composer, spellcheck nativo macOS, scroll y frame budget en Chromium/WebKit, y cerrar el inventario restante. Pool y guards de medicion quedan cubiertos en DOM, falta medida real de frames. Goal activo, sin push ni cambio del SHA global.

## Goal lote 4, hito 29: arrastres de archivos del Composer

Se adapta `56bae446` a la ruta local: `DataTransfer.items` permite reconocer y leer drops aunque FileList/types esten vacios; `dragPointToClient` convierte coordenadas nativas con la regla de plataforma compartida; `dropEffect` refleja cuando el harness no admite adjuntos. Refs de capacidad y callback mantienen una sola suscripcion Tauri al cambiar de harness. La suscripcion ignora eventos tras cleanup y desregistra si el registro asincrono termina despues del desmontaje. Las lecturas iniciadas por drop se siguen hasta completar; enviar espera a que terminen y usa la lista de adjuntos actual. Si cambia la capacidad, se desactiva el pane, se acepta un envio o se desmonta el Composer, la lectura obsoleta se descarta y sus previews se revocan.

Seis regresiones nuevas cubren items sin FileList/types, coordenadas Windows con DPI, capacidad live sin reinstalar listener, espera de lectura antes de enviar, descarte al desactivar y cleanup de registro tardio. Las pruebas focalizadas del Composer (incluyendo IME) pasan. `pnpm check-types`, `pnpm test` y `pnpm lint` pasan: 4624 frontend en 632 suites; 123 host con cinco omisiones; siete Cortex eval. Lint sin errores, 1635 warnings y 17 infos. La prueba nueva pasa `biome check`; no se cambian traducciones ni se agregan mensajes en ingles.

Se excluye el fallback de Markdown para review: `FilePane` enruta esas pestanas directamente a `GitDiffPane`, mientras `FileEditor` abre archivos normales; su prop de diff no tiene callers locales. Tambien se inspecciona el limite remoto: Composer no recibe una prop `remote`, `RemoteSession` lleva attachments por `uploadRemoteAttachments` y no hay productor activo local del evento de drag del Explorer. Por eso no se porta la guarda `remote` del listener de MonoCode. La cobertura de drops es DOM/happy-dom y coordenadas simuladas; no se ejecuta WebKit/Tauri nativo ni una conexion SSH real.

Siguiente: spellcheck nativo macOS; cambios de scroll/content-visibility y frame budget con medicion de navegador; cerrar el inventario de commits y paths restantes, manteniendo el SHA global fijo hasta completar la auditoria. Goal activo, sin push ni publicacion.

## Goal lote 4, hito 30: corrector nativo macOS

Se porta `514400dc` adaptando el punto de entrada local: `main.rs` registra `WebContinuousSpellCheckingEnabled` como default de `NSUserDefaults` antes de `voktty_lib::run()` crea el primer WebView. El registro de defaults mantiene cualquier preferencia persistida del usuario. Composer opta por spellcheck en su textarea principal; los campos que ya lo desactivaban explicitamente no cambian. `objc2-foundation` habilita `NSDictionary`, necesario para registrar el default. No se escribe una preferencia persistente ni se modifica el comportamiento de press-and-hold existente.

La prueba DOM del Composer confirma el atributo `spellcheck=true`. `pnpm check-types`, `pnpm lint` y `pnpm test` pasan: 4624 frontend en 632 suites; 123 host con cinco omisiones; siete Cortex eval. `cargo clippy --all-targets --locked -- -D warnings` pasa en Linux y `cargo nextest run --locked` pasa 1255 pruebas con una omision. `rustfmt --edition 2021 --check src-tauri/src/main.rs` pasa. `cargo fmt --manifest-path src-tauri/Cargo.toml --check` detecta formato previo en `modules/remote.rs` y `modules/tunnel/manager.rs`; esos archivos no forman parte de este hito.

El host solo tiene instalado `x86_64-unknown-linux-gnu`: la rama macOS de `main.rs`, la API AppKit y el subrayado del WebView no se compilan ni ejecutan aqui. La verificacion nativa queda pendiente de macOS; Clippy y nextest en Linux no cubren ese `cfg`.

Siguiente: revisar los cambios upstream de scroll/content-visibility y el frame budget con medicion de navegador; continuar la auditoria de commits y paths hasta cerrar el lote. Goal activo, sin push ni publicacion.

## Goal lote 4, hito 31: restauracion del scroll al reabrir transcript estacionado

Se adapta `b6e0db8` al `TranscriptPool` local: al estacionar un transcript se conserva la distancia del lector al final; al reabrir se restaura esa posicion, mientras que quien seguia el final continua alli. La marca `parked` se procesa aunque la sesion ya estuviera oculta, sin perder el atajo de render para props ocultas equivalentes. Se anade una regresion que reproduce la perdida del offset al retirar y reinsertar el contenedor.

La prueba focalizada `AgentTranscriptScroll.test.ts` pasa (19 tests). `pnpm check-types`, `pnpm test` y `pnpm lint` pasan: 4625 frontend en 632 suites; 123 host con cinco omisiones; siete Cortex eval. Lint sin errores, 1636 warnings y 17 infos. Formato de la prueba y `git diff --check` correctos. El test de scroll es DOM/happy-dom; aun falta medicion de layout y frames en navegador.

Auditoria parcial: Voktty no activa `content-visibility:auto` para `.transcript-turn`, asi que el retiro de placeholders y la prueba de scroll-range de `296d7fd` no requieren port. Los cambios de `b6e0db8` para firma visual con mascota son especificos de Mono; queda pendiente revisar su resto de estabilidad y los fades de `990f141`. Hay Chromium disponible pero no Playwright instalado; evaluar si se puede medir con el browser del entorno sin agregar dependencias. Siguiente: terminar el frame-budget/browser check y revisar fades e inventario restante. Goal activo, sin push ni publicacion.

## Goal lote 4, hito 32: fades en etiquetas y areas con scroll

Se adapta `990f141`: `TabLabel` mide clipping con `ResizeObserver` y activa el fade solo cuando el texto desborda; se usa en las pestanas de ventana y de archivos. La lista de sesiones y el transcript con composer acoplado reciben fade inferior; el padding adicional evita que el ultimo contenido quede bajo el fade. No se agregan cadenas ni se alteran rutas de tabs.

`pnpm check-types`, `pnpm test`, `pnpm lint` y `pnpm build` pasan: 4625 frontend en 632 suites; 123 host con cinco omisiones; siete Cortex eval; lint sin errores, 1637 warnings y 17 infos. Chromium headless carga el CSS de produccion y confirma overflow, las tres mascaras y `padding-bottom: 40px`. La comprobacion verifica CSS en Chromium, no WebKit ni el frame time del transcript completo. `git diff --check` correcto.

La medicion de frames queda registrada en el hito 33; el barrido de commits continua.

## Goal lote 4, hito 33: benchmark de fences y scroll del transcript

Se reproduce con Chromium CDP el fixture `tests/browser/markdown-performance` de MonoCode, con la misma muestra de 80 requisitos, viewport del fixture, CPU 4x, fade y criterio de espera hasta que acaba el resaltado. Voktty renderiza los 35.259 caracteres exactos; la primera linea de codigo conserva su nodo y se observa el fade. Resultado: 139 frames, p95 100 ms, maximo 116,7 ms y 45 frames mayores de 50 ms. El umbral Chromium del upstream es p95 <75 ms y maximo <150 ms: el maximo pasa y el p95 no.

El primer ensayo ad hoc termino antes de confirmar el DOM final y se descarta; el resultado anterior usa el criterio completo del test upstream. No se instala Playwright ni dependencias en MonoCode: su checkout no tiene `node_modules`, asi que no se obtiene control upstream en este host. El perfil local previo concentra actividad en `syncTranscriptViewport` y `onScroll`, pero no demuestra causalidad. Se prueba una guarda para no volver a asignar `scrollTop` al estar al fondo; no mejora el p95 y se revierte. La brecha del p95 queda abierta; no se declara equivalencia de frame budget. No se agrega dependencia ni fixture permanente.

## Goal lote 4, hito 34: navegacion accesible del explorador

Se portan las conductas aplicables de `bf5a30d` y `14cb1ed`: flechas, PageUp/PageDown, Home/End, abrir/cerrar carpetas, abrir archivos con Enter o Space, seleccion por prefijo y ciclo al repetir letra. La seleccion sigue usando las rutas y persistencia existentes; Cmd+Down activa la fila en macOS. Las filas enfocables muestran anillo visible y el interlineado de nombres protege descendentes sin cambiar la altura fija de fila. No se introduce acceso al filesystem ni contrato nuevo.

Cinco pruebas de DOM verifican desplazamiento, expansion y regreso al padre, apertura, prefijos y ciclo por letra. `pnpm check-types`, `pnpm test` y `pnpm build` pasan; suite completa: 4630 pruebas Vitest, 123 host correctas y cinco omisiones de plataforma. `pnpm lint` pasa sin errores, con 1637 warnings y 17 infos existentes. Biome check de la prueba y `git diff --check` correctos. El check aislado del archivo FileTree informa formato previo fuera del diff; no se reformatea codigo ajeno. Commit: `2cf30ca Add keyboard navigation to file tree`. Sin push.

Siguiente: verificar si el ticker de actividad expansible de `43602cd` tiene un equivalente interactivo pendiente en Voktty; auditar el tono de nombres settled de `8a63eb6`, barras Zen de `daaad71`, los cambios de scroll restantes de `b6e0db8` y los estados de commit de `6c67705`/`5a3aef0`. Resolver tambien la brecha de p95 antes de cerrar el lote 4. Goal activo; sin push ni avance del SHA global.

## Goal lote 4, hito 35: seleccion y apertura exacta desde cambios Git

Se porta `6c67705` al panel local: el boton de cada archivo ocupa toda la fila virtual de 30 px, y la seleccion del diff convierte la ruta relativa entregada por `git status` en ruta absoluta usando `repoRoot`. El callback marca esa ruta como exacta y evita escanear el indice del proyecto; el callback general de diffs mantiene la resolucion anterior si no recibe esa opcion. El fallback de apertura del panel tambien recibe la ruta absoluta. No se agregan traducciones ni dependencias.

`pnpm check-types`, `pnpm test`, `pnpm lint` y `pnpm build` pasan. Vitest: 4630 pruebas en 633 suites; host: 123 correctas y cinco omitidas; lint: cero errores, 1637 warnings y 17 infos. El test existente de `resolveFileOpenRequest` verifica que la ruta exacta no consulte el indice. `git diff --check` pasa. Commit: `06ab9ee Speed up source control diff opening`. Sin push.

Siguiente: terminar la auditoria del resto de `b6e0db8`, confirmar la equivalencia de `43602cd` y cerrar los cambios Mono-especificos `8a63eb6`/`daaad71` como exclusiones cuando corresponda. La brecha del p95 de Markdown sigue abierta: Voktty marca 100 ms frente al umbral upstream <75 ms, aunque el maximo cumple. No cerrar el goal ni declarar equivalencia de frame budget hasta resolverlo o agotar una investigacion con evidencia. Sin push ni publicacion.

## Goal lote 4, hito 36: cierre de auditoria y control upstream de frames

Se completa el barrido de los cambios pendientes del lote:

- `43602cd`: Voktty ya muestra la actividad de trabajo y ofrece `WorkFoldLine` con `aria-expanded` cuando existe contenido plegable. La interaccion local ya cubre la expansion del ticker; no requiere port.
- `8a63eb6`: cambios de tipografia ligados a la mascota y firma visual de Mono. Voktty no tiene esa identidad visual; se excluye.
- `daaad71`: ocultar la barra Zen es redundante con la regla global de scrollbars, que ya la oculta.
- `5a3aef0`: el textarea de commit de Voktty ya es editable sin archivos staged; la accion commit permanece deshabilitada hasta que haya contenido staged.
- `b6e0db8`: la retencion/restauracion al reabrir transcript se porto en el hito 31; el hold neutral de wheel de 150 ms ya existe localmente. El anclaje local por `ResizeObserver` protege cambios de altura con una implementacion distinta. Los estilos Mono y los ayudantes de depuracion temporal no se trasladan. Voktty no activa `content-visibility:auto` en los turnos.
- `6c67705`: apertura exacta desde el panel Git completada en el hito 35.

Se repite el fixture de streaming upstream sin dependencias nuevas, alternando tres rondas MonoCode/Voktty en Chromium CDP con la misma muestra de 80 requisitos, 35.259 caracteres y CPU 4x. Todos los resultados completan el texto, conservan la primera linea de codigo y retiran el fade. MonoCode registra p95 de 116,7, 116,7 y 150 ms, con maximos de 133,3, 133,4 y 266,7 ms. Voktty registra p95 de 100, 116,6 y 100,1 ms, con maximos de 116,6, 116,7 y 133,3 ms. Ambos fallan el umbral p95 <75 ms en este host; MonoCode tambien falla el maximo <150 ms en una ronda. Los controles upstream previos tambien superaron p95. La comparacion no muestra una regresion de Voktty y no sustenta otra optimizacion especulativa. No se declara cumplido el umbral ni equivalencia de frame budget.

Se detecto que un intento anterior de `pnpm exec` en el checkout temporal de MonoCode habia mezclado enlaces de `node_modules`; se alinearon los enlaces del entorno con `pnpm-lock.yaml`. Despues pasan `pnpm check-types` y `pnpm test`: 633 suites frontend y 4.630 pruebas; 123 pruebas host, cinco omisiones de plataforma, contratos Cortex y rutas portables correctos. No se modifico codigo de producto en este hito.

El lote 4 queda auditado para transcript, composer, Markdown, editor y arrastres hasta `d68bfa8`. Se retiran los fixtures y procesos temporales del benchmark. Esta entrada vive en `PROMPTS`, ignorado por Git; al ser un cierre de auditoria sin diff de producto, no genera commit. El commit de codigo mas reciente sigue siendo `06ab9ee`; no hay push ni avance del SHA global. La integracion de otros lotes y la validacion nativa Windows/macOS/SSH quedan fuera de este hito.

## Hito 37: identidad visual propia en la sesion vacia del Harness

Se sustituye `TerminalGridBackground` por `VokttySignal`: un trazo SVG en forma de V con pulsos discretos en los colores del tema. No tiene controles ni hit-testing, usa animaciones CSS ligeras y las desactiva con `prefers-reduced-motion`. Mantiene el interruptor de Ajustes y no cubre un fondo de chat personalizado. El copy del interruptor se actualiza en los doce locales, preservando la preferencia local ya guardada.

Verificacion: `pnpm check-types`, `pnpm test` (633 suites, 4630 pruebas), `pnpm lint` (sin errores; 1637 warnings y 17 infos), `pnpm build`, `pnpm check:i18n-coverage`, `pnpm check:i18n` y Biome lint focalizado correctos. Las pruebas de `EmptySession` y del ajuste pasan (17 pruebas focalizadas). `graphify update .` reconstruye 24063 nodos y 72407 aristas, con avisos conocidos del extractor. Un `biome check` sobre archivos completos de locales notifico formato previo fuera del cambio; no se reformataron los diccionarios. Sin smoke visual en Tauri/macOS/Windows.

Commit: `d764f18 Add Voktty signal to empty Harness sessions`. Hito funcional separado; sin push ni avance del SHA global.

Siguiente: decidir y documentar el alcance compatible de Mono y Artifacts (lote 5), y continuar el cierre fila por fila del inventario. La gestion remota del Harness queda ligada al agente SSH nativo de Voktty y tmux, segun la decision del usuario registrada arriba.

## Lote 5: decision de producto sobre Mono y Artifacts (2026-10-10)

Se inspecciona el checkout limpio de MonoCode `d68bfa8` en `/workspace/app_projects/monocode` y las superficies locales de notas, chat AI, Harness, agent-app y orquestacion.

- **Mono se difiere como producto nuevo, no se porta como parte del sync funcional 0.10.** Es un agente persistente con roster, proyectos, SOUL/MEMORY/temas, habitos programados, sesiones iniciadas y archivos privados bajo app-data. Voktty ya tiene perfiles/personas del agente AI, conversaciones AI y sesiones Harness, pero sus autoridades y ciclos de vida son distintos. Un port completo agregaria scheduler, memoria persistente y UI propia, por encima de una adaptacion de protocolos del Harness.
- **Artifacts se difiere del Harness.** Aunque MonoCode reutiliza su tabla `notes`, las tarjetas `artifactCards` estan ligadas a bloques del transcript Mono y su borrado actualiza tanto `mono_blocks` como `sessions`. Las sesiones Harness locales pertenecen a procesos proveedores externos, mientras el chat AI usa su propio store; reutilizar la tabla de notas no resuelve la autoridad ni el ciclo de vida de esas referencias.

Son funciones de producto validas para un goal separado, pero no se marcan como equivalentes ni se copian para cerrar paridad. Auditoria sin codigo y sin commit; no se avanza el SHA global. El usuario puede reabrir este alcance si decide que necesita agentes persistentes o documentos ligados al chat.

Siguiente: sacar la trazabilidad de actualizaciones del area ignorada `PROMPTS` a un mecanismo rastreado y reproducible, empezando por el inventario fijado y sus estados de revision. Mantener el checkout upstream como solo lectura.

## Hito 39: inventario MonoCode fijado y reproducible

Se mueve la fotografia de commits y rutas desde los archivos ignorados de `PROMPTS` a `integrations/monocode-010/`, con los SHAs upstream base/destino y el baseline local fijados en un manifiesto. `scripts/monocode/audit.mjs` reconstruye JSON y Markdown usando objetos Git existentes; `--check` solo compara el resultado y no escribe. No consulta HEAD ni archivos de trabajo para las comparaciones. Los merges se describen respecto de su primer padre. Se conservan las tres pruebas aisladas de merge textual anteriores, ejecutadas sobre archivos temporales fuera de ambos repositorios.

El inventario reproduce 102 commits y 374 rutas: 221 sin candidato por nombre, 149 diferentes, tres identicas y una ambigua. Coinciden las 374 correspondencias/estados y las tres pruebas de merge con el inventario previo. No certifica equivalencia funcional, no cambia el SHA global y no modifica MonoCode.

Verificacion: dos pruebas Node cubren estabilidad frente a worktrees modificados, limpieza de archivos temporales y rutas de commits merge; `node scripts/monocode/audit.mjs /workspace/app_projects/monocode --check` pasa. `pnpm check-types`, `pnpm test` (633 suites, 4630 pruebas) y `pnpm lint` pasan; lint conserva avisos existentes. `git diff --check` pasa. Commit: `2ffb495 Track MonoCode 0.10 integration inventory`. Sin push.

Siguiente (completado en Hito 40): registrar los ports funcionales existentes con sus SHAs, mapeos y pruebas ejecutables; despues continuar resolviendo el inventario sin mover el SHA global. En las superficies de gestion remota del Harness, usar el agente SSH nativo de Voktty con tmux y conservar soporte de hosts Docker.

## Hito 40: prueba repetible de ports funcionales

`integrations/monocode-010/ports.json` registra tres cambios Codex de MonoCode y su adaptacion en Voktty: preguntas asincronas (`98da85a`), omision de `collaborationMode` sin modelo (`c2b479d`) y prioridad del ejecutable descubierto por el shell (`db006a4`). Mapea los archivos fuente a su ubicacion modular local, conserva la referencia MIT y fija los tests focalizados de cada cambio.

El verificador `scripts/monocode/verify-ports.mjs` comprueba que los commits upstream pertenecen al rango fijado, que coinciden sus titulos, que los archivos cambiados corresponden a los mapeos, que las pruebas viven en el commit local y que el commit local esta en la linea actual. Confirma tambien que el LICENSE upstream es MIT. `--run-tests` permite solo los runners Vitest y cargo-nextest con filtros/path fijados en el manifiesto; no ejecuta comandos shell arbitrarios. El port que pertenece a la linea actual es `6d3ec03` sobre `e8cb8a4`; `c0952ff` es una linea separada y no se usa como prueba local de `main`. El inventario de Hito 39 conserva su baseline historico `3386eb4`.

Verificacion focalizada: mapeo validado para los tres commits; 21 tests de preguntas asincronas/lifecycle, cuatro de seleccion de modelo y un test Rust de prioridad del binario pasan mediante `--run-tests`. Una prueba Node comprueba el verificador con repositorios temporales y rechaza un mapeo local inexistente. `pnpm check-types`, `pnpm test` (633 suites, 4630 pruebas), `pnpm lint` y las dos pruebas Node del auditor pasan; lint conserva los avisos existentes. Sin cambio al codigo de producto ni al SHA global. Commit: `164531d Track verified MonoCode ports`. Sin push.

Siguiente: escoger el siguiente port funcional pendiente del inventario; revisar las fronteras host/SSH remotas con el agente nativo de Voktty y tmux cuando corresponda, preservando Docker. La revision debe mantener la regla de cerrar cada fila con comportamiento y tests, no por similitud de nombres.

## Hito 41: no reutilizar sesiones remotas restauradas como locales

Se adapta la parte aplicable de `b93b95a`: `isBlankSession` ahora considera siempre ocupada una sesion `remote://`, porque sus bloques locales pueden estar vacios antes de que llegue el transcript remoto. Al abrir un proyecto local, el Harness crea una sesion local en vez de reutilizar esa sesion remota. Una regresion en `projectReturn.test.ts` cubre el snapshot restaurado sin bloques.

La busqueda confirma que `remoteSessionTabs` y su asociacion por `remoteSessionFor` pertenecen a `src/modules/connections`, cuya UI actual se apoya en Host. Ese hunk queda parcial y pendiente de la fase de gestion remota; no se amplia el transporte Host. Cuando esa fase llegue, el flujo debe usar el agente SSH nativo de Voktty y tmux para recuperar sesiones, compatible con Docker.

Verificacion: la prueba focalizada de `projectReturn` pasa (21); `pnpm check-types` correcto; `pnpm test` correcto (633 suites, 4631 frontend, 123 pruebas host y cinco omisiones de plataforma); `pnpm lint` correcto con 1637 avisos y 17 infos existentes. `pnpm exec biome check` de los archivos afectados informa desorden de imports y formato anteriores fuera de las lineas cambiadas; la regla nueva sigue el formato local. Sin cambios Rust, build ni smoke SSH/Tauri en este hito. No se cierra aun la fila completa `b93b95a` ni se avanza el SHA global.

Siguiente: registrar la cobertura parcial en la trazabilidad y continuar el inventario con el siguiente port funcional; completar la asociacion de sesiones durante el hito de unificacion SSH/tmux.

## Hito 42: cobertura parcial visible en el ledger

`ports.json` incorpora `b93b95a` como parcial y enlaza su adaptacion de `isBlankSession` y la regresion local al commit `a699e88`. La entrada explica que el matching de pestañas y la limpieza de bindings de `connections` quedan para la unificacion con SSH nativo/tmux. `verify-ports.mjs` valida `complete`/`partial`, exige una lista no vacia de pendientes para filas parciales y devuelve el estado; los registros anteriores conservan `complete` por defecto. README y prueba del verificador describen/cubren el contrato.

Verificacion sobre el estado final: tres pruebas Node, cuatro commits upstream y cinco mapeos verificados; auditor reproduce 102 commits y 374 rutas. `pnpm check-types`, `pnpm test` (633 suites, 4631 frontend; host 123 correctas y cinco omisiones) y `pnpm lint` pasan; lint sin errores, 1637 avisos y 17 infos existentes. `git diff --check` correcto. Biome configura `scripts/` como ignorado, asi que no procesa esos dos archivos al invocar check directamente; pruebas Node validan su sintaxis y comportamiento. Sin push.

Siguiente: continuar la integracion de gestion remota en el Harness a traves del agente SSH nativo de Voktty, recuperacion tmux y soporte Docker; completar alli la fila parcial `b93b95a` sin adoptar el transporte remoto Node de MonoCode.

## Hito 43: trazabilidad del renderizado Markdown transmitido

El comportamiento de `d68bfa8` ya estaba adaptado en Voktty antes de revisar este port: cache incremental de tokens Shiki, conservacion de las lineas completas, reparacion de Markdown que deja intactos los fences y preservacion del bloque de codigo al terminar los fades. `ports.json` lo registra como completo y enlaza los cuatro commits locales que, en conjunto, cambiaron el codigo y sus pruebas. El verificador acepta ahora un port repartido entre varios commits locales y exige que mapeos y tests aparezcan en ellos y en el arbol actual. La prueba del verificador crea dos commits locales y valida el caso dividido.

Verificacion: inventario upstream reproducible (102 commits, 374 rutas); cinco commits upstream y doce mapeos validados; cuatro pruebas Node del auditor/verificador; 26 pruebas focalizadas de Markdown; `pnpm check-types`; `pnpm test` (633 suites, 4631 pruebas frontend, 123 pruebas Host y cinco omisiones de plataforma); `pnpm lint` sin errores, con 1637 avisos y 17 infos existentes; `git diff --check` correcto. No se modifico el codigo del producto ni el checkout upstream.

Revision de la siguiente fase remota: `src-tauri/src/modules/remote.rs` ya inicia `voktty-remote` por SSH y ofrece filesystem, Git y PTY; la PTY puede recuperar sesiones tmux sin depender de systemd. La superficie remota actual de `connections` sigue acoplada al protocolo de Host para catalogo de modelos, sesiones/transcripciones, comandos, adjuntos y cambios Git. El agente nativo no implementa ese RPC, asi que la migracion debe conectar esas operaciones al transporte/PTY nativo por etapas y retirar la instalacion de servicios Node de esa superficie, sin dejar una mezcla funcional. La etapa debe cubrir aprobacion de host keys, autenticacion SSH, sesiones tmux Docker y limpieza/reconexion. No se hizo ningun cambio remoto en este hito.

Siguiente: disenar y comenzar el adaptador de sesiones remotas Harness sobre el agente nativo, identificando la persistencia de conexiones y proyectos y el ciclo de PTY/tmux; despues completar la asociacion de pestañas pendiente de `b93b95a` con pruebas de recuperacion.

## Hito 44: columnas de tablas Markdown

`51b561b` pide un ancho minimo legible y alineacion superior para las celdas de tablas Markdown. Voktty ya tenia la misma regla en `src/styles/globals.css` desde `67075fb`, por lo que no se duplico el CSS. `ports.json` registra este port como completo y el README recuerda que una adaptacion puede estar repartida o ya existir en commits locales previos.

Verificacion: el verificador confirma seis commits upstream y trece mapeos; auditor/verificador no se cambiaron en este hito. No se modifico codigo ni se anadio una prueba para este ajuste de presentacion. `git diff --check` correcto.

Siguiente: revisar el siguiente commit funcional no cubierto del inventario; mantener la fase de gestion remota ligada al agente nativo y tmux documentada en Hito 43.

## Hito 45: dos regresiones de interfaz ya cubiertas

Se verificaron dos cambios recientes del upstream contra Voktty. `829fede` (arrastre que no recibe `pointerup`) ya esta cubierto por `useSortable`, que cancela el gesto si el mouse vuelve a moverse sin botones y comprueba la identidad del puntero. `fd10730` (resumen de pensamiento duplicado al abrir la fila) ya esta cubierto con la etiqueta localizada `Thinking`. Ambos commits, sus archivos locales y regresiones se registran completos en `ports.json`.

Verificacion: pruebas focalizadas de `useSortable` y `AgentTranscriptThinking`; auditor upstream reproducible; ocho commits upstream y diecisiete mapeos verificados; `git diff --check` correcto. No hubo cambios de codigo de producto.

Siguiente: continuar el barrido de commits funcionales pendientes. La migracion remota permanece como una fase separada de arquitectura, sin volver a instalar el Host Node remoto.

## Hito 46: editor de mensaje de commit durante acciones Git

Se adapta `5a3aef0` en el panel Source Control de Voktty. El editor sigue disponible sin archivos staged y se desactiva mientras hay una accion Git en curso; el boton de commit conserva la validacion independiente de archivos staged y mensaje no vacio. Los cambios vecinos `7c4bb7e` (preferencias de carpetas para sesiones Mono) y `6ec7c52` (panel de commit de Mono) se excluyen por la decision de producto del Lote 5: no son cambios del Harness portables.

Verificacion: `pnpm check-types`; `pnpm test` (633 suites, 4631 pruebas frontend, 123 pruebas Host y cinco omisiones de plataforma); `pnpm lint` sin errores, con 1637 avisos y 17 infos existentes; `git diff --check`. Commit: `9a853fa Guard commit message edits while Git is busy`. No push.

## Hito 47: trazabilidad del editor de mensaje de commit

`ports.json` enlaza el cambio upstream `5a3aef0` con `SourceControlPanel.tsx` y el commit `9a853fa`; la regla completa queda registrada. No se agrega una prueba duplicada para esta propiedad de un campo existente. Los dos cambios Mono-only revisados se quedan fuera de la cobertura del Harness.

Verificacion: el verificador confirma nueve commits upstream y dieciocho mapeos; las cuatro pruebas Node del auditor y del verificador pasan; `git diff --check` correcto. Commit: `6b8aba8 Track commit message port coverage`. Sin push.

## Hito 48: trazabilidad de ports anteriores al baseline

El baseline local del ledger es posterior a tres adaptaciones ya presentes en Voktty: titulo vivo y animacion de ParticleText (`29b131d`), entrada animada de sesiones en el sidebar (`be44264`) y uso restante del chip de proveedor (`26991a7`). El verificador acepta ahora `basis: preexisting` y comprueba que sus commits sean ancestros del baseline y que los archivos mapeados y tests existieran en ese arbol. Las filas siguen siendo verificables sin mover el baseline ni fingir que esos cambios se hicieron dentro del lote actual.

Verificacion: cuatro archivos de pruebas focalizadas, 60 pruebas correctas; `pnpm check-types`; `pnpm test` (633 suites y 4631 pruebas frontend; 123 Host correctas y cinco omisiones de plataforma); `pnpm lint` sin errores, con 1637 avisos y 17 infos; cinco pruebas Node de auditor/verificador; inventario upstream reproducible (102 commits y 374 rutas); verificador confirma doce commits upstream y 29 mapeos; `git diff --check`. El efecto inicial de Voktty sigue siendo `VokttySignal`, incorporado en Hito 37. Commit: `f5c0b46 Verify preexisting MonoCode port coverage`. Sin push ni cambios de codigo de producto.

## Hito 49: animacion del panel de work item

Se completa la adaptacion de `ce656ba`: `InboxDetailPane` entra con deslizamiento y revela el contenido al cambiar de issue o PR. El estado de animacion ignora finales obsoletos si cambia la seleccion rapidamente; `prefers-reduced-motion` desactiva las animaciones. Tres pruebas cubren la seleccion estable, el cambio y la retirada del item.

Verificacion: prueba focalizada (3); `pnpm check-types`; `pnpm test` (634 suites, 4634 pruebas frontend, 123 pruebas Host correctas y cinco omisiones de plataforma); `pnpm lint` sin errores, con 1637 avisos y 17 infos; `git diff --check`. Commit: `d56d01f Animate linked work item detail panel`. Sin push.

Siguiente: registrar el port `ce656ba` y las adaptaciones anteriores al baseline del selector de permisos y entrada de panel; luego continuar el barrido funcional. La migracion remota sigue pendiente como hito de arquitectura sobre el agente SSH nativo y tmux.

## Hito 50: trazabilidad de animaciones y selector de permisos

`ports.json` enlaza `ce656ba` con la animacion recien adaptada en `d56d01f`. Tambien registra como `preexisting` el ingreso animado de paneles (`45c9a22`, local `e7f7edd`) y la extraccion del selector de permisos (`dcaba3d`, local `ce17855`); el verificador confirma que sus commits, codigo y pruebas existian en el baseline fijado.

Verificacion: prueba focalizada de los tres cambios (10); cinco pruebas Node del auditor y verificador; inventario estable (102 commits, 374 rutas); verificador confirma 15 commits upstream y 40 mapeos; `git diff --check`. Commit: `1888d6e Track panel and picker port coverage`. Sin cambios de codigo de producto ni push.

Siguiente: revisar el proximo cambio funcional del rango fijado. La migracion remota aun requiere un hito propio sobre el agente SSH nativo de Voktty, tmux y hosts Docker.

## Hito 51: apertura exacta desde la lista de cambios

`6c67705` ya estaba adaptado en Voktty por `06ab9ee`: la fila de Source Control ofrece un area completa para abrir el diff, y los paths se resuelven como rutas exactas ancladas a la raiz del repositorio para evitar la espera del indice y conservar archivos ignorados. La regresion existente de `fileIndex` comprueba la apertura exacta cuando el path no esta indexado.

Verificacion: prueba focalizada de `fileIndex` (16); cinco pruebas Node de auditor/verificador; inventario estable (102 commits, 374 rutas); verificador confirma 16 commits upstream y 44 mapeos; `git diff --check`. Commit: `d2dff41 Track source control path opening port`. Sin cambios de codigo de producto ni push.

Siguiente: seguir con el siguiente port funcional del rango; reservar la migracion SSH/Tmux como hito de arquitectura del Harness.

## Hito 52: animacion de opciones de esfuerzo en otros Harness

Se extiende el efecto visual de las opciones `max` y `ultra` a los controles de esfuerzo de Codex, OpenCode (`variant`), Claude y Cursor. La regla ya no depende del proveedor; se reconocen los cuatro IDs de setting y se conserva sin efecto para valores y controles que no expresan esfuerzo.

Verificacion: prueba focalizada de ModelPicker (8); `pnpm check-types`; `pnpm test` (634 suites, 4639 pruebas frontend, 123 pruebas Host correctas y cinco omisiones de plataforma); `pnpm lint` sin errores, con 1637 avisos y 17 infos existentes; `git diff --check`. Commit: `8bf442b Animate effort choices across harnesses`. Sin push.

Siguiente: registrar el port `40aa9fe` y continuar con el siguiente cambio funcional. El hito de atajos del terminal de proyecto y la migracion SSH/tmux permanecen pendientes.

## Hito 53: trazabilidad del efecto de esfuerzo

`ports.json` registra `40aa9fe` y lo enlaza con `ModelPicker` y su prueba en el commit `8bf442b`. La adaptacion conserva la agrupacion propia de settings de Voktty y cubre Codex, OpenCode, Claude y Cursor.

Verificacion: verificador confirma 17 commits upstream y 46 mapeos; cinco pruebas Node de auditor/verificador; inventario estable (102 commits, 374 rutas); `git diff --check`. Commit: `0519d79 Track effort animation port coverage`. Sin cambios de codigo de producto ni push.

Siguiente: continuar el barrido funcional. Pendiente el port de atajos del terminal de proyecto y, despues, la integracion remota Harness por el agente SSH nativo con recuperacion tmux en Docker.

## Hito 54: brecha de atajos del terminal de proyecto

La comparacion de `3597485` confirma cobertura parcial. Voktty enruta `⌘/Ctrl+W` al terminal si `projectTerminalFocused` esta activo, pero `⌘/Ctrl+T` sigue creando una pestaña de workspace. El dock solo actualiza el foco por mouse; el cierre no comprueba que el elemento activo siga dentro del dock. Se registra esta diferencia y el hunk de menus nativos como pendiente de una superficie equivalente, sin afirmar paridad.

Verificacion: prueba enfocada del modelo de terminal (14); cinco pruebas Node de auditor/verificador; auditoria del rango fijado (102 commits, 374 rutas); verificador confirma 18 commits upstream y 50 mapeos; `git diff --check`. Commit: `ad1fbf8 Track focused project terminal shortcut gap`. Sin codigo de producto ni push.

Siguiente: Hitos 55 y 56 completan los atajos contextuales del terminal de proyecto. Continuar el barrido funcional; al llegar a la gestion remota del Harness, usar el agente SSH nativo de Voktty y tmux, compatible con Docker.

## Hito 55: atajos contextuales para terminal de proyecto

Se completa `3597485`: `⌘/Ctrl+T` crea otro terminal cuando el dock del proyecto es el destino enfocado; `⌘/Ctrl+W` cierra su terminal activo. El enrutamiento requiere layout de proyectos, dock abierto, marca de foco y `document.activeElement` dentro del dock. `ProjectTerminalDock` registra el foco por teclado, y el cierre de un panel de workspace ya no puede desviarse al dock por una marca de foco antigua. Crear un workspace nuevo limpia el foco del dock.

Verificacion: prueba focalizada de `projectTerminal.test.ts` (15); `pnpm check-types`; `pnpm test` (634 suites frontend y 4640 pruebas; Host 123 correctas y cinco omisiones de plataforma; siete pruebas Cortex eval); `pnpm lint` sin errores, con 1637 avisos y 17 infos; `git diff --check`. La arquitectura local no tiene productor de comandos nativos `new_tab`/`close_tab`; los listeners existentes pasan por los mismos handlers contextuales. Commit: `b74c021 Route focused project terminal shortcuts`. Sin push.

## Hito 56: cobertura completa de atajos del terminal

`ports.json` enlaza `3597485` con `b74c021`, registra la regresion enfocada y elimina la cobertura parcial. El hunk nativo de MonoCode no tiene equivalente de menu en Voktty; la cobertura corresponde a sus atajos globales y al puente de eventos ya existente.

Verificacion: auditor del inventario fijado confirma 102 commits y 374 rutas; verificador confirma 18 commits upstream y 50 mapeos; cinco pruebas Node de auditor/verificador; `git diff --check`. Commit: `134399e Complete focused terminal shortcut port coverage`. Sin cambios de codigo de producto ni push.

Siguiente: comparar sistematicamente el port OpenCode 2.x `0eb2773` con el soporte V2 ya existente en Voktty; mantener la gestion remota como hito de arquitectura sobre el agente SSH nativo, tmux y hosts Docker.

## Hito 57: regresion para refresco forzado de catalogos

La capacidad `force` de `refreshHarnessCatalogs` ya estaba en el registro de Harness de Voktty; el selector de OpenCode la usa al abrir Settings. Se agrega la regresion que comprueba que una accion explicita vuelve a consultar el catalogo aunque ya haya una lista viva, mientras los refrescos ordinarios siguen evitando el segundo probe.

Verificacion: `registry.test.ts` focalizado (9); `pnpm check-types`; `pnpm test` (634 suites frontend y 4641 pruebas, 123 Host correctas y cinco omisiones de plataforma; siete pruebas Cortex eval); `pnpm lint` sin errores, 1637 avisos y 17 infos; prueba nativa `cargo nextest run --locked service_commands_require_the_resolved_opencode_provider` (1 correcta); `git diff --check`. Commit: `26dadaa Test forced Harness catalog refresh`. Sin push.

## Hito 58: evaluacion del port OpenCode 2.x

La comparacion de `0eb2773` con Voktty confirma adaptacion del transporte desktop, deteccion de version, servicio autenticado, catalogo/agentes, prompts, permisos y preguntas, traduccion/correlacion de eventos, compaction, sesiones retomadas y limpieza de sesiones temporales. El proceso Host limita los comandos `service` a OpenCode y a proyectos autorizados. El registro local ya admitia refresco forzado antes de este port; `HarnessSection` lo invoca y Hito 57 protege la ruta. `ports.json` registra el port como parcial solo porque la gestion de sesiones remotas debe pasar por el agente SSH nativo y tmux de Voktty, con recuperacion Docker validada; no se adopta la ruta remota Node de MonoCode.

Verificacion: `pnpm test` con 634 suites y 4641 pruebas frontend; Host 123 correctas y cinco omisiones; chequeo de tipos e i18n correctos; `pnpm lint` sin errores, 1637 avisos y 17 infos. El test nativo de allowlist OpenCode pasa. Verificador confirma 19 commits upstream y 69 mapeos; los cinco tests Node de auditor/verificador pasan; auditor del rango fija 102 commits y 374 rutas; `git diff --check`. Commit: `bc3557d Track OpenCode 2 port coverage`. Sin prueba de servicio OpenCode real, SSH remoto ni reconnect Docker; sin push.

Estado: 19/102 commits del rango registrados, 17 completos y dos parciales (`b93b95a` y `0eb2773`); 69 mapeos validados. Esta proporcion no representa porcentaje de esfuerzo o paridad. El SHA global de sincronizacion sigue fijo.

Siguiente: revisar el siguiente commit funcional no registrado del inventario; conservar `b93b95a` y OpenCode remoto para el hito del agente nativo SSH/tmux compatible con Docker.

## Hito 59: registro parcial del timeline de issues y PRs

`00d68d3` ya estaba adaptado antes del baseline: timeline cronologico de comentarios y commits, cache GitHub con frescura, resumen de PR, archivos modificados y apertura del diff en el path enfocado. La diferencia no aplica directamente a la navegacion actual de Voktty: MonoCode abre un panel desde el work item enlazado en una fila de sesion; Voktty abre el detalle desde la seleccion de Inbox y no muestra esa accion en sus filas de sesion. El ledger conserva el port como parcial y deja el prefetch de esa ruta para una futura adaptacion de flujo, sin hacer peticiones extra desde cada tarjeta de Inbox.

Verificacion: auditor upstream estable (102 commits, 374 rutas); verificador confirma 20 commits upstream y 77 mapeos; cinco pruebas Node de auditor y verificador; `git diff --check`. No hubo cambios de codigo de producto ni se ejecutaron las suites frontend por ser un cambio de trazabilidad. Commit: pendiente. Sin push.

Siguiente: revisar `31fcb09` (truncado de etiquetas del selector de modelos) y seguir el inventario funcional; mantener los ports de SSH/tmux y Docker como hito remoto dedicado.

## Hito 60: etiquetas completas en el selector de modelos

Se adapta `31fcb09`: el disparador del selector mantiene el ancho intrinseco y muestra el nombre activo en una linea, sin truncarlo. Una regresion comprueba las clases del disparador y la etiqueta renderizada.

Verificacion: prueba focalizada de `ModelPicker.test.ts` (8); `pnpm check-types`; `pnpm test` (634 suites, 4641 pruebas frontend; Host 123 correctas y cinco omisiones de plataforma; siete pruebas Cortex eval); `pnpm lint` sin errores, con 1637 avisos y 18 infos; `git diff --check`. Commit: pendiente. Sin push.

Siguiente: registrar `31fcb09` en `ports.json` y seguir el inventario funcional. La integracion remota del Harness sigue reservada para el agente SSH de Voktty y la recuperacion con tmux en Docker.

## Hito 61: trazabilidad del selector de modelos

`ports.json` registra `31fcb09` como completo y lo enlaza con `d7117c1` y `ModelPicker.test.ts`. El commit upstream solo cambia el componente; la prueba local protege que el nombre activo quede en una linea y el boton no limite su ancho.

Verificacion: cinco pruebas Node de auditor/verificador; auditor upstream estable (102 commits, 374 rutas); verificador confirma 21 commits upstream y 78 mapeos; `git diff --check`. Commit: pendiente. Sin cambios adicionales de codigo ni push.

Estado: 21/102 commits registrados, 18 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 78 mapeos validados. El porcentaje de commits no mide esfuerzo ni paridad.

Siguiente: revisar `fb55b25` (acciones de staging por carpeta en Git Changes) y continuar el inventario funcional. El transporte remoto Harness sigue pendiente como hito del agente SSH nativo con recuperacion tmux en Docker.

## Hito 62: staging y unstaging por carpeta

`fb55b25` queda adaptado en Source Control. Las filas de carpeta muestran estado checked/indeterminate/unchecked y permiten stage/unstage de los archivos accionables del subarbol exacto. El hook aplica la actualizacion optimista, invalida diffs y reconcilia el status usando `git_stage`/`git_unstage` existentes con `WorkspaceEnv`; no se agrega IPC ni una operacion que convierta el path de carpeta en un scope mas amplio.

Verificacion: tests focalizados del arbol y hook (13); `pnpm check-types`; `pnpm test` (634 suites, 4645 pruebas frontend; Host 123 correctas y cinco omisiones de plataforma; siete pruebas Cortex eval); `pnpm lint` sin errores, con 1637 avisos y 18 infos; formato de `tree.test.ts`; `git diff --check`. El `biome check` manual encuentra reglas de formato/imports anteriores en secciones no editadas de los dos archivos grandes; el lint requerido pasa. Commit de codigo: `cb6fb34 Add folder staging actions to source control`. Sin push.

Siguiente: registrar `fb55b25` en el ledger como una adaptacion de UI sobre el IPC de Git existente y continuar el barrido.

## Hito 63: trazabilidad del staging por carpeta

`ports.json` registra `fb55b25` como completo y enlaza la UI y el hook de Source Control, el modelo del arbol y su prueba con `cb6fb34`. La parte nativa de MonoCode no requiere un nuevo port: Voktty pasa cada archivo cambiado del subarbol al IPC Git existente, con autorizacion y `WorkspaceEnv`.

Verificacion: auditor upstream estable (102 commits, 374 rutas); verificador confirma 22 commits upstream y 82 mapeos; cinco pruebas Node de auditor/verificador; `git diff --check`. Estado: 22/102 commits registrados, 19 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 82 mapeos. No hubo cambios de codigo ni push.

Siguiente: revisar `14cb1ed` (preservar descendentes en nombres de archivo del explorador) y seguir el inventario funcional. Se mantiene el hito remoto Harness con agente SSH nativo, tmux y validacion Docker.

## Hito 64: registro de altura de linea del explorador

`14cb1ed` queda como cobertura preexistente. MonoCode necesitaba elevar la linea porque su etiqueta truncada heredaba `leading-none`; el `TreeRow` de Voktty no aplica esa clase y usa la altura de linea normal dentro de una fila de 22 px. El verificador lo registra con `a7888fc`, una revision local anterior al baseline que contiene la implementacion.

Verificacion: cinco pruebas Node de auditor/verificador; auditor upstream estable (102 commits, 374 rutas); verificador confirma 23 commits upstream y 83 mapeos; `git diff --check`. Sin cambios de codigo ni push.

Estado: 23/102 commits registrados, 20 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 83 mapeos validados.

Siguiente: continuar con `6a5f7fa` (volver a respuestas anteriores en el panel de preguntas) y revisar la cobertura de interaccion del Harness.

## Hito 65: volver a respuestas anteriores

Se adapta `6a5f7fa`: el formulario de preguntas muestra `Back` desde el segundo paso y usa la traduccion comun de Voktty. Las respuestas se conservan por id al retroceder; una prueba interactiva avanza, vuelve, corrige la primera opcion y comprueba el payload final.

Verificacion: `QuestionForm.test.ts` (3); `pnpm check-types`; `pnpm test` (634 suites, 4646 pruebas frontend; Host 123 correctas y cinco omisiones; siete pruebas Cortex eval); `pnpm lint` sin errores, con 1637 avisos y 18 infos; `git diff --check`. Commit: `5756f08 Allow revisiting Harness questions`. Sin push.

Siguiente: registrar `6a5f7fa` y su prueba focalizada en `ports.json`, verificar el historial y continuar el inventario.

## Hito 66: trazabilidad de volver a preguntas anteriores

`ports.json` registra `6a5f7fa` como completo y enlaza ambos archivos upstream con `QuestionForm.tsx`, la prueba interactiva local y el commit `5756f08`. La prueba confirma que volver conserva la seleccion anterior y que el resultado final contiene la respuesta actualizada.

Verificacion: `verify-ports.mjs --run-tests` correcto (24 commits upstream, 85 mapeos y 23 comandos de prueba); cinco pruebas Node de auditor/verificador; auditoria estable (102 commits, 374 rutas); `git diff --check`. Commit de trazabilidad: pendiente. Sin push.

Estado: 24/102 commits registrados, 21 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 85 mapeos validados. Esta proporcion no representa porcentaje de esfuerzo ni paridad.

Siguiente: revisar `e188ff1` (paletas accesibles y marcadores +/- en diffs) comparandolo con el soporte de diff existente en Voktty. La gestion remota del Harness sigue reservada para el agente SSH nativo, tmux y validacion Docker.

## Hito 67: completar paletas accesibles y marcadores de diff

La comparacion de `e188ff1` confirma que Voktty ya habia adaptado las paletas default/colorblind/high-contrast, sus tokens globales, preferencias persistidas, marcadores `+`/`−`, y los conteos y colores de los diffs, previews, editor y Source Control. Las diferencias corresponden a la arquitectura local: la preferencia esta en la pestaña Harness y el CSS usa las clases de tema `light`/`dark` de Voktty. El barrido detecto que faltaba el acceso desde Settings Search; `ba72e96` agrega palabras clave y un ancla para que la busqueda abra y resalte la fila del selector.

Verificacion: cinco pruebas focalizadas de preferencias, selector, gutter, UnifiedDiff y Settings Search (22); `pnpm check-types`; `pnpm test` (634 suites, 4647 pruebas frontend; Host 123 correctas y cinco omisiones; siete pruebas Cortex eval); `pnpm lint` sin errores, con 1637 avisos y 18 infos; `git diff --check`. `verify-ports.mjs --run-tests` valida 25 commits upstream, 103 mapeos y 24 comandos de prueba; cinco pruebas Node de auditor/verificador; auditoria estable (102 commits, 374 rutas). Commit funcional de la brecha: `ba72e96 Expose diff palette in settings search`. Commit de trazabilidad: pendiente. Sin push.

Estado: 25/102 commits registrados, 22 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 103 mapeos. Esta proporcion no representa porcentaje de esfuerzo ni paridad.

Siguiente: revisar `e65ed823` (abrir diffs Markdown como fuente en lugar de preview) y seguir el inventario. La gestion remota del Harness continua pendiente como hito propio sobre el agente SSH de Voktty, tmux y recuperacion Docker.

## Hito 68: diffs Markdown en modo fuente

Se adapta `e65ed823`: el `FileEditor` separa la preferencia normal de Markdown de la preferencia de revision y, al abrir una revision, usa `source` como modo inicial. Voktty ya enruta las pestañas de revision por `GitDiffPane`, que muestra el codigo fuente; el cambio cubre tambien el modo opcional de diff de `FileEditor`. La prueba interactiva confirma preferencias independientes y conserva los cambios de cada modo.

Verificacion: prueba focalizada `MarkdownModeToggle.test.tsx` (1); `pnpm check-types`; `pnpm test` (635 suites, 4648 pruebas frontend; Host 123 correctas y cinco omisiones; siete pruebas Cortex eval); `pnpm lint` sin errores, con 1637 avisos y 18 infos; `git diff --check`. Commit funcional: `f7d8d85 Open Markdown diffs in source mode`. Sin push.

## Hito 69: trazabilidad del modo fuente en diffs Markdown

`ports.json` enlaza `e65ed823` con `f7d8d85`, sus dos superficies Harness y la prueba de preferencias de Markdown.

Verificacion: `verify-ports.mjs --run-tests` correcto (26 commits upstream, 105 mapeos y 25 comandos de prueba); cinco pruebas Node de auditor/verificador; inventario estable (102 commits y 374 rutas); `git diff --check`. Commit de trazabilidad: `eadbd90 Track Markdown diff source mode port`. Sin push.

Estado: 26/102 commits registrados, 23 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 105 mapeos. La proporcion de commits no representa esfuerzo ni paridad. Los registros de los hitos 66 y 67 estan en `cdd767d` y `9815cd4`.

Siguiente: revisar `e9fd233` (deteccion del agente Pi instalado por npm) en el Host Rust de Voktty; mantener toda la gestion SSH remota en el agente nativo de Voktty con recuperacion tmux para hosts Docker.

## Hito 70: deteccion de Pi instalado por npm en el agente nativo

Se adapta `e9fd233` dentro del Host Rust de Voktty. Para el alias ambiguo `pi`, el agente conserva el escaneo rapido, resuelve symlinks y busca hasta seis niveles un `package.json` con el nombre exacto de uno de los paquetes soportados, leyendo como maximo 64 KiB. Si no hay manifiesto valido, queda el probe `--help` existente. Las regresiones cubren el stub npm con symlink y el rechazo de un paquete de nombre parecido; la resolucion permanece dentro del agente nativo que Voktty usa para sus sesiones remotas.

Verificacion: dos pruebas nextest focalizadas; `pnpm check-types`; `pnpm test` (635 suites, 4648 pruebas frontend; Host 123 correctas y cinco omisiones; siete pruebas Cortex eval); `pnpm lint` sin errores, 1637 avisos y 18 infos; `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1257 correctas, una omitida); `git diff --check`; rustfmt focalizado de los archivos cambiados. `cargo fmt --check` a nivel de crate sigue fallando por formato existente en `modules/remote.rs`, `ssh_native/connection.rs` y `tunnel/manager.rs`; ninguno de esos archivos pertenece al hito. Commit funcional: `f9bb570 Detect npm-installed Pi agents in native Host`. Sin push.

Siguiente: cerrar la trazabilidad de `e9fd233` en `ports.json` y continuar con `a541016` (enfocar el buscador de modelos cuando aparece el flyout).

## Hito 71: trazabilidad del agente Pi instalado por npm

`ports.json` registra `e9fd233` completo y lo enlaza con el Host Rust, el modulo local de inspeccion del manifiesto y las dos regresiones del agente nativo. La deteccion no ejecuta el launcher cuando el manifiesto confirma un paquete admitido; un nombre npm parecido no se acepta.

Verificacion: `verify-ports.mjs --run-tests` correcto (27 commits upstream, 109 mapeos y 27 comandos de prueba); cinco pruebas Node de auditor/verificador; inventario estable (102 commits y 374 rutas); JSON valido y `git diff --check`. Commit de trazabilidad: pendiente. Sin codigo de producto ni push.

Estado: 27/102 commits registrados, 24 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 109 mapeos. La proporcion de commits no representa esfuerzo ni paridad.

Siguiente: revisar `a541016` (enfocar el buscador de modelos despues de mostrar el flyout) y seguir el inventario funcional. La gestion remota del Harness sigue pendiente como hito sobre el agente SSH de Voktty, tmux y recuperacion en Docker.

## Hito 72: foco del buscador del selector de modelos

Se adapta `a541016`: al abrir el submenu de modelos, el buscador recibe foco en el siguiente frame, despues de que `Popover` termina de medir y mostrar la superficie anclada. El efecto cancela el frame si el flyout se desmonta. Una prueba interactiva comprueba que el foco no salta antes del frame y que llega al buscador al ejecutarlo.

Verificacion: prueba focalizada `ModelPicker.focus.test.tsx` (1); `pnpm check-types`; `pnpm test` (636 suites, 4649 pruebas frontend; Host 123 correctas y cinco omisiones; siete pruebas Cortex eval); `pnpm lint` sin errores, con 1637 avisos y 18 infos; `git diff --check`. Commit funcional: `63b7aeb Focus model search after flyout appears`. Sin push.

## Hito 73: trazabilidad del foco en el selector

`ports.json` registra `a541016` y lo enlaza con el `ModelPicker` local y su regresion interactiva. La app local tiene un solo call site del `ModelFlyout`; el comportamiento cubre esa ruta.

Verificacion: `verify-ports.mjs --run-tests` correcto (28 commits upstream, 111 mapeos y 28 comandos de prueba); cinco pruebas Node de auditor/verificador; inventario estable (102 commits y 374 rutas); JSON valido y `git diff --check`. Commit de trazabilidad: `349ff70 Track model search focus port`. Sin codigo de producto ni push.

Estado: 28/102 commits registrados, 25 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 111 mapeos. La proporcion de commits no representa esfuerzo ni paridad.

Siguiente: revisar `c7de48f` (descubrir modelos de Pi registrados por extensiones) y mantener la gestion remota del Harness con el agente SSH de Voktty, tmux y recuperacion Docker.

## Hito 74: descubrir modelos registrados por extensiones de Pi

Se adapta `c7de48f`: las consultas del catalogo de Pi cargan extensiones para descubrir modelos que estas registran. Las consultas de OMP mantienen `--no-extensions`; ambas conservan `--no-session`. El refresh del catalogo se solicita por proveedor, asi que la carga potencialmente costosa de extensiones ocurre al abrir Pi y no como probe global al inicio.

Verificacion: prueba focalizada (2); `pnpm check-types`; `pnpm test` (637 suites, 4651 pruebas frontend; Host 123 correctas y cinco omisiones de plataforma; siete pruebas Cortex eval); `pnpm lint` sin errores; `git diff --check`. Commit funcional: `5ff55e2 Discover Pi extension models`. Sin push.

## Hito 75: trazabilidad del catalogo de extensiones Pi

`ports.json` registra `c7de48f` completo, con mapas para catalogo y prueba local. La regresion confirma que Pi descubre extensiones y que OMP conserva su aislamiento.

Verificacion: `verify-ports.mjs --run-tests` correcto (29 commits upstream, 113 mapeos y 29 comandos de prueba); cinco pruebas Node de auditor/verificador; inventario estable (102 commits y 374 rutas); JSON valido y `git diff --check`. Commit de trazabilidad: `547e827 Track Pi extension model discovery port`. Sin codigo de producto ni push.

Estado: 29/102 commits registrados, 26 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 113 mapeos. Esta proporcion no representa porcentaje de esfuerzo ni paridad.

Siguiente: revisar `32fb2d1` y sus padres de merge para elegir el siguiente cambio funcional que entre en el baseline, y continuar el barrido. La gestion remota Harness sigue reservada al agente SSH nativo de Voktty, con recuperacion tmux y validacion en Docker.

## Hito 76: revision del merge `32fb2d1`

Se revisan ambos padres y el diff contra el primer padre. El merge integra la linea de commits que ya se registraron por separado (staging por carpeta, paletas de diff, modo fuente Markdown, resolucion Pi y modelos de extensiones). No requiere un port de codigo independiente: la unica diferencia funcional que parecia pendiente era el test MonoCode de descenders, y `TreeRow` ya usa `leading-[1.4]`; `CHANGELOG.md` no tiene comportamiento de producto que trasladar. Se mantiene el registro por cambios fuente y no se crea una entrada duplicada de merge.

## Hito 77: diffs de merge requests en GitLab antiguo

Se adapta `e994afb`: si `/diffs` responde HTTP 404, Voktty consulta `/changes`, extrae `changes` y considera `overflow` junto con la paginacion al marcar el resultado como truncado. Los errores 401/403, 429 y 500 no disparan fallback. El contrato Tauri existente y el cliente configurado con timeout y sin redirecciones se conservan. Pruebas con un servidor HTTP local cubren la instancia antigua, el endpoint moderno y errores distintos de 404.

Verificacion: tres pruebas nextest focalizadas; `pnpm check-types`; `pnpm test` (637 suites, 4651 pruebas frontend; Host 123 correctas y cinco omisiones; siete pruebas Cortex eval); `pnpm lint` sin errores (1637 avisos, 18 infos); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1260 correctas, una omitida); rustfmt focalizado; `git diff --check`. Commit funcional: `9fca835 Support old GitLab merge request diffs`. Sin push.

## Hito 78: trazabilidad del fallback GitLab

`ports.json` registra `e994afb` como completo y lo enlaza con el modulo GitLab nativo y sus tres regresiones de transporte HTTP.

Verificacion: `verify-ports.mjs --run-tests` correcto (30 commits upstream, 114 mapeos y 30 comandos de prueba); cinco pruebas Node de auditor/verificador; inventario estable (102 commits y 374 rutas); JSON valido y `git diff --check`. Commit de trazabilidad: `dc19654 Track legacy GitLab diff fallback port`. Sin codigo de producto ni push.

Estado: 30/102 commits registrados, 27 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 114 mapeos. Esta proporcion no representa porcentaje de esfuerzo ni paridad. El merge `32fb2d1` se reviso como composicion de cambios ya trazados y no cuenta como port independiente.

Siguiente: revisar `43602cd` (hacer expandible el ticker de actividad en vivo) y continuar el inventario funcional. La conexion remota de gestion Harness se mantiene reservada al agente SSH nativo de Voktty, tmux y recuperacion Docker.

## Hito 79: trazabilidad de actividad expandible

`ports.json` registra `43602cd` completo sobre la implementacion preexistente de Voktty. El transcript local muestra la actividad en curso dentro del historial y vuelve a abrir el trabajo contestado desde `WorkFoldLine`; no se incorpora el encabezado privado de Mono ni un segundo estado de expansion.

Verificacion: prueba focalizada `transcriptActivity.test.ts` (61); `verify-ports.mjs --run-tests` correcto (31 commits upstream, 116 mapeos y 31 comandos); cinco pruebas Node de auditor/verificador; inventario estable (102 commits y 374 rutas); JSON valido y `git diff --check`. Commit de trazabilidad: `28ae62e Track expandable activity ticker coverage`. Sin codigo de producto ni push.

Estado: 31/102 commits registrados, 28 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 116 mapeos. Esta proporcion no representa porcentaje de esfuerzo ni paridad.

Siguiente: revisar `a3f6f8a` por su limpieza del diagnostico temporal y cambios de release; despues revisar `d4e40a9` sobre el panel de cambios por sesion. La gestion SSH remota continua asignada al agente nativo de Voktty y tmux.

## Hito 80: limpieza de diagnostico y release upstream

`a3f6f8a` elimina instrumentacion temporal de scroll que Voktty nunca incorporo. Sus otras modificaciones son el changelog y las versiones de MonoCode 0.10.0, que no corresponden al producto Voktty.

Verificacion: `verify-ports.mjs --run-tests` correcto (32 commits upstream, 117 mapeos y 31 comandos de prueba); cinco pruebas Node de auditor/verificador; inventario estable (102 commits y 374 rutas); JSON valido y `git diff --check`. Commit de trazabilidad: `e27a88f Track release cleanup coverage`. Sin codigo de producto ni push.

Estado: 32/102 commits registrados, 29 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 117 mapeos. Esta proporcion no representa porcentaje de esfuerzo ni paridad.

Siguiente: revisar `d4e40a9` (panel de cambios de una sesion Mono) contra el panel Session Changes y el visor de diffs de Voktty. La gestion remota sigue usando el agente SSH nativo con recuperacion tmux en Docker.

## Hito 81: trazabilidad del panel de cambios por sesion

`ports.json` registra `d4e40a9` sobre la UI preexistente de Session Changes: los diffs de una sesion se muestran junto al chat en una pestana del panel de archivos, identificados por sesion y con foco en la ruta pedida. El panel lateral extra de MonoCode solo compensa su ventana que tapa el workspace.

Verificacion: pruebas focalizadas `layout.test.ts` y `SurfaceTabs.test.ts` (45); `verify-ports.mjs --run-tests` correcto (33 commits upstream, 120 mapeos y 32 comandos); cinco pruebas Node de auditor/verificador; inventario estable (102 commits y 374 rutas); JSON valido y `git diff --check`. Commit de trazabilidad: `9023845 Track session changes panel coverage`. Sin codigo de producto ni push.

Estado: 33/102 commits registrados, 30 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`); 120 mapeos. Esta proporcion no representa porcentaje de esfuerzo ni paridad.

## Hito 82: commit nativo por rutas para `d26871f`

La revision del commit upstream detecta que la UI envia `paths`, pero el comando Rust de MonoCode no los acepta; el commit puede incluir cualquier archivo ya staged. Voktty agrega `paths` opcional al comando Git existente y una operacion que valida cada ruta contra archivos cambiados, rechaza resultados de status truncados y usa pathspecs literales con `git commit --only`. Solo prepara archivos nuevos seleccionados; los archivos staged fuera de la seleccion quedan staged. El contrato pasa por `WorkspaceEnv`, conservando el backend Git local, SSH, WSL y Docker de Voktty.

Verificacion: cuatro pruebas Rust cubren staging ajeno, archivo nuevo, metacaracteres de pathspec y rechazo de directorios; `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1264 correctas, una omitida); `pnpm check-types`; `pnpm test` (637 suites, 4651 pruebas frontend; Host 123 correctas y cinco omisiones; siete pruebas Cortex eval); `pnpm lint` sin errores (1637 avisos, 18 infos); rustfmt focalizado y `git diff --check`. `cargo fmt --check` global sigue mostrando formato pendiente en archivos no modificados. Commit: `94a9b85 Add path-scoped native Git commits`. Sin push.

Estado: 33/102 commits upstream registrados, 30 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`). `d26871f` sigue parcial: falta la UI de commit por sesion, la agrupacion por repositorio y su flujo de actualizacion de review. Esta proporcion no representa porcentaje de esfuerzo ni paridad.

Siguiente: integrar la accion de commit en SessionReview y el panel Session Changes usando el nuevo comando Git nativo y `WorkspaceEnv`. La gestion remota de ordenadores Harness continua reservada al agente SSH nativo de Voktty, tmux y recuperacion Docker.

## Hito 83: commit por sesion en Session Changes

`d26871f` ya tiene la accion Commit en la tarjeta SessionReview y una vista Commit dentro de Session Changes. La vista agrupa rutas exactas del snapshot por repositorio Git, permite elegir un repositorio cuando hay varios y excluye cambios compartidos o rutas sin repositorio. La resolucion y el commit pasan por `native.gitResolveRepo` y `native.gitCommit` con el `WorkspaceEnv` actual; no se invoca Git desde el frontend. Tras confirmar, solo las rutas seleccionadas se marcan como conservadas en el checkpoint, se notifican los cambios y el resultado sigue visible durante la recarga. La vista seleccionada se conserva en el snapshot del workspace.

Verificacion: cuatro archivos de prueba focalizados, 65 correctas; `pnpm check-types`; `pnpm test` (639 suites y 4655 pruebas frontend; Host 123 correctas y cinco omitidas; siete pruebas Cortex eval); `pnpm lint` sin errores (1637 avisos y 18 infos; 3706 claves i18n resueltas); formato Biome de los archivos nuevos y cambios focalizados; `git diff --check`. Commit funcional: `7e1af5c Add session review commit flow`. Sin push.

Estado: 33/102 commits upstream registrados, 30 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`). `d26871f` sigue parcial: falta revisar y portar su flujo de push y Pull Request por repositorio. La proporcion no representa porcentaje de esfuerzo ni paridad.

Siguiente: completar el flujo de push y Pull Request de `d26871f` sobre las acciones Git nativas de Voktty; despues actualizar la trazabilidad. La gestion remota Harness sigue asignada al agente SSH nativo de Voktty, tmux y recuperacion Docker.

## Hito 84: push y Pull Request por repositorio en Session Changes

El panel consulta estado GitHub, rama por defecto, PR abierta y divergencia mediante el PAT del keychain. Push, publish y fetch usan los comandos Git nativos con el `WorkspaceEnv` de la sesion; una comprobacion con SSH confirma que `sessionId` llega al agente Voktty. El flujo hace fetch antes de confirmar para rechazar ramas atrasadas, crea el PR por REST y valida la URL antes de abrirla. Si el commit vacia el diff de la sesion, conserva los repositorios detectados para que la pestaña siga permitiendo push.

Verificacion: `pnpm check-types`; `pnpm test` (640 archivos, 4669 pruebas frontend; Host 123 correctas y cinco omitidas; siete pruebas Cortex eval); `pnpm lint` sin errores (1637 avisos y 18 infos; 3711 claves i18n resueltas); 15 pruebas focalizadas de Session Changes/GitHub remoto; `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1268 correctas, una omitida); `rustfmt --edition 2021 --check` focalizado, Biome focalizado y `git diff --check`.

Limites: sin smoke contra una maquina SSH/Docker real. La llamada HTTP a GitHub se prueba con servidor local simulado. `d26871f` sigue parcial: este panel solo incluye cambios exactos de la sesion, no toda la lista de cambios del repositorio; el texto del PR reutiliza el mensaje del commit y no usa el Harness de la sesion. Los generadores actuales llaman el camino Git heredado sin `WorkspaceEnv`, asi que no se deben conectar al flujo SSH/Docker hasta portar su contexto al agente nativo. El efecto inicial propio `VokttySignal` ya esta en `d764f18`.

Estado: 33/102 commits upstream registrados; `d26871f` continua parcial y aun no se registra en `ports.json`. Esta proporcion no representa porcentaje de esfuerzo ni paridad. Siguiente: cerrar el hito de codigo con un commit y registrar `d26871f` en un hito de trazabilidad; despues completar la vista Git por proyecto y la generacion Harness por el transporte nativo.

## Hito 85: trazabilidad del panel de commit

`ports.json` registra `d26871f` como parcial y enlaza su UI con Session Changes, SessionReview, FilePane y el transporte nativo. El hito incluye push/publish y estado/creacion de PR de GitHub. Quedan fuera la seleccion explicita de todos los cambios del proyecto y la generacion de texto con el Harness, hasta que su contexto Git use `WorkspaceEnv` y el agente de Voktty.

Verificacion: `verify-ports.mjs --run-tests` correcto (34 commits upstream, 129 mapeos y 34 comandos de prueba); tres pruebas Node del verificador; auditoria estable (102 commits y 374 rutas); `git diff --check`. Commit funcional relacionado: `a9a1bee Add native Harness push and pull requests`. Sin push.

Estado: 34/102 commits upstream registrados, 30 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `d26871f`). Esta proporcion no representa porcentaje de esfuerzo ni paridad.

Siguiente: integrar la lista completa de cambios del proyecto y portar el contexto de los generadores Harness al agente nativo con `WorkspaceEnv`; mantener SSH remoto, tmux y recuperacion Docker en la ruta de Voktty.

## Hito 86: cambios completos del repositorio en Session Changes

La lista del tab Commit combina los archivos exactos del checkpoint con todos los cambios que devuelve `native.gitStatus`. Los archivos ajenos a la sesion aparecen sin seleccionar; al confirmar no se modifica su checkpoint. Los archivos compartidos siguen bloqueados aunque Git tambien los liste. Si status informa truncamiento, el panel explica por que no permite un commit por seleccion. Cuando la sesion no tiene archivos, el repo se resuelve desde `cwd` para mantener visibles los cambios del proyecto.

Verificacion: `pnpm check-types`; `pnpm test` (640 archivos y 4672 pruebas frontend; Host 123 correctas y cinco omisiones; siete pruebas Cortex eval); `pnpm lint` sin errores (3712 claves i18n resueltas); Biome focalizado y `git diff --check`. Sin cambios Rust. Sin smoke real SSH/Docker; la regresion verifica que el status SSH conserva el `WorkspaceEnv`.

Commit: `a7c666e Show project Git changes in Harness commits`. Sin push.

Estado: `d26871f` ahora cubre la seleccion de cambios de todo el repositorio y sigue parcial por el texto de commit/PR generado por el Harness. Siguiente: actualizar `ports.json` y sus pruebas; luego portar el contexto Git de los generadores al agente nativo, con el `WorkspaceEnv` de la sesion.

## Hito 87: trazabilidad de la lista Git del proyecto

`ports.json` enlaza `a7c666e` con `d26871f`, incluye la prueba del selector de rutas y deja como unica parte diferida la generacion de texto del Harness. Se conserva cobertura parcial porque esa ruta aun no usa el agente nativo con `WorkspaceEnv`.

Verificacion: `verify-ports.mjs --run-tests` correcto (34 commits upstream, 129 mapeos y 34 comandos de prueba); tres pruebas Node del verificador; auditoria estable (102 commits y 374 rutas); `git diff --check`. Commit de trazabilidad: `bf2dcca Track project changes commit selection`. Sin push.

Estado: 34/102 commits upstream registrados, 30 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `d26871f`). Siguiente: portar el contexto para generar mensajes de commit y PR usando el Harness de la sesion y Git nativo con `WorkspaceEnv`; mantener la gestion SSH y Docker en el agente de Voktty.

## Hito 88: mensajes de commit con contexto Git nativo

La vista Commit incorpora una accion para generar el mensaje con el Harness asociado a la sesion. El contexto contiene solo las rutas seleccionadas, con estado, rama y diffs staged/unstaged obtenidos por `native.gitDiff` y el `WorkspaceEnv` activo. El prompt recibe ese contexto directamente; los adaptadores no consultan Git de nuevo. La lectura limita concurrencia, cantidad de archivos y tamano de patch, y conserva una nota cuando Git trunca o no puede devolver algun diff. Para workspaces remotos el proceso de texto usa `.` como cwd local y no recibe la ruta remota como cwd.

Verificacion: `pnpm check-types`; `pnpm test` (640 archivos, 4674 pruebas frontend; Host 123 correctas y cinco omisiones; siete pruebas Cortex eval); `pnpm lint` sin errores (3712 claves i18n resueltas, 1637 avisos y 18 infos); tres archivos de prueba focalizados, 13 pruebas; `git diff --check`. Sin cambios Rust. La prueba SSH confirma que los diffs usan el `WorkspaceEnv` remoto; no se hizo smoke contra un host SSH/Docker real.

Commit de codigo: `d068f09 Generate commit messages from selected workspace diffs`. Sin push.

Estado: `d26871f` ya incluye generacion del mensaje de commit con Git nativo; queda diferida la generacion de titulo y cuerpo del PR, cuyo contexto de rama debe pasar por el agente nativo con `WorkspaceEnv`. Siguiente: cerrar la trazabilidad del hito y revisar el siguiente cambio del inventario. La gestion de ordenadores remotos del Harness permanece asignada al agente SSH nativo de Voktty, tmux y recuperacion Docker.

## Hito 89: trazabilidad del mensaje de commit por seleccion

`ports.json` enlaza `d068f09` con `d26871f`: el Harness de la sesion recibe un resumen y diffs acotados de las rutas seleccionadas, leidos por Git nativo con el `WorkspaceEnv` vigente. Se registran la vista, el helper de contexto, la propagacion por los adaptadores y las pruebas de transporte SSH y cancelacion. El ledger deja pendiente la generacion del titulo y cuerpo del PR, ya que Voktty aun reutiliza el mensaje del commit.

Verificacion: `verify-ports.mjs --run-tests` correcto (34 commits upstream, 139 mapeos y 34 comandos de prueba); cinco pruebas Node de auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON valido y `git diff --check`. Commit de codigo: `d068f09 Generate commit messages from selected workspace diffs`. Commit de trazabilidad: `94171d5 Track workspace-aware commit message generation`. Sin push.

Estado: 34/102 commits upstream registrados, 30 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `d26871f`). Siguiente: portar el titulo y cuerpo del PR con contexto de rama leido por Git nativo y `WorkspaceEnv`, y continuar el inventario. La gestion remota de ordenadores Harness debe seguir pasando por el agente SSH de Voktty, tmux y recuperacion Docker.

## Hito 90: titulo y cuerpo del PR con contexto Git nativo

La accion de PR genera el titulo y el cuerpo con el Harness de la sesion usando commits y diffs de la rama obtenidos por `native.gitCompareBranches` y `native.gitShowCommit` con el `WorkspaceEnv` activo. Se limita el numero y tamano de diffs y se anotan los elementos omitidos. Antes de generar, se comprueba que el rango nativo coincide con el numero de commits ahead reportado por GitHub. El contexto llega directamente al Harness sin una segunda consulta Git; los procesos de texto usan `.` como cwd local en workspaces SSH/Docker.

Verificacion: `pnpm check-types`; `pnpm test` (641 archivos y 4677 pruebas frontend; Host 123 correctas y cinco omisiones; siete pruebas Cortex eval); `pnpm lint` sin errores (3712 claves i18n resueltas, 1637 avisos y 18 infos); pruebas focalizadas (13); Biome focalizado y `git diff --check`. El lint mantiene avisos del repositorio. Sin cambios Rust. La regresion comprueba el `WorkspaceEnv` SSH simulado; no se hizo smoke con host SSH/Docker real.

Commit de codigo: `2dbc46f Generate PR content from native branch context`. Sin push.

Estado: `d26871f` queda completo en la implementacion local registrada; `ports.json` pendiente de actualizar y verificar en el siguiente hito. Aun quedan tres commits parciales (`b93b95a`, `0eb2773`, `00d68d3`). La proporcion no representa esfuerzo ni paridad. Siguiente: cerrar la trazabilidad y reanudar el inventario funcional; la gestion remota del Harness sigue reservada al agente SSH nativo de Voktty, tmux y recuperacion Docker.

## Hito 91: trazabilidad completa del flujo Git de Session Changes

`ports.json` enlaza `2dbc46f` con `d26871f`, registra `sessionPr` y sus pruebas, y marca completa esta cobertura. El contexto de commit y PR usa las operaciones Git nativas con `WorkspaceEnv` y llega al Harness sin una segunda consulta de Git. La comprobacion del rango nativo frente a GitHub evita generar texto cuando las vistas de commits difieren.

Verificacion: `verify-ports.mjs --run-tests` correcto (34 commits upstream, 140 mapeos y 34 comandos de prueba); cinco pruebas Node de auditor/verificador; auditoria estable (102 commits y 374 rutas; 221 sin candidato, 149 distintos, tres identicos y uno ambiguo); JSON valido y `git diff --check`. Sin codigo de producto ni push.

Commit de trazabilidad: `2d49210 Track native PR content generation port`. Sin push.

Estado: 34/102 commits registrados, 31 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`). Esta proporcion no representa esfuerzo ni paridad. Siguiente: continuar el inventario desde las tres filas parciales y mantener el transporte remoto del Harness sobre el agente Voktty, tmux y recuperacion Docker.

## Hito 92: precarga de work items GitHub desde Inbox

Las tarjetas de issues y PRs de GitHub precargan detalles, actividad y diff al recibir hover, usando `prefetchGithubWorkItem` y la cache con frescura existente. Esto adapta la mejora de MonoCode al punto de entrada de Voktty; no activa consultas para otros providers. La prueba comprueba el conjunto de comandos para issue y PR y que la cache evita llamadas duplicadas.

Verificacion: `pnpm check-types`; `pnpm test` (641 archivos, 4678 pruebas); `pnpm lint` sin errores (3712 claves i18n resueltas, 1637 avisos y 18 infos); cinco pruebas Node del auditor/verificador y `git diff --check`. Commit de codigo: `d769e29 Prefetch GitHub work items from Inbox hover`. Sin push.

## Hito 93: trazabilidad del prefetch con procedencia mixta

`ports.json` enlaza la cobertura previa de `00d68d3` con el ajuste `d769e29`. El verificador admite `localCommitBases` por commit, con una prueba que combina historial anterior al baseline y un commit integrado posterior. La cobertura sigue parcial porque Voktty no tiene la accion de work item enlazado en las tarjetas de sesion; el prefetch queda asociado a las tarjetas de Inbox.

Verificacion: `verify-ports.mjs --run-tests` correcto (34 commits upstream, 140 mapeos y 34 comandos); cinco pruebas Node; auditoria estable (102 commits y 374 rutas: 221 sin candidato, 149 distintos, tres identicos y uno ambiguo); `pnpm check-types`, `pnpm test` (641 archivos, 4678 pruebas), `pnpm lint`, JSON valido, `node --check` y `git diff --check`. Biome excluye `scripts/monocode/verify-ports.mjs` y su prueba de la configuracion de lint. Commit de trazabilidad: `e680751 Track Inbox work item prefetch port`. Sin push.

Estado: 34/102 commits registrados, 31 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`). Siguiente: revisar los parciales restantes y continuar el inventario. La conexion remota de gestion de ordenadores del Harness sigue pendiente y debe usar el agente SSH nativo de Voktty, tmux y recuperacion Docker.

## Hito 94: staging literal de carpetas Git

La staging de carpetas en el panel Git nativo y en los comandos heredados del Harness usa `--literal-pathspecs`. El resolver especifico para stage/unstage admite nombres con `:` como `:(glob)*` sin relajar la validacion de rutas ordinarias ni permitir escapes del repositorio. La misma lista de argumentos se transporta por Git local, SSH, Docker y WSL. El Host sidecar ya contenia la adaptacion equivalente y su prueba en `22c2707`; el cambio nativo queda en `61c89b8`.

Verificacion: tres pruebas Rust focalizadas; `pnpm check-types`; `pnpm test` (641 archivos y 4678 pruebas); `pnpm lint` sin errores (3712 claves i18n); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1271 correctas, una omitida); Host focalizado (10 pruebas); `rustfmt --edition 2021 --check` y `git diff --check`. No smoke contra una maquina SSH/Docker real. Sin push.

## Hito 95: trazabilidad del staging literal

`ports.json` enlaza `60102ab` con la adaptacion Host previa y el cambio nativo. La fila registra cinco rutas upstream/locales y las tres pruebas Rust. El transporte SSH nativo reenvia los argumentos a Git sin una lista de comandos que bloquee `--literal-pathspecs`.

Verificacion: `verify-ports.mjs --run-tests` correcto (35 commits upstream, 145 mapeos y 37 comandos); cinco pruebas Node de auditor/verificador; auditoria estable (102 commits y 374 rutas: 221 sin candidato, 149 distintos, tres identicos y uno ambiguo); JSON valido y `git diff --check`. Commit de codigo: `61c89b8 Treat selected Git paths literally`. Commit de trazabilidad: `ae74c41 Track literal Git path staging port`. Sin push.

Estado: 35/102 commits registrados, 32 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`). Siguiente: continuar la revision de commits no registrados del inventario y priorizar las superficies que ya usan contratos nativos. La conexion remota propia del Harness sigue pendiente y debe usar el agente SSH de Voktty, tmux para recuperar sesiones y compatibilidad con hosts Docker.

## Hito 96: conteos Git ajustados al ancho del sidebar

`DiffStat` ahora mide su espacio y reduce el tamano de las cifras de cambios cuando la pestaña o la tarjeta de sesion se estrecha. `ResizeObserver` vuelve a calcularlo al arrastrar el sidebar; al ensancharlo, la fuente recupera los 11 px. La tarjeta puede ceder ancho sin desplazar la etiqueta Git ni el icono del Harness. Se conserva la traduccion y la tipografia local.

Verificacion: regresion focalizada de ajuste y recuperacion del tamano (2 pruebas); `pnpm check-types`; `pnpm test` (642 archivos, 4680 pruebas; Host 123 correctas y cinco omitidas; siete pruebas Cortex eval); `pnpm lint` sin errores (3712 claves i18n, 1637 avisos y 18 infos); Biome check de los dos archivos nuevos y `git diff --check`. Sin cambios Rust. Commit de codigo: `99afbe4 Fit sidebar diff stats to available width`. Sin push.

## Hito 97: trazabilidad del ajuste de diff stats

`ports.json` enlaza `dc6d0ef` con el sidebar, el componente extraido y su regresion de redimensionado.

Verificacion: `verify-ports.mjs --run-tests` correcto (36 commits upstream, 148 mapeos y 38 comandos); cinco pruebas Node de auditor/verificador; auditoria estable (102 commits y 374 rutas: 221 sin candidato, 149 distintos, tres identicos y uno ambiguo); JSON valido y `git diff --check`. Commit de codigo: `99afbe4 Fit sidebar diff stats to available width`. Commit de trazabilidad: `a99190f Track responsive diff stat port`. Sin push.

Estado: 36/102 commits registrados, 33 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`). Siguiente: revisar los cambios pendientes que afecten superficies existentes del Harness y continuar dejando la conexion remota para la integracion con el agente SSH nativo, tmux y compatibilidad Docker.

## Hito 98: trazabilidad de la composicion IME remota

La proteccion ya estaba implementada en `973578b`: el textarea conserva el defaultValue del montaje mientras el efecto sincroniza los borradores remotos posteriores. Asi los polls de la sesion no reemplazan el nodo de texto durante una composicion IME en WebKit.

Verificacion: prueba IME focalizada (1); `verify-ports.mjs --run-tests` correcto (37 commits upstream, 150 mapeos y 39 comandos); cinco pruebas Node de auditor/verificador; auditoria estable (102 commits y 374 rutas: 221 sin candidato, 149 distintos, tres identicos y uno ambiguo); JSON valido y `git diff --check`. Commit de implementacion relacionado: `973578b Preserve composer IME across remote draft updates`. Commit de trazabilidad: `ce1d95d Track remote composer IME port`. Sin push.

Estado: 37/102 commits registrados, 34 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`). Siguiente: continuar el inventario funcional. La gestion de ordenadores remotos del Harness permanece asignada al agente SSH nativo de Voktty, con tmux para recuperar sesiones en hosts Docker.

## Hito 99: ampliar el catalogo de skills del Harness

El catalogo nativo acepta hasta 5.000 skills, en linea con el limite upstream. La regresion crea 1.400 skills del usuario y una skill exclusiva de Codex para comprobar que el catalogo sigue recorriendo todas las raices; la lectura de frontmatter conserva el limite de 16 KiB por skill.

Verificacion: prueba Rust focalizada; `pnpm check-types`; `pnpm test` (642 archivos y 4680 pruebas; Host 123 correctas y cinco omitidas; siete pruebas Cortex eval); `pnpm lint` sin errores (3712 claves i18n, 1637 avisos y 18 infos); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1272 correctas, una omitida); rustfmt y `git diff --check`. Commit de codigo: `bc59b97 Raise Harness skill catalog cap`. Sin push.

## Hito 100: trazabilidad del catalogo de skills ampliado

`ports.json` enlaza `07f29c13` con `src-tauri/src/modules/harness/skills.rs` y la prueba del catalogo grande.

Verificacion: `verify-ports.mjs --run-tests` correcto (38 commits upstream, 151 mapeos y 40 comandos de prueba); cinco pruebas Node del auditor/verificador; inventario estable (102 commits y 374 rutas: 221 sin candidato, 149 distintos, tres identicos y uno ambiguo); JSON valido y `git diff --check`. Commit de trazabilidad: `f2d8ad4 Track large skill catalog port`. Sin push.

Estado: 38/102 commits registrados, 35 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`). Esta proporcion no representa esfuerzo ni paridad. Siguiente: seguir revisando los commits upstream no registrados que encajan en las superficies de Voktty. La gestion remota del Harness sigue reservada al agente SSH nativo de Voktty, tmux y recuperacion Docker.

## Hito 101: robustecer los archivos soltados en Composer

La implementacion base `a73085c` acepta archivos soltados por el DOM y por Tauri, conserva el listener al cambiar las capacidades del Harness, descarta lecturas obsoletas y espera las lecturas pendientes antes de enviar. El port conserva el convertidor de coordenadas Windows/macOS de Voktty. Se agregaron mensajes localizados para imagenes sin ruta nativa y errores de lectura; muestran guia generica y no revelan rutas locales.

Verificacion: 14 pruebas focalizadas de Composer; `pnpm check-types`; `pnpm test` (642 archivos y 4688 pruebas; Host 123 correctas y cinco omitidas; siete pruebas Cortex eval); `pnpm lint` sin errores (3714 claves i18n, 1637 avisos y 18 infos); validacion de cobertura en ingles/espanol y `git diff --check`. Sin cambios Rust. Commit base: `a73085c Harden Composer file drop handling`; commit de cierre: `45d44cc Show errors for failed Composer file drops`. Sin push.

## Hito 102: trazabilidad del manejo robusto de archivos soltados

`ports.json` enlaza `56bae446` con el Composer y su regresion local, a traves de `a73085c` y `45d44cc`.

Verificacion: `verify-ports.mjs --run-tests` correcto (39 commits upstream, 153 mapeos y 41 comandos); cinco pruebas Node del auditor/verificador; inventario estable (102 commits y 374 rutas: 221 sin candidato, 149 distintos, tres identicos y uno ambiguo); JSON valido y `git diff --check`. Commit de trazabilidad: `d6d103b Track hardened Composer file drops`. Sin push.

Estado: 39/102 commits registrados, 36 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`). Esta proporcion no representa esfuerzo ni paridad. Siguiente: revisar `7933972` sobre estabilidad del transcript y ritmo de salida, que toca superficies existentes de Voktty. La gestion remota del Harness sigue reservada al agente SSH nativo, tmux y recuperacion Docker.

## Hito 103: trazabilidad de scroll estable y ritmo de salida

La revision de `7933972` confirmo que Voktty ya contiene la funcionalidad en varios cambios adaptados a su arquitectura: conserva la posicion del compositor durante el resize; reconcilia movimiento del usuario con los eventos de scroll y los limites del layout; ajusta anclajes de turnos en orden DOM; deja que los scrollers anidados procesen sus gestos; y revela las respuestas nuevas con ritmo, manteniendo inmediata la salida existente o de pestañas ocultas. `ports.json` vincula estas piezas y sus pruebas con las diez rutas upstream. No se duplico codigo de producto.

Verificacion: las cinco suites focalizadas pasaron (58 pruebas); `verify-ports.mjs --run-tests` correcto (40 commits upstream, 163 mapeos y 42 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas: 221 sin candidato, 149 distintos, tres identicos y uno ambiguo); JSON valido y `git diff --check`. Commit de trazabilidad: `64e1f09 Track transcript scroll stability port`. Sin push.

Estado: 40/102 commits registrados, 37 completos y tres parciales (`b93b95a`, `0eb2773`, `00d68d3`). Esta proporcion no representa esfuerzo ni paridad. Siguiente: seguir con el siguiente cambio upstream no registrado que encaje en una superficie existente; mantener la gestion remota del Harness para la integracion con el agente SSH nativo, tmux y recuperacion Docker.

## Hito 104: clasificar la busqueda y creacion de worktrees

`4361fdb` solo modifica los temporizadores de los tests de `GitChangesPanel` upstream para aislar invalidaciones retrasadas. Voktty tiene otro panel (`SourceControlPanel`) y no tiene la misma suite de interaccion; no hay comportamiento de producto que portar de ese commit.

`22b4874` queda parcial en `ports.json`. Voktty ofrece busqueda y el dialogo de creacion en `WorktreePicker`, pero no en el selector de la barra lateral. Ademas, la lista y el dialogo actuales llaman a `git_worktrees` y `git_worktree_create`, ausentes del handler de comandos Tauri. `git_list_branches` y `git_worktree_add` son contratos distintos: el ultimo crea worktrees de sesion bajo la cache de Voktty. No expongo la creacion rapida hasta sustituir esas llamadas por operaciones Git autorizadas que usen `WorkspaceEnv`, con rutas locales, WSL, SSH a traves del agente de Voktty y Docker.

Verificacion: prueba focalizada del selector (3); `verify-ports.mjs --run-tests` correcto (41 commits registrados, 166 mapeos y 43 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON valido y `git diff --check`. Commit de trazabilidad: `46117ea Track searchable worktree port gap`. No se hicieron cambios de producto ni smoke de SSH/Docker.

Estado: 41/102 commits registrados, 37 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). La proporcion no representa esfuerzo ni paridad. Siguiente: continuar con `610550e` sobre las acciones del encabezado de workspace, y planear las operaciones genericas de worktree como una frontera nativa con el agente SSH de Voktty.

## Hito 105: trazabilidad del encabezado y los desvanecimientos

`610550e` queda cubierto por el comportamiento adaptado de Voktty: Buscar y Nueva sesion aparecen en el encabezado del sidebar cuando el rail del proyecto esta visible; al cerrar el rail, siguen en TitleBar porque el encabezado lateral deja de estar disponible. `990f141` se asocia a `9549dd6` y `9d4dfcf`: las etiquetas recortadas y los bordes inferiores de listas y transcripts se desvanecen con CSS, y el contenido transcript conserva espacio inferior para desplazarse mas alla del borde.

Verificacion: `verify-ports.mjs --run-tests` correcto (43 commits registrados, 176 mapeos y 43 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON valido y `git diff --check`. No hubo cambios de producto ni pruebas visuales nuevas. Commit de trazabilidad: `37cf084 Track workspace sidebar and fade ports`.

Estado: 43/102 commits registrados, 39 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). Esta proporcion no representa esfuerzo ni paridad. `4361fdb` sigue clasificado como test-only sin cambio de producto aplicable. Siguiente: continuar el inventario en cambios de Harness y preparar como hito separado el contrato nativo generico de worktrees que falta en Voktty.

## Hito 106: corregir el fondo del selector de carpetas remotas

Se retiro el velo negro de `AddRemoteProjectDialog`; el fondo completo queda transparente y el panel conserva su cristal. El `onMouseDown` del fondo sigue cancelando el dialogo. Una asercion de render evita reintroducir el velo.

`807c70e` es un corte de version y changelog de MonoCode; Voktty mantiene sus propios numeros de version, changelog y lockfile pnpm. `889ac20` anade un tinte de ventana AppKit durante el resize. Voktty tiene otro contrato de apariencia (backdrop nativo y tintado CSS) y no sincroniza una opacidad nativa, asi que no se porteo esa caracteristica de shell en este hito; queda para una decision de apariencia macOS independiente.

Verificacion: test focalizado (2); `pnpm check-types`; `pnpm test` (642 archivos, 4688 pruebas); `pnpm lint` sin errores (1637 avisos y 18 infos); `verify-ports.mjs --run-tests` correcto (44 commits registrados, 177 mapeos y 44 comandos); cinco pruebas Node; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. Sin cambios Rust ni smoke SSH/Docker. Commit de implementacion: `0b77f3e Keep remote folder dialog backdrop clear`. Commit de trazabilidad: `7f6e7bb Track remote folder backdrop fix`.

Estado: 44/102 commits registrados, 40 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). No se considera paridad total. Siguiente: revisar el cambio de terminales generales en el worktree activo y continuar en orden por las superficies de Harness; mantener pendiente el API generico de worktrees con WorkspaceEnv y agente SSH Voktty.

## Hito 107: abrir terminales generales en el worktree de la sesion activa

Las acciones generales de terminal usan primero el worktree de la sesion activa si sigue disponible; en otro caso usan la carpeta del panel enfocado, la carpeta base de la sesion y el proyecto. Las acciones ligadas a una sesion y la vista de sesion independiente aplican la misma regla para no abrir en un worktree eliminado. Se conserva la ruta de creacion de terminales de Voktty.

Verificacion: test focalizado de terminales (13); `pnpm check-types`; `pnpm test` (642 archivos, 4692 pruebas; suite Host 123 correctas y cinco omitidas); `pnpm lint` sin errores (1637 avisos y 18 infos); `verify-ports.mjs --run-tests` correcto (45 commits registrados, 181 mapeos y 45 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. Commit de implementacion: `13ebdb3 Open Harness terminals in the active worktree`. Commit de trazabilidad: pendiente. Sin cambios Rust ni prueba SSH/Docker.

Estado: 45/102 commits registrados, 41 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). No representa paridad total. Siguiente: continuar con el siguiente cambio aplicable; mantener el API generico de worktrees y la gestion remota via agente SSH de Voktty, tmux y recuperacion Docker como trabajo separado.

## Hito 108: confirmar gutter de diffs y colores del resumen PR

`185b500` ya esta adaptado en Voktty. `3ee0e4d` alinea los numeros originales y los marcadores del gutter en el editor; `02af232` lleva el resumen de cambios de PR a las variables de color de diff seleccionadas. La prueba local verifica el orden de los gutters, los numeros de filas modificadas y sus clases de color. No se necesitaba cambiar producto.

Verificacion: `editorGit.gutter.test.ts` (3); `verify-ports.mjs --run-tests` correcto (46 commits registrados, 185 mapeos y 46 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. No hubo cambios de producto. Commits locales existentes: `3ee0e4d` y `02af232`; commit de trazabilidad: `79d4ea2 Track diff gutter and inbox palette port`.

Estado: 46/102 commits registrados, 42 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). Siguiente: seguir con el siguiente commit upstream aplicable.

## Hito 109: rendimiento de streams, indices y transcripciones

`0bfa5c6` ya estaba cubierto por adaptaciones Voktty en cinco commits: colas separadas para streams visibles y ocultos; retencion del explorador oculto y medicion diferida; indices por worktree con invalidacion al reanudar; cache de agrupacion de turnos; y reutilizacion de transcripciones con actualizaciones estables de props. La implementacion conserva los limites de Voktty, como el agrupamiento Zen/classic y el foco del panel.

Verificacion: siete suites focalizadas (55 pruebas); `verify-ports.mjs --run-tests` correcto (47 commits registrados, 200 mapeos y 47 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. No hubo cambios de producto ni Rust. Commits locales existentes: `9ad872e`, `ac9eb2e`, `c7ef180`, `caace6d` y `ca1f602`; commit de trazabilidad: `7669b2e Track streaming and transcript performance port`.

Estado provisional: 47/102 commits registrados, 43 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). Siguiente: seguir con el proximo cambio upstream aplicable.

## Hito 110: ordenar capas y contraste de los dialogos

Se establecio `z-0` para los fondos y `z-[1]` para los paneles en Modal, RemoveProjectDialog, SwitchBranchDialog y AddRemoteProjectDialog. El selector remoto conserva el fondo transparente para los clics exteriores y ahora usa un fondo base claro cuando el tema lo requiere. Las superficies Harness siguen la paleta tematica propia de Voktty.

Verificacion: tres suites focalizadas (4 pruebas); `pnpm check-types`; `pnpm test` (642 archivos, 4692 pruebas; Host 123 correctas y cinco omitidas); `pnpm lint` sin errores (1637 avisos y 18 infos); `verify-ports.mjs --run-tests` correcto (48 commits registrados, 204 mapeos y 48 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. Commit de implementacion: `867ef7a Layer Harness dialogs for light themes`. Commit de trazabilidad: `bfea07e Track modal layering port`.

Estado: 48/102 commits registrados, 44 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). Siguiente: seguir con el siguiente cambio upstream aplicable.

## Hito 111: conservar la posicion del transcript en actualizaciones asincronas

`3e05e03` ya esta cubierto por las reglas de scroll adaptadas de Voktty. El transcript reconcilia la posicion real antes de aplicar nuevas alturas o tokens; solo vuelve a seguir al agente cuando la vista alcanza el final. Las fases de actividad en vivo usan la misma regla. La prueba local cubre los eventos de scroll demorados, crecimiento durante streaming, reversiones pequenas y gestos de rueda.

Verificacion: `AgentTranscriptScroll.test.ts` (19); `verify-ports.mjs --run-tests` correcto (49 commits registrados, 206 mapeos y 49 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. No hubo cambios de producto. Commits locales existentes: `74cfce0` y `11aaf40`; commit de trazabilidad: `bdbe307 Track async transcript scroll port`.

Estado: 49/102 commits registrados, 45 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). Siguiente: continuar con el siguiente cambio aplicable.

## Hito 112: conservar borradores enfocados del titulo de nota

`7eebfc179c` se adapto al editor de notas de Voktty. El autosave conserva en pantalla titulos vacios o con espacios mientras el campo sigue enfocado; las respuestas de guardados asincronos ya no pisan ese borrador. Al salir del campo o desmontar el editor se normaliza y confirma el titulo. El guardado al salir se agrega a la misma cola para que una escritura previa del cuerpo no reemplace el titulo final.

Verificacion: `NotesView.test.tsx` (5); `pnpm check-types`; `pnpm test` (643 archivos, 4697 pruebas; Host 123 correctas y cinco omitidas; siete pruebas Cortex eval); `pnpm lint` sin errores (1637 avisos y 18 infos); `verify-ports.mjs --run-tests` correcto (50 commits registrados, 208 mapeos y 50 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. Commit de implementacion: `fb61fc6 Preserve focused Harness note title drafts`. Commit de trazabilidad: `bcd980f Track focused note title draft port`. Sin cambios Rust ni prueba SSH/Docker.

Estado: 50/102 commits registrados, 46 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). No representa paridad total. Siguiente: seguir revisando el siguiente cambio aplicable y mantener la gestion remota del Harness en el agente SSH de Voktty, tmux y recuperacion Docker.

## Hito 113: mostrar glifos Nerd Font en los prompts del terminal

`57366970be` se adapto al resolvedor de fuentes que Voktty ya usa para xterm. Se mantiene primero la pila elegida por el usuario; despues se incluyen monospace del sistema y familias Nerd Font de simbolos para que WebKit encuentre iconos PUA de prompts y ramas Git.

Verificacion: `fonts.test.ts` (7); `pnpm check-types`; `pnpm test` (643 archivos, 4698 pruebas; Host 123 correctas y cinco omitidas; siete pruebas Cortex eval); `pnpm lint` sin errores (1637 avisos y 18 infos); formato focalizado de las dos rutas; `verify-ports.mjs --run-tests` correcto (51 commits registrados, 211 mapeos y 51 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. Commit de implementacion: `221c524 Add Nerd Font prompt glyph fallbacks`. Commit de trazabilidad: `bb796f6 Track Nerd Font terminal glyph port`. Sin cambios Rust.

Estado: 51/102 commits registrados, 47 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). No representa paridad total. Siguiente: revisar el siguiente cambio de Harness y seguir reservando la gestion remota al agente SSH de Voktty, tmux y recuperacion Docker.

## Hito 114: conservar un estado Pi por clave

`b74e803e69` se adapto al modelo de bloques y al ciclo de eventos del Harness. Cada `setStatus(key, text)` actualiza una sola fila del turno actual; el texto vacio la elimina, las claves distintas conservan filas propias y `notify` sigue como estado sin clave. El sanitizador de sesiones conserva la clave al guardar y restaurar, para que el adaptador pueda seguir actualizando la fila tras una recarga.

Verificacion: suites `apply.test.ts`, `piLive.test.ts`, `piProtocol.test.ts` y `sessionStore.test.ts` (97); `pnpm check-types`; `pnpm test` (643 archivos, 4703 pruebas; Host 123 correctas y cinco omitidas; siete pruebas Cortex eval); `pnpm lint` sin errores; `verify-ports.mjs --run-tests` correcto (52 commits registrados, 218 mapeos y 52 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. Commit de implementacion: `3482628 Keep keyed Pi extension statuses in one row`. Commit de trazabilidad: `786cf71 Track keyed Pi status port`. Sin cambios Rust ni prueba SSH/Docker.

Estado: 52/102 commits registrados, 48 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). No representa paridad total. Siguiente: seguir con el siguiente cambio aplicable; la gestion remota del Harness sigue reservada al agente SSH nativo de Voktty, tmux y recuperacion Docker.

## Hito 115: ocultar modelos internos y snapshots antiguos de Copilot

`5aef862304` se adapto al normalizador compartido de catalogos Pi/OMP. Solo se filtran por identificador los modelos internos y las versiones fechadas que pertenecen a `github-copilot`; los modelos actuales compatibles y los ids iguales de otros proveedores permanecen disponibles.

Verificacion: `piProtocol.test.ts` (23); `pnpm check-types`; `pnpm test` (643 archivos, 4704 pruebas; Host 123 correctas y cinco omitidas; siete pruebas Cortex eval); `pnpm lint` sin errores (1637 avisos y 18 infos); `verify-ports.mjs --run-tests` correcto (53 commits registrados, 220 mapeos y 53 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. Commit de implementacion: `c4b2943 Filter internal Copilot models from Pi catalog`. Commit de trazabilidad: `5de7811 Track Copilot catalog filter port`. Sin cambios Rust.

Estado: 53/102 commits registrados, 49 completos y cuatro parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`). No representa paridad total. Siguiente: clasificar el siguiente cambio del inventario y mantener la gestion remota del Harness en el agente SSH nativo de Voktty, tmux y recuperacion Docker.

## Hito 116: limitar consultas de GitHub y conservar el inbox durante rate limits

`850be653` agrega Mono Agents, memoria y habitos programados como una superficie de producto propia de MonoCode. No tiene equivalente en Voktty; la optimizacion de Markdown aplicable ya se porto en Hito 109. No se integra este producto independiente.

`80ba2c0912` se adapto al limite nativo compartido de `gh_run`: los rate limits primarios y secundarios detienen temporalmente nuevos comandos, el limite GraphQL consulta el reset y usa una pausa de respaldo si esa consulta falla. El inbox conserva la lista de GitHub anterior ante un refresh limitado, usa dos minutos de frescura para la lista y treinta segundos para detalles. El badge consulta cada dos minutos con la ventana visible y cada cinco minutos en segundo plano, mediante un tick de treinta segundos que evita solicitudes simultaneas. Se quito el prefetch de detalles al pasar el puntero por una tarjeta. Voktty no tiene la pestaña de Checks de MonoCode; su polling queda como diferencia funcional diferida.

La gestion remota sigue en el agente SSH nativo de Voktty, con tmux para recuperar sesiones y compatibilidad con hosts Docker. Este hito no conecta comandos GitHub a SSH ni cambia esa frontera. La pantalla inicial ya monta `VokttySignal`, un efecto SVG propio sin juego ni controles, desde Hito 37; queda distinta del fondo interactivo del fork.

Verificacion: `pnpm check-types`; `pnpm test` (645 archivos, 4707 pruebas; Host 123 correctas y cinco omitidas); `pnpm lint` sin errores (1637 avisos y 18 infos); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1277 correctas, una leaky y una omitida); rustfmt focalizado correcto. `cargo fmt --all -- --check` sigue detectando diferencias de formato preexistentes en otros modulos Rust; no se reformatearon archivos ajenos. `verify-ports.mjs --run-tests` correcto (54 commits, 230 mapeos y 55 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. No se hizo smoke SSH/Docker porque este hito no modifica operaciones remotas. Commit de implementacion: `c4499fb Throttle Harness GitHub requests`. Commit de trazabilidad: `079e46e Track GitHub rate-limit port`.

Estado: 54/102 commits registrados, 50 completos y cinco parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`, `80ba2c0`). No representa paridad total. Siguiente: clasificar los cortes de version y cambios propios de Mono; verificar el port ya presente de `40aa9fe` y la correccion Codex de `c2b479d`, y continuar con los cambios aplicables al Harness.

## Hito 117: registrar animaciones de esfuerzo y el modelo opcional de Codex

`9ccfc09` solo actualiza version, changelog, lockfiles y fixtures de una publicacion MonoCode. `de033ff` corrige la composicion IME en pantallas exclusivas de Mono Agents. Ninguno cambia una superficie de producto aplicable de Voktty.

`40aa9fe` ya esta cubierto por `8bf442b`: las opciones max/ultra animadas se aplican a ajustes de esfuerzo reconocidos en todos los proveedores y la prueba local cubre el picker del Harness. `c2b479d` ya esta cubierto por `6d3ec03`: Codex omite tanto el modelo como collaborationMode hasta recibir un modelo no vacio, y luego usa el mismo id recortado en ambos campos.

Verificacion: `verify-ports.mjs --run-tests` correcto (56 commits registrados, 234 mapeos y 57 comandos); suites focalizadas de ModelPicker (8) y Codex (4); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. No hubo cambios de producto. Commit de trazabilidad: `683a6ee Track effort and Codex model ports`.

Estado: 56/102 commits registrados, 52 completos y cinco parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`, `80ba2c0`). No representa paridad total. Siguiente: adaptar `bdc2b64` al ciclo de notas de Voktty para que un slug provisional de una nota vacia se establezca al terminar el primer titulo real, manteniendo inmutables los slugs antiguos.

## Hito 118: finalizar slugs provisionales de notas

`bdc2b64` se adapto al almacenamiento SQLite compartido. Las notas creadas con titulo vacio reciben `slug_pending`; una migracion agrega la columna con valor falso para conservar todos los slugs existentes. El Harness confirma el slug cuando el titulo real sale del campo o se cierra el editor, y los guardados intermedios no lo fijan. Se mantienen los titulos generados desde el cuerpo, las notas antiguas y los titulos explicitos `Untitled`. El tablero local comparte el mismo almacenamiento y conserva la misma semantica al editar una nota pendiente.

Verificacion: `pnpm check-types`; `pnpm test` (645 archivos, 4712 pruebas; Host 123 correctas y cinco omitidas; siete pruebas Cortex eval); `pnpm lint` sin errores (1637 avisos y 18 infos); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1284 correctas, una leaky y una omitida); rustfmt focalizado correcto. `verify-ports.mjs --run-tests` correcto (57 commits, 241 mapeos y 59 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. El chequeo `cargo fmt --all -- --check` conserva diferencias preexistentes en otros modulos Rust, ya registradas en Hito 116; no se reformatearon archivos ajenos. No se hizo smoke SSH/Docker porque este cambio solo afecta notas. Commit de implementacion: `8ddcf81 Finalize generated note slugs after title entry`. Commit de trazabilidad: `2bdbe2b Track generated note slug finalization port`.

Estado: 57/102 commits registrados, 53 completos y cinco parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`, `80ba2c0`). No representa paridad total. La conexion remota del Harness sigue pendiente y debe usar el agente SSH de Voktty, tmux y recuperacion Docker. La pantalla inicial ya usa `VokttySignal` desde Hito 37. Siguiente: clasificar el siguiente cambio del inventario upstream y seguir con las superficies aplicables.

## Hito 119: registrar atajos del terminal y clasificar funciones Mono

`3597485` ya esta cubierto por `b74c021`: Cmd/Ctrl+T y Cmd/Ctrl+W operan sobre el terminal activo solo cuando el layout del dock esta habilitado, el dock tiene foco, el foco DOM sigue dentro y el id activo corresponde a una terminal. En otro caso conservan la accion del workspace. Voktty no tiene un dispatcher de menu nativo para el ajuste de broadcast que incluye el commit upstream; sus atajos de teclado estan cubiertos en el Harness.

Se clasificaron sin port `140c6e5` (chat flotante Mono y menu de barra), `03ae277` (fusionar respuestas de Mono despues de finalizar sesiones), `e79778c` (retrato de la barra de Mono en macOS) y `53d91c8` (Clippy en ese backend): Voktty no incorpora ese sistema Mono ni sus prompts/marcadores de finalizacion. `b1660e7` quita una prop obsoleta del ModelPicker upstream; el componente local tiene otra estructura y no conserva esa prop.

Verificacion: `verify-ports.mjs --run-tests` correcto (58 commits registrados, 245 mapeos y 60 comandos); suite `projectTerminal.test.ts` (15); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. No hubo cambios de producto. Commit de trazabilidad: `8a7beab Track focused terminal shortcut port`.

Estado: 58/102 commits registrados, 54 completos y cinco parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`, `80ba2c0`). No representa paridad total. La gestion remota sigue asignada al agente SSH nativo de Voktty, tmux y recuperacion Docker; la pantalla inicial diferenciada con `VokttySignal` sigue cubierta desde Hito 37. Siguiente: adaptar `eb14d1a` para que los catalogos vivos se actualicen aunque la interfaz ya muestre modelos de reserva.

## Hito 120: actualizar catalogos vivos desde ajustes

`eb14d1a` se adapto a las dos filas de proveedor de Voktty: el panel de Settings del Harness y la seccion de Harness de Preferencias. La carga inicial consulta `hasLiveCatalog`, no el numero de modelos mostrados, porque la lista de reserva puede estar poblada sin que el CLI haya entregado su catalogo real. El registry conserva la deduplicacion y evita volver a consultar un catalogo vivo. La prueba cubre Pi con su modelo de reserva presente y sin overlay vivo.

Verificacion: `pnpm check-types`; `pnpm test` (645 archivos, 4713 pruebas; Host 123 correctas y cinco omitidas; siete pruebas Cortex eval); `pnpm lint` sin errores (1637 avisos y 18 infos); `verify-ports.mjs --run-tests` correcto (59 commits registrados, 247 mapeos y 61 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. Commit de implementacion: `1002575 Refresh fallback provider catalogs in settings`. Commit de trazabilidad: `e1a937f Track live catalog refresh fix`.

Estado: 59/102 commits registrados, 55 completos y cinco parciales (`b93b95a`, `0eb2773`, `00d68d3`, `22b4874`, `80ba2c0`). No representa paridad total. La gestion remota del Harness sigue asignada al agente SSH de Voktty, tmux y recuperacion Docker; `VokttySignal` distingue la pantalla inicial desde Hito 37. Siguiente: adaptar `88994864` para que la privacidad de correos de cuenta este activada por defecto.

## Hito 121: ocultar por defecto los correos de cuenta

`88994864` se adapto a las preferencias compartidas del Harness. Los correos empiezan ocultos; el usuario puede revelarlos, y los valores guardados y los cambios entre ventanas siguen funcionando. Se actualizaron las pruebas de preferencias y del componente de correo, ademas de una prueba de identidad de proveedor que valida el render inicial.

Verificacion: `pnpm check-types`; `pnpm test` (645 archivos, 4713 pruebas); tres suites focalizadas (14 pruebas); `pnpm lint` sin errores (1637 avisos y 18 infos); `verify-ports.mjs --run-tests` correcto (60 commits registrados, 251 mapeos y 62 comandos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. No hubo cambios Rust ni smoke SSH/Docker porque el hito no modifica operaciones remotas. Commits: `65a7ee9 Mask provider account emails by default` (implementacion), `8333b1e Avoid returned value in preference cleanup` (ajuste de lint) y `ffa43cb Track default email masking port` (trazabilidad).

Estado: 60 commits de MonoCode registrados en el port frente a los 102 commits del inventario. La gestion remota del Harness sigue asignada al agente SSH de Voktty, tmux y recuperacion Docker. La pantalla inicial conserva `VokttySignal`, adaptada desde Hito 37. Siguiente: analizar `4d24fd7` y decidir que parte de los artefactos persistidos y adjuntos encaja en el AgentApp y las sesiones del Harness sin acoplar funciones exclusivas de MonoCode.

## Hito 122: clasificar artefactos y chats flotantes de Mono

`4d24fd7` anade documentos persistidos y tarjetas creadas por el AgentApp de Mono y por sus habitos, con un lector dentro del rail de Mono. Voktty ya tiene sesiones de agentes y notas persistidas, pero no tiene sesiones de Mono/habitos ni chat flotante Mono. Adaptar esta capacidad requeriria sumar una nueva superficie de producto y un contrato de persistencia; no es una correccion necesaria para mantener las superficies Harness comunes, asi que queda fuera de este port.

Tambien se clasificaron `9a7b6a2` (solo metadatos de la publicacion v0.9), `0ee745e` (eliminacion de un mockup), `11b5397` (rail y cambio de chat de Mono flotante), `c0d1fa0` (icono de menu bar exclusivo del chat Mono) y `1c53269` (overlay de artefactos dentro del chat Mono flotante). No cambian una superficie Harness equivalente de Voktty.

No hubo cambios de producto ni pruebas que ejecutar. Commit de clasificacion: `56fa7f0 Classify Mono artifact and floating chat features`. La trazabilidad formal sigue en `ports.json` para funcionalidades portadas; las exclusiones se documentan aqui, segun `integrations/monocode-010/README.md`.

Estado: 60 ports registrados y seis commits adicionales clasificados sin port; el inventario contiene 102 commits. Siguiente: revisar los cambios de historial y scroll del transcript (`296d7fd`, `b6e0db8`, `3e05e03`) contra la implementacion local, y continuar hacia la persistencia y la gestion de sesiones remotas.

## Hito 123: registrar scroll estable del historial

`296d7fd` queda cubierto por el layout de turnos a altura real de Voktty y el anclaje probado del transcript; el Harness no usa `content-visibility` para sustituir alturas de historial. La parte de scroll de `b6e0db8` tambien esta presente: el pin respeta los primeros ticks sin direccion del trackpad, el scroll manual y los cambios asincronos. Las pruebas locales cubren la rueda, el crecimiento del transcript y la fase de actividad en vivo. `bbb9162` y la parte visual de `b6e0db8` agregan firmas con mascota de Mono, sin equivalente en Voktty. La instrumentacion temporal de depuracion y la infraestructura Playwright del fork no se copiaron.

Verificacion: `verify-ports.mjs --run-tests` correcto (62 commits registrados, 255 mapeos y 64 comandos); ambas suites focalizadas de scroll pasaron (19 pruebas cada una); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. No hubo cambio de producto porque el comportamiento ya estaba en `74cfce0`. Commit de trazabilidad: `08f2a01 Track transcript scroll stability ports`.

Estado: 62 ports registrados y siete commits clasificados sin port; un registro queda parcial por los encabezados propios de Mono. Siguiente: registrar la preferencia nativa de correccion ortografica de macOS (`514400d`), ya adaptada en `22fa526`, y seguir hacia los cambios compartidos de sesiones remotas.

## Hito 124: registrar correccion ortografica nativa en macOS

`514400d` ya estaba adaptado por `22fa526`. Voktty registra `WebContinuousSpellCheckingEnabled` antes de iniciar Tauri en macOS, sin reemplazar preferencias guardadas, y el textarea del Harness activa `spellCheck`. La prueba de IME comprueba el atributo de spellcheck. La implementacion local registra el valor por defecto en `main.rs` en vez de introducir un comando adicional en el modulo macOS.

Verificacion: `Composer.ime.test.ts` (1); `verify-ports.mjs` correcto (63 commits registrados y 258 mapeos); cinco pruebas Node del auditor/verificador; auditoria estable (102 commits y 374 rutas); JSON y `git diff --check` correctos. No hubo cambio de producto; no se hizo una prueba de runtime en macOS en este entorno. Commit de trazabilidad: `3582204 Track native macOS spellcheck port`.

Estado: 63 ports registrados y siete commits clasificados sin port; un registro queda parcial por la firma de mascota Mono. Siguiente: revisar la limpieza de sesiones temporales y la conservacion de sesiones remotas; esta ultima debe seguir usando el agente SSH nativo de Voktty con recuperacion tmux para Docker.

## Hito 125: limpiar sesiones temporales de proveedores

`3e157b7` se adapto al ciclo de texto de Voktty. Codex marca como efimeros los hilos creados para texto auxiliar. Grok elimina la sesion ACP temporal por UUID, usando la ruta del binario resuelto y despues de parar el proceso que podria volver a escribirla. Rust y el backend Node restringen el borrado al proveedor Grok, a los argumentos exactos y a un UUID valido. OpenCode interrumpe y borra las sesiones de texto de v1 y v2 al terminar o cancelar. La limpieza tambien cubre errores y cambio de workspace.

La parte del upstream que hace persistentes las preguntas laterales de Codex no tiene un punto de llamada equivalente en Voktty; queda registrada como cobertura parcial, sin cambiar sus sesiones normales.

Verificacion: `pnpm check-types`; `pnpm test` (647 archivos y 4723 pruebas correctas); `pnpm lint` sin errores (1637 avisos y 18 infos); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1285 correctas, una leaky y una omitida); suite host focalizada (9 correctas); `verify-ports.mjs --run-tests` correcto (64 commits, 268 rutas y 67 comandos); JSON y `git diff --check` correctos. Biome paso en los archivos frontend cambiados salvo `child.ts`, que conserva diferencias de formato preexistentes ajenas a este cambio. Commit de implementacion: `034eb57 Clean up temporary Harness provider sessions`. Commit de trazabilidad: `4329ebd Track temporary provider session cleanup port`.

Estado: 64/102 commits upstream registrados; 57 completos y siete parciales. Siete commits adicionales estan clasificados sin port. No representa paridad total. La pantalla inicial conserva el efecto propio `VokttySignal` desde Hito 37. Siguiente: continuar el barrido de los commits aplicables y preparar la gestion remota del Harness sobre el agente SSH nativo de Voktty, con recuperacion tmux para hosts Docker.

## Hito 126: registrar navegacion por teclado del arbol de archivos

`bf5a30d` ya estaba cubierto por `2cf30ca`: el arbol del Harness admite flechas, Page Up/Down, Home/End, expansion de carpetas, activacion con Enter/Espacio, busqueda por prefijo y foco visible. Su suite focalizada paso (5 pruebas). No se cambio codigo de producto.

Se clasificaron `daaad71` (scrollbars de la fase Zen, superficie inexistente en Voktty), `004cab5`, `0b2c391` y `322fc2` (almacenamiento aislado de Mono para Codex y sus arreglos Windows), `eb5f69a` (habitos de Mono), `8a63eb6` (estilo de nombres de agentes dentro de turnos firmados por mascotas Mono), `6ec7c52` y `7c4bb7e` (superficies de producto Mono). No se agregan estas funciones exclusivas del fork al Harness de Voktty.

Verificacion: suite `FileTree.navigation.test.tsx` (5); `verify-ports.mjs` correcto (65 commits y 270 rutas); JSON y `git diff --check` correctos. Commit de trazabilidad: `cdb531a Track file tree keyboard navigation port`.

Estado: 65/102 commits upstream registrados; 58 completos y siete parciales. El port `b93b95a` sigue parcial: Voktty evita reusar una sesion remota restaurada como conversacion local, pero falta la vinculacion de tabs y conexiones sobre el agente SSH nativo. Siguiente: diseñar y adaptar esa vinculacion conservando el agente SSH de Voktty, tmux y la recuperacion de hosts Docker; revisar el transporte upstream solo como referencia de comportamiento.

## Hito 127: registrar ejecuciones Host seriales

`dddefe4` ya estaba cubierto por `db828c5`: la configuracion Vitest de Host ejecuta suites serialmente y concede 30 segundos a pruebas y hooks en todas las plataformas, para evitar contencion entre Git y procesos hijo. Se registra como port completo posterior al baseline; la configuracion local tambien conserva su alias TypeScript para los imports del backend.

Verificacion: `pnpm test:host` ejecuta el conjunto completo de integracion Host con esa configuracion (123 pruebas correctas y cinco omitidas). `child.test.ts` queda como prueba focalizada compatible con el runner Vitest raiz del ledger. Se comprueba el inventario upstream fijado (102 commits y 374 rutas), y el verificador confirma los mapeos registrados. Commit de trazabilidad: `705c6bf Track host Vitest concurrency port`.

Estado: 63/102 SHAs upstream unicos con port; 56 completos y siete parciales, despues de deduplicar tres filas repetidas del ledger. La equivalencia de Host no cierra la migracion remota del Harness: la fase de conexiones de maquinas sigue pendiente y debe usar el agente SSH de Voktty con tmux y recuperacion de hosts Docker. La pantalla inicial continua diferenciada por `VokttySignal` desde Hito 37. Siguiente: completar el control de unicidad del inventario y seguir clasificando cambios compartidos; tratar las superficies exclusivas de Mono como decisiones de producto, y no como paridad funcional del Harness.

## Hito 128: deduplicar SHAs del ledger

El ledger tenia filas duplicadas para `40aa9fe`, `c2b479d` y `3597485`; esas filas inflaban los recuentos de ports. Se combinaron sus mapeos y justificaciones en un unico registro por commit. `verify-ports.mjs` ahora resuelve cada referencia upstream y rechaza cualquier SHA repetido; una prueba Node cubre la regresion.

Verificacion: prueba `verify-ports.test.mjs` (3); `verify-ports.mjs` confirma 63 SHAs unicos y 264 mapeos; auditoria upstream estable (102 commits y 374 rutas); `pnpm check-types`; `pnpm test` (647 archivos, 4723 pruebas; Host 123 correctas y cinco omitidas); JSON y `git diff --check`. Commit: `0cc8163 Reject duplicate upstream port records`.

Estado: 63/102 commits unicos tienen un port registrado; 56 completos y siete parciales. Los otros 39 carecen de fila de port y requieren decision individual entre exclusion y trabajo pendiente; las notas de `PROMPTS` no se cuentan como cobertura verificada. La gestion remota del Harness sigue pendiente y debe migrar al agente SSH nativo con recuperacion tmux en hosts Docker. Siguiente: revisar el siguiente SHA sin registro y mantener los commits separados por hito.

## Hito 129: verificar la cobertura de merges upstream

Los merges `32fb2d1`, `271b66d` y `0923846` no introducen cambios unicos por portar. Sus ramas laterales estan cubiertas por commits registrados individualmente (`14cb1ed`, `6a5f7fa`, `e188ff1`, `e65ed82`, `e9fd233`, `a541016`, `c7de48f`; `e994afb`; y `6c67705`, `514400d`). Las rutas de cada diff de primer padre aparecen en esos commits, y `git show --remerge-diff` no muestra resoluciones exclusivas. La mejora GitLab para instancias antiguas ya esta adaptada por `9fca835` con pruebas de fallback y errores HTTP.

`ports.json` incorpora `mergeCoverage` y el verificador valida que cada merge sea unico, que enumere todos los commits laterales exactamente una vez, que estos tengan port individual, que sus rutas cubran el diff del merge y que no haya cambios de resolucion manual. La pantalla inicial ya usa `VokttySignal` en la sesion vacia y no monta el minijuego de MonoCode; el widget arcade sigue siendo una superficie independiente.

Verificacion: `node --test scripts/monocode/verify-ports.test.mjs` (4); `node scripts/monocode/verify-ports.mjs /workspace/app_projects/monocode --run-tests` (63 ports, 3 merges y 66 comandos focalizados); auditoria fijada de MonoCode (102 commits y 374 rutas); `pnpm check-types`; `pnpm test` (647 archivos, 4723 pruebas); `pnpm lint` sin errores (1637 avisos y 18 infos); JSON y `git diff --check`. Commit: `044094c Track upstream merge coverage`.

Estado: 63 commits con port mas tres merges verificados, 66/102; quedan 36 commits por clasificar individualmente. Gestion remota pendiente: usar el agente SSH nativo de Voktty, tmux y recuperacion Docker. Siguiente: revisar el siguiente SHA no cubierto del inventario.

## Hito 130: registrar exclusiones test-only, de release y apariencia

El ledger ahora registra exclusiones con categoria y razon, y el verificador informa cuantas entradas del rango fijado siguen sin decision. Se clasificaron cinco SHAs: `4361fdb` solo cambia pruebas de `GitChangesPanel`, superficie que Voktty no tiene; `807c70e`, `9ccfc09` y `9a7b6a2` solo ajustan artefactos de publicacion (el test adicional de `9ccfc09` es para el panel Checks ausente en Voktty); `889ac20` cambia el contrato global de apariencia macOS de MonoCode, independiente del Harness y de la implementacion de ventana propia de Voktty.

Verificacion: `node --test scripts/monocode/verify-ports.test.mjs` (5); verificador (63 ports, 3 merges, 5 exclusiones y 31 sin decision); auditoria fijada (102 commits, 374 rutas); `pnpm check-types`; `pnpm test` (647 archivos, 4723 pruebas); `pnpm lint` sin errores (1637 avisos y 18 infos); validacion JSON, sintaxis Node y `git diff --check`. Commit: `22d587d Track reviewed upstream exclusions`.

Estado: 71/102 SHAs tienen port o decision explicita; quedan 31. La pantalla inicial del Harness mantiene `VokttySignal` y el acceso remoto futuro debe usar el agente SSH nativo de Voktty, tmux y recuperacion Docker. Siguiente: agrupar y revisar los commits exclusivos de Mono frente a las capacidades comunes del Harness.

## Hito 131: pausar la cola cuando falla el proveedor

El commit upstream `850be653` combina el sistema nuevo de Mono Agents con cambios compartidos del Harness. Voktty conservaba la cola como `active` cuando llegaba `session.error`; al quedar la sesion inactiva, el efecto de despacho podia enviar el siguiente mensaje al proveedor que acababa de fallar. Ahora el reducer pausa la cola si quedan mensajes pendientes y los conserva. Sin mensajes pendientes no crea estado de cola.

Se difiere el evento `turn.ready` y el envio automatico de seguimientos durante un turno: Mono necesita esos cambios para agentes que mandan mensajes al mismo transcript, mientras Voktty entrega sus mensajes en cola cuando el proveedor termina. Tambien quedan fuera de este corte los agentes, memoria, habitos, transcript persistido y comandos de plataforma propios de Mono, ademas del manejo de limites de uso que requeriria integrar su estado y controles de recuperacion.

Verificacion: suite focalizada `apply.test.ts` (39); `pnpm check-types`; `pnpm test` (647 archivos y 4725 pruebas correctas; Host 123 correctas y cinco omitidas); `pnpm lint` sin errores (1637 avisos y 18 infos); `verify-ports.mjs --run-tests` correcto (64 ports, 3 merges, 5 exclusiones, 30 sin clasificar, 266 mapeos y 67 comandos); cinco pruebas Node del auditor/verificador; auditoria upstream estable (102 commits, 374 rutas); JSON y `git diff --check`. La gestion remota del Harness sigue asignada al agente SSH nativo de Voktty, tmux y recuperacion Docker. La pantalla inicial ya muestra `VokttySignal`, propia de Voktty, desde Hito 37.

Commits: `e782088 Pause queued follow-ups after provider errors` (implementacion y regresiones) y `156c2ef Track provider error queue port` (ledger). Estado: 72/102 SHAs con port o decision explicita: 56 completos, 8 parciales, 3 merges verificados y 5 exclusiones; quedan 30 sin clasificar. Siguiente: continuar la revision de esos SHAs.

## Hito 132: confirmar edicion del mensaje de commit sin seleccion

El cambio upstream `6ec7c52` quita la dependencia entre seleccionar archivos y editar el mensaje en `MonoProjectCommit`. El flujo `SessionChangesCommit` de Voktty ya dejaba editable el campo desde su implementacion `7e1af5c`; el test nuevo monta la superficie sin archivos seleccionados y protege ese comportamiento.

Verificacion: `SessionChangesCommit.test.tsx` (9); `pnpm check-types`; `pnpm test` (647 archivos y 4726 pruebas correctas; Host 123 correctas y cinco omitidas); Biome focalizado sin observaciones; `git diff --check`. No se requiere cambio funcional en el componente.

Commits: `13d3b57 Test editable commit message without file selection` (regresion) y `a54e246 Track existing commit message editing port` (ledger). El registro relaciona el componente local que introdujo esta capacidad en `7e1af5c` con la nueva prueba.

Estado: 73/102 SHAs con port o decision explicita: 57 completos, 8 parciales, 3 merges verificados y 5 exclusiones; quedan 29 sin clasificar. Siguiente: revisar los cambios de persistencia Codex para Mono y los ajustes de transcripcion compartida.

## Hito 133: clasificar almacenamiento Codex y ajustes de Mono

Se registran como `mono-only` siete SHAs revisados: `7c4bb7e` agrega preferencias de carpetas para chats Mono; `8a63eb6` ajusta las firmas de mascota en su transcripcion; `eb5f69a` prolonga el limite de los trabajos de habitos; `004cab5` crea el almacen Codex aislado de Mono; `0b2c391` y `322fc2a` reparan rutas, sincronizacion y junctions dentro de ese almacen; `e92d803` conecta la rotacion de contexto con las conversaciones Codex de Mono. Los flags y comandos de proveedor nuevos de estos commits solo son activados por las sesiones Mono y su almacenamiento privado; no existe un caller equivalente en Voktty.

Verificacion: auditoria upstream fijada (102 commits y 374 rutas); verificador (65 ports, 3 merges, 12 exclusiones, 22 sin decision y 267 mapeos); cinco pruebas Node del verificador; JSON y `git diff --check`. No hubo cambios de producto.

Commit de clasificacion: `0dca799 Classify Mono Codex storage features`. Estado: 80/102 SHAs con port o decision explicita: 57 completos, 8 parciales, 3 merges y 12 exclusiones. Siguiente: revisar la actividad y el cache de transcripcion que Mono modifica para mantener respuestas despues de cerrar las sesiones lanzadas.

## Hito 134: clasificar finalizacion y actividad de chats Mono

Se registran como `mono-only` `03ae277` (agrupar respuestas a prompts ocultos de sesiones lanzadas por Mono), `0f8e568` (mantener visibles respuestas entregadas en el flujo inline-work de Mono) y `432ac686` (cambiar su encabezado de mascota y la vista de actividad). El modelo de Voktty no tiene marcadores de finalizacion Mono ni mensajes optimistas asociados a sesiones hijas; la cola del Harness se despacha cuando el proveedor queda idle y sus seguimientos forman turnos normales. No se modifica el agrupador general del transcript.

Verificacion: auditoria upstream fijada (102 commits y 374 rutas); verificador (65 ports, 3 merges, 15 exclusiones, 19 sin decision y 267 mapeos); cinco pruebas Node del verificador; JSON y `git diff --check`. No hubo cambios de producto.

Commit de clasificacion: `4087fcf Classify Mono transcript completion flows`. Estado: 83/102 SHAs con port o decision explicita: 57 completos, 8 parciales, 3 merges y 15 exclusiones. Siguiente: revisar el ciclo de vida de sesiones lanzadas por Mono, el rail flotante y sus controles.

## Hito 135: clasificar ciclo de vida y controles de sesiones Mono

Se registran como `mono-only` `de83c79` (comandos privados de Mono para detener, archivar y borrar sesiones, mas conservar pestañas de escritorio al borrar), `0b7a21f` (persistencia y panel de sesiones lanzadas por un Mono), `d8902e7` (preferencia de visibilidad del historial para cada Mono) y `e5794cc` (icono del control de transcripcion Mono). El CLI de Mono controla pestañas de archivos de su propia aplicacion; `sessions.delete` de Voktty borra datos de sesion remota y no administra pestañas de escritorio. El Harness de Voktty tampoco tiene una lista de agentes Mono iniciados por turno.

Verificacion: auditoria upstream fijada (102 commits y 374 rutas); verificador (65 ports, 3 merges, 19 exclusiones, 15 sin decision y 267 mapeos); cinco pruebas Node del verificador; JSON y `git diff --check`. No hubo cambios de producto.

Commit de clasificacion: `4477a28 Classify Mono session lifecycle controls`. Estado: 87/102 SHAs con port o decision explicita: 57 completos, 8 parciales, 3 merges y 19 exclusiones. Siguiente: inspeccionar los cambios de rail y chat flotante de Mono contra las superficies existentes del Harness.

## Hito 136: cerrar el inventario fijado de MonoCode 0.10

El cambio `daaad71` queda cubierto como completo por el CSS global de Voktty: `html *` ya oculta las barras de desplazamiento nativas y los pseudo-elementos WebKit de todos sus descendientes, incluido el scroller de actividad Zen. Esa regla existe antes del baseline de integracion.

Se clasifican los otros 14 SHAs que quedaban. Son `mono-only` el rail y panel flotante de Mono, la integracion del icono de menu de macOS, sus ajustes visuales y permisos por perfil, el lector y almacenamiento de artefactos, el estilo de firmas de agente, el arreglo IME de sus pantallas y el ajuste Clippy de su modulo nativo. El arreglo IME equivalente de la Composer normal de Voktty ya usa `isImeComposition`. Se clasifican como `release-only` los cambios de actualizacion y WebKitGTK de AppImage Linux, que requieren evaluacion en el pipeline de Voktty, y como `not-harness` la eliminacion de un mockup de documento y la limpieza de una prop obsoleta en otro ModelPicker.

Verificacion: auditoria upstream estable (102 commits y 374 rutas); verificador (66 ports, 3 merges, 33 exclusiones, cero sin clasificar y 268 mapeos); cinco pruebas Node del verificador; JSON y `git diff --check`. No hubo cambios de producto.

Commit de clasificacion: `fb502a0 Classify remaining MonoCode 0.10 changes`. Estado: 102/102 SHAs con port o decision explicita: 58 completos, 8 parciales, 3 merges y 33 exclusiones. Los ocho parciales siguen teniendo trabajo diferido documentado; este conteo no representa paridad total. Siguiente: resolver las coberturas parciales priorizando bugs compartidos del Harness y mantener la conexion de ordenadores remotos en el agente SSH nativo de Voktty, con tmux y recuperacion en Docker.

## Hito 137: completar la precarga de GitHub desde Inbox

La inspeccion del port `00d68d34` encontro que el ledger afirmaba una precarga al pasar el cursor, pero el codigo de Voktty no la ejecutaba. Se agrega precarga al entrar con el puntero en una tarjeta GitHub del Inbox: detalles y comentarios para issues y PRs, y diff para PRs. Reutiliza las funciones y solicitudes en vuelo existentes; los errores de la precarga no interrumpen la interaccion. La accion se adapta a las tarjetas del Inbox de Voktty porque aqui no hay una accion de elemento vinculado en tarjetas de sesion.

Verificacion: prueba focalizada de frescura (4); `pnpm check-types`; `pnpm test` (647 archivos y 4728 pruebas); `pnpm lint` sin errores (1637 avisos y 18 infos); siete pruebas Node de auditor y verificador; verificador upstream (66 ports, 3 merges, 33 exclusiones, cero sin clasificar, 268 mapeos y 68 comandos focalizados); JSON y `git diff --check`.

Commit de producto: `2932424 Prefetch GitHub Inbox details on hover`. Commit del ledger: `525f282 Complete Inbox timeline prefetch port`. Estado del baseline: 102 SHAs con decision; al completar este port quedan 7 parciales. El siguiente contraste con el historial posterior descubrio que MonoCode retiro la precarga en `80ba2c0`; la adaptacion de hover de este hito se corrige en Hito 138.

## Hito 138: respetar la retirada de precarga por limites de GitHub

Al comparar `00d68d3` con el port posterior `80ba2c0`, se encontro que este ultimo elimina la precarga al pasar el cursor para bajar el volumen de solicitudes. La adaptacion al Inbox hecha en el hito anterior la reintroducia en una superficie distinta, asi que se retiro el helper y el evento de hover; los detalles se cargan al seleccionar una tarjeta. El ledger explica que la precarga de Hito 137 fue temporal y asocia la correccion al port de rate limits, que sigue parcial solo por el sondeo de Checks que no tiene una superficie equivalente en Voktty.

Verificacion: prueba focalizada de rate limits y frescura (6); `pnpm check-types`; `pnpm test` (647 archivos y 4726 pruebas); `pnpm lint` sin errores (1637 avisos y 18 infos); siete pruebas Node de auditor y verificador; verificador upstream (66 ports, 3 merges, 33 exclusiones, cero sin clasificar, 268 mapeos y 68 comandos focalizados); JSON y `git diff --check`.

Commits: `09dc36b Avoid Inbox hover prefetch after rate-limit port` y `42b9f4c Record rate-limit follow-up for Inbox hover`. Estado: 102 SHAs con decision y 7 ports parciales. Siguiente: revisar la conexion remota de OpenCode (`0eb2773`), el binding de pestañas remotas (`b93b95a`) y la creacion remota de worktrees (`22b4874`), usando el agente SSH nativo de Voktty con tmux y recuperacion en Docker.

## Hito 139: mantener el Host de Voktty en contenedores sin systemd

El servicio Host de Linux conserva systemd como primera opcion. Si el gestor de usuario no funciona, inicia el agente en la sesion tmux dedicada `voktty-host-service`; usa argumentos escapados para el runtime, el entry point, el directorio privado y el log. Si esa sesion ya existe pero el Host no responde, informa como inspeccionarla y no la reemplaza. La desinstalacion conserva el flujo de parada autenticada del CLI. `VOKTTY.md` documenta la alternativa para contenedores. La pantalla vacia del Harness ya usa el SVG `VokttySignal` desde `d764f18`, y su prueba comprueba que no monta canvas ni controles del minijuego.

Verificacion: prueba focalizada de servicio Host (7); `pnpm check-types`; `pnpm test` (647 archivos y 4726 pruebas); `pnpm lint` sin errores (1637 avisos y 18 infos); siete pruebas Node de auditor/verificador; verificador upstream (66 ports, 3 merges, 33 exclusiones, cero sin clasificar y 268 mapeos); JSON y `git diff --check`.

Commit de producto: `8a148a5 Run Linux Host in tmux without systemd`. Commit del ledger: `b93ea43 Record Docker Host tmux fallback port`. Estado: 102 SHAs con decision y 7 ports parciales. Sigue pendiente conectar OpenCode remoto y el binding de sesiones/pestañas a traves del agente SSH de Voktty; el fallback tmux permite que el servicio Host sobreviva al cierre del tunel en Docker, pero no completa aun esa integracion remota. Siguiente: rastrear las conexiones y el compositor de Harness para definir el flujo remoto autenticado, su recuperacion tmux y el cierre seguro.

## Hito 140: añadir tuneles loopback a la sesion SSH nativa

`RemoteSession` puede abrir y cerrar tuneles de servicios. Cada tunel usa un proceso SSH de forwarding propiedad de la sesion nativa, conserva la configuracion SSH y reutiliza su puente askpass; Voktty asigna un puerto local efimero, limita el bind local y el destino remoto a `127.0.0.1`, espera hasta 60 segundos a que escuche y admite como maximo ocho tuneles activos por sesion. Cerrar el tunel lo detiene; cerrar la sesion SSH detiene todos sus tuneles. Los comandos Tauri y el cliente tipado exponen ese contrato.

El hito entrega el transporte base, no la conexion remota de OpenCode completa: aun falta descubrir/iniciar el servicio en el host remoto, usar tmux para conservar y recuperar su proceso, obtener su credencial, enviar HTTP/SSE autenticado por el tunel y enlazar pestañas Harness sin estado obsoleto. No se adopta el Host Node remoto de MonoCode para este flujo.

Verificacion: prueba de cliente remoto (4); prueba focalizada Rust de argumentos loopback y puertos no nulos; `pnpm check-types`; `pnpm test` (647 archivos y 4727 pruebas); `pnpm lint` sin errores (1637 avisos y 18 infos); Biome focalizado limpio; `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1288 correctas y una omitida); `git diff --check`. No se probó SSH real ni un servicio OpenCode remoto. `cargo fmt --all -- --check` encuentra formato previo sin aplicar en `remote.rs`, `host.rs`, `ssh_native/connection.rs` y `tunnel/manager.rs`; las lineas nuevas del hito no aparecen en el diff de rustfmt.

Commit de producto: `b8069b3 Add native SSH remote tunnels`. El port `0eb2773` permanece parcial; el ledger registra el transporte loopback y conserva pendientes el ciclo de servicio, HTTP/SSE, tmux, reconexion y binding de pestañas. Estado: 102 SHAs con decision y 7 ports parciales. Siguiente: implementar descubrimiento, inicio y recuperacion tmux del servicio OpenCode a traves del agente SSH, y enlazar sus peticiones HTTP/SSE con la sesion remota autorizada.

## Hito 141: exponer el servicio OpenCode por el agente SSH nativo

El helper SSH de Voktty expone `opencode.service` con cuatro acciones fijas: version, estado, inicio y lectura de password. No acepta argumentos de CLI del frontend; valida que el directorio exista y permanezca dentro de la raiz autenticada, limita cada stream a 16 KiB y termina el proceso tras 30 segundos. El password viaja solo como resultado de la peticion SSH y no se registra. El cliente remoto tipado valida el resultado, y el binario Linux musl incluido se recompilo para que la nueva capability llegue a los equipos remotos.

Verificacion: `cargo test --locked -p voktty-remote` (25); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1293 correctas, una omitida); compilacion musl del helper y smoke del protocolo empaquetado; `pnpm check-types`; `pnpm test` (647 archivos, 4729 pruebas); `pnpm lint` sin errores (1637 avisos y 18 infos); Biome focalizado, rustfmt focalizado y `git diff --check`; auditor/verificador upstream (66 ports, 3 merges, 33 exclusiones, cero sin clasificar, 268 mapeos y 70 comandos focalizados), cinco pruebas del verificador. Graphify actualizado a 24404 nodos y 74685 relaciones; sigue marcando errores de extraccion previos en `host/child-backend.test.ts` y `src/modules/mcp/index.ts`. No se probo un OpenCode real por SSH ni un host Docker.

Commit de producto: `2b7c3ba Expose OpenCode service controls over SSH`. El port `0eb2773` sigue parcial: la UI Harness aun no usa estas acciones ni el tunel para HTTP/SSE. Estado: 102 SHAs con decision y 7 ports parciales. Siguiente: integrar el resolver OpenCode 2 remoto con la sesion nativa, Basic auth y HTTP/SSE por el tunel, mantener recuperacion de sesiones tmux y binding fresco de pestañas; despues verificarlo contra un host Docker por SSH.

## Hito 142: conectar sesiones OpenCode remotas por el agente nativo

El Harness detecta proyectos `remote://` y resuelve OpenCode 2.x a traves del helper SSH de Voktty. Reutiliza una configuracion SSH guardada cuando coincide la maquina, valida version y endpoint loopback, recupera el password con una accion fija y crea el tunel HTTP/SSE propiedad de la sesion nativa. El cliente conserva Basic auth y recibe el directorio real del host. Las aperturas concurrentes del mismo proyecto comparten el servicio y cada propietario libera su referencia; al aparcar, Voktty cierra el tunel y la sesion SSH, y al reanudar vuelve a comprobar el servicio y adopta la sesion OpenCode persistida. El catalogo remoto consulta el mismo servicio nativo. El efecto de pantalla vacia sigue siendo `VokttySignal`, sin el minijuego de MonoCode.

Verificacion: pruebas focalizadas de servicio, SSH, reanudacion y cliente remoto (21); `pnpm check-types`; `pnpm test` (649 archivos, 4739 pruebas); `pnpm lint` sin errores (1637 avisos y 18 infos); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1294 correctas y una omitida); compilacion musl y smoke del protocolo del helper; verificador upstream (66 ports, 3 merges, 33 exclusiones, cero sin clasificar, 268 mapeos y 70 comandos focalizados); `git diff --check`; Graphify actualizado (24432 nodos y 73444 relaciones), con los errores de extraccion previos en `host/child-backend.test.ts` y `src/modules/mcp/index.ts`. No se hizo una prueba con un servidor SSH/Docker real. La perdida del tunel durante una solicitud activa emite un error y no reconstruye automaticamente ese turno; reabrir/reanudar la sesion desde Harness vuelve a negociar el servicio y el tunel.

Commit de producto: `0ae6db2 Connect remote OpenCode through native SSH`. El ledger agrega `b8069b3` y `0ae6db2` al port `0eb2773`, que sigue parcial hasta verificar el flujo en un host Docker por SSH y decidir si se implementa reconexion durante un turno activo. Estado: 102 SHAs con decision y 7 ports parciales. Siguiente: validar el flujo con un host Docker accesible y continuar el binding de pestañas remotas y la recuperacion ante perdida de conexion.

## Hito 143: integrar busqueda y creacion nativa de worktrees

El selector de worktrees del sidebar ya permite buscar por rama o ruta y crear una rama desde el texto sin resultados. Se registran `git_worktrees` y `git_worktree_create` como comandos Tauri nativos; validan ramas y bases con Git, limitan el inventario, conservan el contexto local/WSL/SSH y autorizan los worktrees locales registrados. Los proyectos `remote://` abren una sesion temporal con el helper SSH autenticado de Voktty, ejecutan Git mediante su RPC y convierten las rutas de vuelta a `remote://`; cierran la sesion temporal al terminar. Esto tambien llega a servidores dentro de Docker cuando se conectan por SSH. Docker Engine directo se rechaza de forma explicita hasta que tenga adaptador Git nativo, para evitar ejecutar Git en el escritorio por accidente.

La lista generica aun reporta `dirty` y `unpushed` como desconocidos y no asocia ids de sesion; las acciones genericas de retirada no se ampliaron en este hito. No se hizo smoke contra SSH real ni contra un host Docker. El port upstream `22b4874` sigue parcial por el adaptador Docker directo, los metadatos y la verificacion remota.

Verificacion: pruebas focalizadas del selector y cliente de worktrees (7); `pnpm check-types`; `pnpm test` (650 archivos y 4743 pruebas); `pnpm lint` sin errores (1633 avisos y 18 infos); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1299 correctas, una leaky y una omitida); rustfmt focalizado con `skip_children`, `git diff --check`; auditor/verificador upstream (102 commits, 374 rutas; 66 ports, 3 merges, 33 exclusiones, cero sin clasificar y 270 mapeos); siete pruebas de scripts de integracion; Graphify actualizado (24478 nodos, 73558 relaciones y 574 comunidades). Graphify mantiene los dos errores de extraccion previos de `host/child-backend.test.ts` y `src/modules/mcp/index.ts`. El chequeo rustfmt recursivo tambien detecta formato previo ajeno al hito en `host.rs`, `remote.rs`, `ssh_native/connection.rs` y `tunnel/manager.rs`.

Commit de producto: `7feaa86 Add native Harness worktree creation`. Commit del ledger: `50c1c35 Record native worktree integration port`. Estado: 102 SHAs con decision y 7 ports parciales. Siguiente: auditar el binding remoto de `b93b95a` contra la arquitectura SSH nativa de Voktty antes de portar su helper de sesiones Host.

## Hito 144: delimitar el binding de sesiones remotas

La parte compartida de `b93b95a` ya esta cubierta: `projectReturn.ts` trata cualquier sesion `remote://` como no vacia aunque su transcript no se haya hidratado. Las sesiones OpenCode remotas activas conservan `providerSessionId` en su sesion Voktty y se reanudan por el helper SSH nativo. El helper upstream `remoteSessionTabs` encuentra pestañas por IDs de sesiones Host, pero Voktty no monta el picker de historial Host: `RemoteSession.tsx` no tiene un call site en la aplicacion. Portarlo como helper suelto no conectaria ningun flujo y reintroduciria el contrato de otra superficie. El ledger mantiene el port parcial; si Voktty incorpora un catalogo remoto, su binding debera usar proyecto, `providerSessionId` y el agente SSH/tmux.

Verificacion: pruebas de proyecto, sesion OpenCode remota y servicio SSH (30); siete pruebas del auditor/verificador; auditor upstream (102 commits y 374 rutas); verificador (66 ports, 3 merges, 33 exclusiones, cero sin clasificar y 270 mapeos); JSON y `git diff --check`. No hubo cambios de producto ni prueba completa necesaria para esta clasificacion.

Commit del ledger: `ae2b7b8 Clarify native remote session binding port`. Estado: 102 SHAs con decision y 7 ports parciales. Siguiente: seguir con los gaps reales de worktrees (`22b4874`) y OpenCode remoto (`0eb2773`), manteniendo el transporte remoto de Voktty y buscando un host contenedor disponible para el smoke SSH.

## Hito 145: informar estado de worktrees

El listado nativo de worktrees consulta `git status --porcelain=v2 --branch --ahead-behind` en el directorio de cada worktree y rellena `dirty` y el conteo de commits adelantados respecto al upstream. Si no hay upstream, el conteo queda desconocido; errores, timeout, rutas ausentes, salida truncada y agotamiento del presupuesto tambien dejan metadatos desconocidos. Cada consulta tiene un maximo de cinco segundos y la lista dedica como maximo quince segundos al estado. La ruta remota conserva el helper SSH autenticado de Voktty. `sessionIds` sigue vacio porque el selector generico no tiene catalogo ni binding de sesiones.

El port `22b4874` sigue parcial por la falta del adaptador de Git para Docker directo, un smoke real SSH contra un host contenedor y el binding de ids de sesion cuando exista un catalogo remoto en esa superficie. No se reactiva el dialogo remoto heredado de MonoCode, que enviaria operaciones por su Host Node.

Verificacion: pruebas focalizadas Rust de worktrees (8/8); `pnpm check-types`; `pnpm test` (650 archivos y 4743 pruebas); `pnpm lint` sin errores (1633 advertencias y 18 infos); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1302 correctas, una leaky y una omitida); cinco pruebas del verificador; auditor/verificador upstream (66 commits, 3 merges, 33 exclusiones, cero sin clasificar, 270 mapeos y 71 comandos focalizados); `git diff --check`; Graphify actualizado (24485 nodos, 73573 relaciones y 593 comunidades). Graphify conserva los errores de extraccion previos en `host/child-backend.test.ts` y `src/modules/mcp/index.ts`. `rustfmt --edition 2024 --check src/modules/git/worktrees.rs` solo marca una asercion preexistente al final del archivo, fuera del diff.

Commits del hito: producto `04b2561 Report worktree status metadata`; ledger `cb4b8b8 Record worktree status port`. No se hizo push.

Siguiente: continuar la auditoria de los ports parciales y preparar el flujo de gestion remota de ordenadores exclusivamente sobre el agente SSH nativo, incluyendo recuperacion tmux en contenedores. Buscar un host contenedor accesible para el smoke real antes de marcar como completa la ruta remota de worktrees.

## Hito 146: explorar carpetas remotas con el agente SSH nativo

El boton `Open folder` de cada equipo SSH en Conexiones abre el dialogo de proyectos remotos. El dialogo obtiene la configuracion SSH guardada, conserva `initialDirectory` y abre una sesion mediante el helper nativo de Voktty. La navegacion usa `fs.readDir` desde `workspace_root`, con rutas relativas normalizadas; solo ofrece directorios reales, no symlinks, y rechaza rutas absolutas o segmentos padre. Al cerrar o cambiar de equipo libera la sesion helper. Al elegir una carpeta, conserva el `environmentId` del catalogo actual para que Harness abra el proyecto remoto.

Este es un primer tramo de unificacion, no la gestion remota completa: la seleccion del equipo sigue dependiendo del catalogo de maquinas existente y otras operaciones de archivos, Git y sesiones remotas siguen usando rutas Host heredadas salvo OpenCode y worktrees ya migrados. El port `0eb2773` permanece parcial. No se ejecuto smoke SSH real ni contra Docker.

Verificacion: `pnpm check-types`; `pnpm test` (651 archivos y 4746 pruebas; Host: 126 correctas y cinco omitidas); `pnpm lint` correcto, con 1625 avisos y 18 infos; validacion de claves i18n; Biome focalizado sin errores; cinco pruebas del verificador; auditor/verificador upstream (66 ports, 3 merges, 33 exclusiones, cero sin clasificar, 270 mapeos y 71 comandos focalizados); `ports.json` valido; `git diff --check`. No se probo un host SSH/Docker real.

Commit de producto: `a3fb897 Browse remote Harness folders over native SSH`. El ledger actualiza el estado del port `0eb2773` sin atribuir este cambio propio a un SHA upstream. No se hizo push.

Siguiente: desacoplar la identidad del equipo remoto del catalogo Host y permitir seleccionar perfiles guardados de SSH nativo directamente; despues enrutar las operaciones remotas de proyecto que falten por el agente, conservando tmux para recuperacion en contenedores. Buscar un host Docker accesible y probar conexion, navegacion y reanudacion real antes de cerrar los ports remotos.

## Hito 147: crear proyectos Harness desde perfiles SSH nativos

`Open folder` ahora permite elegir un perfil SSH guardado sin depender del catalogo Host. Los proyectos nuevos usan `remote://voktty-ssh-<id URI-encoded>/...`; la identidad no contiene credenciales y OpenCode 2.x y worktrees resuelven el perfil actual desde Preferencias antes de abrir el helper autenticado. Un perfil eliminado falla de forma cerrada, sin intentar resolver un equipo Host. Los IDs de maquinas existentes siguen usando la ruta anterior. `VOKTTY.md` documenta este contrato. La exploracion inicial, la apariencia propia `VokttySignal` y el servicio OpenCode con recuperacion tmux ya estaban en hitos anteriores.

El port `0eb2773` permanece parcial: el explorador general de archivos, otras operaciones Git y algunas rutas de sesiones Harness aun dependen de Host. No se probo un servidor SSH ni un host Docker real; tampoco hay reintento automatico de una solicitud que pierde el tunel durante un turno OpenCode activo.

Verificacion: pruebas focalizadas de perfil, dialogo, OpenCode y worktrees (16); `pnpm check-types`; `pnpm test` (652 archivos y 4752 pruebas; Host: 126 correctas y cinco omitidas); `pnpm lint` correcto (1625 avisos y 18 infos); validacion i18n; Biome focalizado en los nueve archivos TS/TSX; `git diff --check`; cinco pruebas Node del verificador; verificador upstream con 66 ports, 3 merges, 33 exclusiones, cero SHAs sin clasificar, 270 mapeos y 72 comandos; Graphify actualizado (24498 nodos, 73643 relaciones y 607 comunidades), con errores de extraccion preexistentes en `host/child-backend.test.ts` y `src/modules/mcp/index.ts`. `pnpm format:check` de todo `src/` sigue marcando 792 archivos preexistentes; el formato focalizado del hito pasa.

Commit de producto: `5a263ea Create remote Harness projects from SSH profiles`. El ledger actualiza el alcance de `0eb2773` sin declararlo completo. Estado: 102 SHAs con decision; 7 ports parciales. Siguiente: adaptar `remoteCommands.ts`, que hoy resuelve `remoteMachineFor` y manda los archivos por `workspace.run` al Host. Para perfiles directos, resolver una raiz de proyecto registrada y usar los metodos `fs.*` del helper; preservar el control `expectedContent` y cerrar escapes por symlinks antes de exponer escrituras. Luego migrar Git y el historial Host, conservar la recuperacion tmux en Docker y localizar un host contenedor para el smoke de conexion, navegacion y reanudacion.

## Hito 148: operar archivos de proyectos SSH con el helper nativo

Las operaciones de archivos de proyectos `remote://voktty-ssh-<id>/...` abren el helper SSH autenticado de Voktty y usan `fs.*`, sin pasar por Terax Host. La ruta exige un proyecto guardado, restringe todos los argumentos a la misma raiz y cierra la sesion al terminar. Los guardados envian `expectedContent` para que el helper rechace cambios concurrentes justo antes del reemplazo atomico. El helper valida los destinos de mutacion contra symlinks externos, limita la copia recursiva a 256 MiB y 20.000 entradas y limita cada directorio a 20.000 elementos. El listado de proyecto es acotado y no sigue symlinks; el listado de directorios conserva la navegacion de solo lectura existente.

Limites conocidos: `list_project_files` aplica la lista de exclusiones integrada y solo patrones simples del `.gitignore` de raiz; `read_file_preview` usa el limite de lectura de 8 MiB del helper. Git, busqueda y gestion de sesiones para perfiles directos siguen fallando de forma cerrada mientras se migran. Los IDs heredados de maquinas siguen usando Host. No habia un host SSH/Docker disponible para una prueba real.

Verificacion: `pnpm check-types`; `pnpm test` (652 archivos y 4757 pruebas); `pnpm lint` sin errores (1626 avisos y 18 infos); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked -p voktty-remote -p voktty-remote-protocol` (34/34); `cargo fmt` focalizado; Prettier focalizado; smoke local del binario empaquetado (handshake, `fs.copy` y CAS `expectedContent`); cinco pruebas del verificador; verificador (66 ports, 3 merges, 33 exclusiones, cero commits sin clasificar y 270 mapeos). El `cargo nextest run --locked` completo no pudo compilar `voktty` por falta de espacio al crear `libvoktty_lib.a`; `verify-ports --run-tests` se detuvo en el mismo fallo; no se afirman como pasados. El build canonico `pnpm build:remote` tampoco esta disponible sin `pwsh`/WSL; el binario Linux se compilo con Cargo musl y paso el smoke local.

Commits: producto `d99277f Route native SSH project files through helper`; ledger `bf9e9e8 Record native SSH file operation port`. No se hizo push.

Siguiente: migrar la busqueda y las operaciones de Git de proyectos de perfiles directos al helper con `fs.grep` y una ruta `git.exec` confinada a la raiz autenticada; conservar la ruta Host para los IDs heredados. Despues completar catalogo/historial y recuperacion de sesiones, y probar contra un contenedor SSH real.

## Hito 149: enrutar busqueda Harness y preparar Git confinado

`searchProject` ahora usa `invokeWorkspace`, por lo que la busqueda Harness remota pasa por el mismo enrutador que los archivos. Los perfiles SSH nativos envian `fs.grep` al helper: admite subdirectorios, devuelve un maximo de 500 resultados con ubicaciones UTF-16 y convierte las rutas a la raiz del proyecto. El helper rechaza directorios de busqueda absolutos, traversal y symlinks que apunten fuera; una solicitud de busqueda invalida no cancela una busqueda valida en curso. La ruta Host existente sigue funcionando para los IDs de maquina anteriores.

Se agrega `git.execWorkspace`, que canonicaliza el `cwd` bajo la raiz autenticada y rechaza rutas absolutas externas y escapes por symlink. Se mantiene `git.exec` para los flujos SSH ya existentes que consultan worktrees fuera de la raiz inicial. El panel Git de proyectos de perfiles directos aun falla de forma cerrada; se migrara en el siguiente hito usando solo comandos Git fijos sobre la nueva capacidad.

Verificacion: `pnpm check-types`; `pnpm test` (652 archivos y 4761 pruebas); `pnpm lint` sin errores (1626 avisos y 18 infos); Prettier focalizado; Biome focalizado (un aviso preexistente de non-null assertion en `remoteCommands.ts`); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked -p voktty-remote -p voktty-remote-protocol` (38/38); `cargo fmt` focalizado; smoke del binario Linux empaquetado (busqueda anidada, CAS `expectedContent` y rechazo de `git.execWorkspace` fuera de la raiz); cinco pruebas Node del verificador; verificador upstream (66 ports, 3 merges, 33 exclusiones, cero sin clasificar y 270 mapeos); Graphify actualizado (24554 nodos y 75152 aristas). El `cargo nextest run --locked` completo falla al compilar `libvoktty_lib.a` por espacio insuficiente. `pnpm build:remote` requiere `pwsh`/WSL ausentes en este entorno; se recompilo el helper con Cargo musl. No se probo un SSH/Docker real.

Commits: producto `04ee7e1 Route native SSH project search through helper`; ledger `af8f1aa Record native SSH project search port`. No se hizo push.

Siguiente: migrar Git de proyectos de perfiles directos a `git.execWorkspace`, empezando por estado, diffs e historial local; despues agregar operaciones de escritura y sincronizacion con limites y validacion. Luego abordar catalogo de sesiones, recuperacion tmux en Docker y smoke contra un contenedor SSH real.

## Hito 150: enrutar estado y diffs Git por SSH nativo

El panel Harness ya lee el estado Git y las diferencias de archivos de perfiles SSH directos usando comandos fijos sobre `git.execWorkspace`; no pasa por Terax Host. Los resultados se limitan a la raiz autenticada y se convierten a rutas `remote://`. El helper captura como maximo 4 MiB por stream, drena el excedente y reporta truncamiento; los diffs de archivo limitan blobs a 1 MiB.

Verificacion: `pnpm check-types`; `pnpm test` (653 archivos y 4769 pruebas); Vitest focalizado (23 pruebas); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked -p voktty-remote -p voktty-remote-protocol` (40/40); compilacion Linux musl y smoke local de handshake y limite Git; `rustfmt` focalizado; `node --check` del smoke; `git diff --check`; cinco pruebas Node del verificador; verificador upstream (66 ports, 3 merges, 33 exclusiones, cero sin clasificar y 270 mapeos). `cargo nextest run --locked` completo y el filtro focalizado sin selector de paquete no pudieron compilar `libvoktty_lib.a` por `No space left on device`; no se afirman como pasados. El smoke canonico WSL no esta disponible sin `wsl.exe`; tampoco se probo SSH/Docker real.

Limites: los conteos de lineas de archivos sin seguimiento son cero. Stage, unstage, discard, commit, sync, ramas, historial y catalogo de sesiones para perfiles directos siguen pendientes; las solicitudes activas no se recuperan automaticamente al perder el tunel. Falta probar contra un contenedor SSH real.

Commit de producto: `7243754 Route native SSH Git status and diffs through helper`. El port `0eb2773` sigue parcial. No se hizo push.

Siguiente: migrar las operaciones Git de escritura y sincronizacion con validacion por raiz; despues completar historial/catalogo y recuperacion de sesiones por tmux, conservando la gestion remota exclusivamente sobre el agente nativo de Voktty. Probar conexion, Git, navegacion y reanudacion con un host Docker real antes de cerrar el port.

## Hito 151: enrutar stage, unstage y discard Git por SSH nativo

Las operaciones `git_stage_file`, `git_unstage_file`, `git_stage_all`, `git_unstage_all`, `git_discard_file` y `git_discard_all` para perfiles SSH guardados usan el helper nativo de Voktty mediante `git.execWorkspace`. Los comandos se envian como argumentos fijos con pathspecs literales; las rutas individuales deben quedar dentro del proyecto autenticado. Descartar restaura los archivos versionados al contenido del indice y elimina los archivos sin seguimiento, conservando lo ya staged. Los IDs heredados de maquinas siguen pasando por Host.

Verificacion: `pnpm check-types`; `pnpm test` (653 archivos, 4773 pruebas; Host: 126 correctas y cinco omitidas); Vitest focalizado de comandos Git remotos (27 pruebas); Biome focalizado (sin errores, un aviso previo de non-null assertion); Prettier focalizado; `git diff --check`; Graphify actualizado (24579 nodos, 73887 relaciones y 602 comunidades). No hubo cambios Rust. No se probo contra SSH/Docker real.

Commit de producto: `fc65524 Route native SSH Git file actions through helper`. Se actualizo `integrations/monocode-010/ports.json`; el port `0eb2773` sigue parcial. No se hizo push.

Siguiente: soportar stage de contenido aun no guardado sin escribirlo en el worktree, lo que requiere entrada limitada para `git.execWorkspace`; despues portar commit y sincronizacion. Luego completar ramas, historial, catalogo y recuperacion de sesiones por tmux. Mantener la gestion remota mediante el agente nativo y validar contra un contenedor SSH real antes de cerrar el port.

## Hito 152: stage del buffer remoto sin guardar

`gitStageContents` para perfiles SSH guardados envia el buffer al helper mediante la nueva capability `git.execWorkspaceInput`. El helper limita la entrada a 8 MiB y solo acepta `git hash-object -w --path <ruta-relativa> --stdin`; el cliente toma el modo actual del indice y registra el blob con `update-index`, sin escribir el worktree. Los helpers antiguos que no anuncian la capability fallan de forma explicita antes de enviar el contenido. Se amplia el smoke local para probar que el indice contiene el buffer y el archivo del worktree conserva su contenido.

Verificacion: `pnpm check-types`; `pnpm test` (653 archivos, 4776 pruebas); Vitest focalizado de Git remoto (30); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked -p voktty-remote -p voktty-remote-protocol` (42/42); compilacion del helper Linux musl y actualizacion del recurso empaquetado; smoke local enfocado Git (pasa); `node --check`, Prettier focalizado y `git diff --check`; Graphify actualizado sin cambios topologicos y con los errores de extraccion previos en `host/child-backend.test.ts` y `src/modules/mcp/index.ts`. El smoke completo termina por timeout despues de `pty-open`; el smoke Git aislado pasa. No hay WSL ni servidor SSH/Docker real disponible.

Commit de producto: `8d7f0b0 Stage unsaved remote editor contents`. El port `0eb2773` sigue parcial. No se hizo push.

Siguiente: migrar commit y sincronizacion de Git para perfiles directos al helper SSH con argumentos fijos y limites; despues portar ramas, historial y catalogo/recuperacion de sesiones por tmux. Mantener la gestion del host bajo el agente nativo de Voktty y ejecutar el smoke integral contra un contenedor SSH real antes de cerrar el port.

## Hito 153: generar contexto y crear commits Git remotos

`git_staged_context` ahora consulta por el helper SSH el diff preparado o, si el indice esta vacio, el diff de trabajo y los nombres de archivos sin seguimiento. La salida de cada comando se limita a 4 MiB. Antes de leerla, el cliente verifica que la raiz real del repositorio quede dentro de la raiz del proyecto guardado, para no incluir cambios de un repositorio padre. La API Harness `harness_git_commit` tambien usa el helper con argumentos fijos; los mensajes se limitan a 16 KiB y Git dispone de 120 segundos para hooks. Los IDs heredados de maquinas conservan Host.

Verificacion: `pnpm check-types`; `pnpm test` (653 archivos, 4781 pruebas; Host: 126 correctas y cinco omitidas); Vitest focalizado de comandos remotos (31); Biome sin errores y con un aviso previo de non-null assertion; Prettier focalizado; `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked -p voktty-remote -p voktty-remote-protocol` (43/43); `rustfmt --edition 2021 --check` focalizado; `git diff --check`; Graphify actualizado (24590 nodos, 73930 aristas y 602 comunidades), con errores previos de extraccion en `host/child-backend.test.ts` y `src/modules/mcp/index.ts`. No se probo contra SSH/Docker real.

Commit de producto: `82aca0f Route native SSH Git commits through helper`. El port `0eb2773` sigue parcial. No se hizo push.

Siguiente: portar push, pull y sync para perfiles directos por el helper SSH de Voktty, conservando fast-forward y validaciones de rama; despues ramas, historial y catalogo/recuperacion de sesiones por tmux. Ejecutar el smoke integral contra un contenedor SSH real antes de cerrar el port.

## Hito 154: enrutar push, pull y sync por SSH nativo

La implementacion en el arbol enruta `harness_git_push`, `git_push`, `git_pull` y `git_sync` al helper de Voktty. Antes de operar, verifica que la raiz real del repositorio quede dentro del proyecto guardado. El primer push elige `origin` o el primer remoto y configura upstream; pull usa fast-forward; sync con upstream hace pull fast-forward y luego push, y sin upstream configura el primer push. Cada comando de red tiene un timeout del helper de 180 segundos y salida acotada. El cliente SSH espera el timeout anunciado mas diez segundos; el resto de metodos conserva 60 segundos. Esta politica vive en `RemoteRequest::response_timeout` y su test esta en el crate de protocolo.

Verificacion: `pnpm check-types`; `pnpm test` (653 archivos, 4.784 pruebas y 126 Host correctas con cinco omisiones); `cargo clippy --all-targets --locked -- -D warnings`; `cargo nextest run --locked` (1.318/1.318 correctas, una omitida), mas los 46 tests focalizados de helper/protocolo; Prettier focalizado, Biome sin errores con un aviso previo de non-null assertion, rustfmt de protocolo/helper y `git diff --check`. Clippy y Nextest informan el aviso futuro de compatibilidad ya asociado a `russh v0.54.5`. El ledger valida con 66 ports, tres merges, 33 exclusiones y cero commits sin clasificar. Sin smoke SSH/Docker real; las dos lineas de comandos enviadas por el usuario no incluyeron salida que confirme su ejecucion.

Commit de producto: `7967cb0 Route direct profile Git sync through native SSH`. Commit del ledger: `7b18cab Record native SSH Git sync port`. No se hizo push. El port `0eb2773` permanece parcial. `cargo nextest run --locked` completo pasa con 1.318 pruebas correctas y una omitida; no se borraron artefactos Cargo. Siguiente: completar ramas por el helper nativo, luego revisar historial y catalogo/recuperacion de sesiones.

Reauditoria del 2026-10-11: el checkout fijado de MonoCode esta disponible en `/workspace/app_projects/monocode`; el path de host `/opt/docker/thecodingmachine/www/app_projects/monocode` no existe en este contenedor. `node scripts/monocode/verify-ports.mjs /workspace/app_projects/monocode` pasa: 66 ports, tres merges, 33 exclusiones y cero commits sin clasificar; no ejecuta tests. Las lineas de comandos de smoke remoto enviadas por el usuario no incluyeron salida, por lo que no confirman una conexion ni una ejecucion real en SSH/Docker.

## Hito 155: ramas Git por el helper SSH nativo

Los perfiles SSH directos ya consultan ramas locales y tracking remotas con el helper autenticado de Voktty. El parser conserva el orden y filtros del Harness local, incluye la rama actual aun cuando no tenga commit y representa HEAD detached. Checkout valida el nombre con `git check-ref-format`, elige una rama local o crea una rama de tracking para la remota seleccionada; los cambios locales que bloquean el checkout usan el mensaje esperado por el dialogo de stash. Crear rama y stash tambien usan argv fijos, con nombres de rama limitados a 1 KiB y mensajes de stash a 16 KiB. Los IDs de maquina heredados conservan Host.

Verificacion: `pnpm check-types`; `pnpm test` (653 archivos, 4.792 pruebas; Host: 126 correctas y cinco omitidas); `pnpm lint` sin errores (1.626 avisos y 18 infos preexistentes); Vitest focalizado (46); Biome focalizado sin errores y con un aviso anterior de non-null assertion; Prettier focalizado; `git diff --check`; `graphify update .` (24.612 nodos, 74.012 relaciones y 574 comunidades, con los dos errores de extraccion ya registrados). Un repositorio temporal local confirmo que `git checkout --track -b feature/remote origin/feature/remote` crea upstream correctamente. Sin prueba SSH/Docker real.

Commit de producto: `5352058 Route SSH branch operations through helper`. Commit del ledger: `f03514f Record SSH branch operations port`. `ports.json` valida con 66 ports, tres merges, 33 exclusiones y cero commits sin clasificar. No se hizo push. Siguiente: revisar el flujo de historial Git y los comandos nativos existentes para decidir el port minimo por perfiles directos; despues catalogo y recuperacion tmux. Mantener pendiente el smoke completo con un contenedor SSH real.

## Hito 156: portar los comandos de historial Git al helper SSH nativo

Los perfiles SSH directos ya exponen `git_history`, `git_commit_files` y `git_commit_file_diff` mediante `git.execWorkspace`. El historial limita la consulta a 500 commits y valida que la raiz real del repositorio pertenezca al proyecto guardado. Los SHA se validan antes de usarlos como argumentos; la lista de archivos usa salida NUL, rechaza estados/rutas invalidos y limita el resultado a 20.000 archivos. Los blobs de commit tienen un limite de 1 MiB y las respuestas truncadas no devuelven texto parcial. Se mantiene la salida de rutas `remote://` que usa Voktty.

Este port cubre el enrutador compartido, pero la vista Git History de Voktty sigue llamando su API Tauri separada y aun no consume estos comandos para perfiles directos. La integracion visual de esa vista queda para el siguiente hito. No hay smoke remoto real: esta sesion solo ofrece una shell local y no puede seleccionar el perfil SSH de la app. No se ejecutaron localmente los comandos de sentinel como si fueran una prueba remota.

Verificacion: `pnpm check-types`; `pnpm test` (653 archivos, 4.801 pruebas); Vitest focalizado (55); `pnpm lint` sin errores, con 1.626 avisos y 18 infos preexistentes; Prettier focalizado para los cuatro archivos TypeScript; Biome focalizado sin errores y con el aviso previo de non-null assertion; Graphify confirma el camino `runRemoteCommand` a `nativeProfileGitHistory`; `git diff --check`. Prettier sobre todo `VOKTTY.md` sigue reportando formato previo fuera de las lineas modificadas. No hubo cambios Rust ni pruebas SSH/Docker reales.

Commit de producto: `d77e9a8 Route SSH commit history through helper`. El ledger de ports actualiza el alcance de `0eb2773` como parcial: los contratos de historial estan portados, pero su vista, catalogo/recuperacion de sesiones, recuperacion de tunel durante un turno y smoke Docker siguen pendientes. No se hizo push.

Siguiente: conectar la vista Git History a `invokeWorkspace` para perfiles SSH directos, conservando la API Tauri para proyectos locales; despues migrar el catalogo de sesiones y la recuperacion tmux por el agente nativo. Mantener pendiente el smoke real contra un contenedor SSH.

## Hito 157: conectar las lecturas de Git History con SSH nativo

`native.gitResolveRepo`, `gitLog`, `gitCommitFiles` y `gitCommitFileDiff` ahora detectan identidades `remote://voktty-ssh-*` y usan `invokeWorkspace`, preservando Tauri para repositorios locales y las rutas remotas heredadas. El helper devuelve la raiz canonica `remote://` para que Git History pueda abrirse desde archivos dentro del proyecto. El filtro de todas las ramas se transmite como `git log --all`; el filtro de rama actual usa `HEAD`. Los metadatos de archivos de commit y sus blobs pasan por el helper, con validacion de rutas dentro del proyecto, estado binario y limites existentes. Se actualiza `VOKTTY.md` y el registro distingue estas lecturas de las acciones aun pendientes.

La vista ya puede resolver el repositorio, cargar commits y abrir sus diffs para un perfil directo. El panel de metadata y las acciones de URL remota, fetch/pull/push, checkout, crear rama/tag, cherry-pick y revert aun llaman comandos Tauri; no se afirma paridad completa. Persisten el catalogo y la recuperacion de sesiones, la recuperacion del tunel durante turnos activos y el smoke con SSH/Docker. Aunque el usuario indico usar el perfil/proyecto ya seleccionado, esta sesion no expone una herramienta de conexion al runtime Voktty; no se ejecutaron los sentinels en esta shell local ni se cuentan como prueba remota.

Verificacion final del codigo: `pnpm check-types`; `pnpm test` (654 archivos, 4.806 pruebas); `pnpm lint` sin errores (1.626 avisos y 18 infos preexistentes; i18n: 792 archivos y 3.714 claves); Vitest focalizado (60); Biome focalizado sin errores y con un aviso previo de non-null assertion; Prettier focalizado en los seis archivos nuevos/modificados aparte de `native.ts` pasa. `native.ts` sigue reportando el desacuerdo de formato preexistente en su union `GitOperationKind`. `git diff --check` pasa. `graphify update .` deja 24.644 nodos, 74.110 relaciones y 581 comunidades; se mantienen los errores de extraccion en `host/child-backend.test.ts` y `src/modules/mcp/index.ts`. No hubo cambios Rust.

Commit de producto: `449c58c Route Git History reads through native SSH`. Commit del ledger: `a21f93e Record Git History SSH integration`. No se hizo push. `ports.json` sigue parcial; el smoke remoto y las acciones de Git History descritas arriba siguen pendientes.

Siguiente: enrutar los metadatos y acciones restantes de Git History mediante el agente SSH nativo, reutilizando los comandos Git ya implementados y preservando la ruta Tauri local. Despues completar catalogo y recuperacion tmux, y ejecutar el smoke autorizado con el perfil seleccionado cuando el runtime de Voktty este accesible.

## Hito 158: conectar metadata y sincronizacion de Git History por SSH nativo

`native.gitHistoryMetadata`, `gitListBranches`, `gitRemoteUrl`, `gitFetch`, `gitPullFfOnly`, `gitPush` y `gitCheckoutBranch` ahora enrutan perfiles `remote://voktty-ssh-*` al agente autenticado. El helper mantiene la raiz dentro del proyecto guardado, valida nombres de remotos, consulta URLs con `git config --get`, usa `fetch --prune` y pull fast-forward, y devuelve el resultado de push con remoto y rama. Los proyectos locales conservan sus comandos Tauri. Crear commits, tags, cherry-pick y revert siguen pendientes.

Verificacion: `pnpm check-types`; `pnpm test` (654 archivos, 4.811 pruebas); Host (126 correctas, cinco omitidas); Vitest focalizado (55); `pnpm lint` sin errores (1.626 avisos y 18 infos preexistentes; i18n: 792 archivos y 3.714 claves); Biome sin errores y un aviso previo de non-null assertion; Prettier focalizado pasa excepto `native.ts`, que mantiene el desacuerdo anterior en la union `GitOperationKind`; `git diff --check`; Graphify actualizado (24.659 nodos, 74.166 aristas, 590 comunidades; dos errores de extraccion previos); verificador de ports (66 commits upstream, tres merges, 33 exclusiones, cero sin clasificar). No hubo cambios Rust.

Commit de producto: `5687bb3 Route Git History actions through native SSH`. Commit del ledger: `c96fb22 Record Git History SSH actions integration`. No se hizo push. El usuario eligio el perfil/proyecto seleccionado, pero la sesion no ofrece un conector al runtime de Voktty; no se ejecutaron los comandos sentinel en la shell local ni se cuentan como smoke SSH real. El port `0eb2773` sigue parcial.

Siguiente: migrar las acciones restantes de commits y tags de Git History al agente SSH, luego revisar compare/cherry-pick/revert y el catalogo con recuperacion tmux. Ejecutar el smoke autorizado contra el perfil seleccionado cuando el runtime de Voktty sea accesible.

## Hito 159: commits, patches y tags de Git History por SSH nativo

`native.gitCommit`, `gitShowCommit` y las operaciones de tags ahora enrutan perfiles SSH directos mediante `invokeWorkspace` y el helper autenticado. Los commits admiten los archivos seleccionados, limitan mensaje, rutas, cantidad y tiempo de hook, comprueban que la raiz Git queda dentro del proyecto y devuelven el SHA y asunto. La exportacion de patches limita la salida y valida el commit. Las tags validan el nombre con Git, limitan cantidad/salida y enrutan lectura, creacion, borrado y push por argumentos fijos. Los proyectos locales siguen en Tauri. Quedan crear ramas desde commits, cherry-pick y revert.

La peticion visual de reemplazar el minijuego ya esta cubierta por `d764f18`: `EmptySession` monta el efecto SVG `VokttySignal`, y no `TerminalGridBackground` ni el canvas del arcade. No se duplico ese cambio.

Verificacion: `pnpm check-types`; `pnpm test` (654 archivos, 4.816 pruebas); Vitest focalizado (60); `pnpm lint` sin errores (1.626 avisos y 18 infos existentes; i18n: 792 archivos y 3.714 claves); Biome focalizado sin errores, con un aviso previo de non-null assertion; Prettier focalizado pasa excepto `native.ts`, cuyo unico desacuerdo es la union `GitOperationKind` existente; `git diff --check`; Graphify (24.671 nodos, 74.223 aristas, 591 comunidades; persisten dos errores de extraccion previos); verificador upstream (66 commits, tres merges, 33 exclusiones, cero sin clasificar y 270 mapeos). `ports.json` parsea. No hubo cambios Rust. El runtime de Voktty no esta expuesto en esta sesion: no se ejecutaron sentinels como prueba SSH.

Commit de producto: `66f82af Route Git commits and tags through native SSH`. Commit del ledger: `295e09b Record Git commits and tags SSH integration`. No se hizo push; el port `0eb2773` sigue parcial.

## Hito 160: completar compare y mutaciones de Git History por SSH nativo

`native.gitBranchFromCommit`, `gitCherryPickCommit`, `gitRevertCommit`, `gitCompareBranches`, `gitOperationStatus`, `gitOperationAbort` y `gitOperationContinue` ahora usan el helper SSH autenticado para perfiles directos; los proyectos locales conservan Tauri. El helper confina cada repositorio al proyecto guardado, valida nombres de ramas y SHA de commits, usa argv fijos, limita salida y da hasta 30 segundos a las mutaciones. El estado de conflicto conserva el orden de deteccion de merge, cherry-pick, revert y rebase, y continuar una operacion fija `core.editor=true`.

Una prueba con Git real mostro que combinar `--name-status` y `--numstat` omite los conteos en la salida de Git. Compare ahora ejecuta ambas consultas por separado y analiza rutas NUL, incluidas rutas con tabulaciones y renombres, para devolver conteos efectivos de inserciones, eliminaciones y binarios. El adaptador valida la forma de la respuesta y rechaza rutas que salgan del proyecto.

Verificacion: `pnpm check-types`; `pnpm test` (654 archivos, 4.821 pruebas); Vitest focalizado (65); `pnpm lint` sin errores, con avisos preexistentes; Prettier focalizado para los cuatro archivos TypeScript salvo la discrepancia previa de `native.ts` en `GitOperationKind`; Biome lint focalizado sin errores y con un aviso previo de non-null assertion; `git diff --check`; `graphify update .` (24.691 nodos, 74.295 aristas y 588 comunidades; permanecen dos errores de extraccion previos); verificador upstream (66 commits, tres merges, 33 exclusiones, cero sin clasificar y 270 mapeos). No hubo cambios Rust.

Commit de producto: `3d9c8df Route Git History conflicts and compare through SSH`. El port `0eb2773` sigue parcial: faltan el catalogo/reanudacion de sesiones y recuperacion tmux, otras superficies como stash/worktrees, la recuperacion del tunel durante un turno activo y un smoke SSH/Docker real. No se ejecutaron los comandos sentinel en la shell local; esta sesion no ofrece conector de Voktty para el perfil seleccionado.

Siguiente: migrar stash list/save/apply/pop/drop por el agente SSH nativo conservando Tauri local; despues continuar con el catalogo remoto y la reanudacion/recuperacion tmux, y ejecutar el smoke autorizado contra el perfil seleccionado cuando el runtime de Voktty sea accesible.

## Hito 161: stash de Git History por SSH nativo

`native.gitStashList`, `gitStashSave`, `gitStashApply`, `gitStashPop` y `gitStashDrop` ahora usan el helper autenticado para perfiles SSH directos; los proyectos locales siguen en Tauri y los IDs remotos heredados no reciben estos comandos helper-only. El helper valida la raiz del repositorio, limita la lista a 20.000 entradas y los mensajes a 16 KiB, usa argumentos Git fijos y limita las mutaciones a 30 segundos. `includeUntracked` conserva su valor elegido en la UI.

Las pruebas cubren lista, guardado con y sin untracked, apply/pop/drop, indice y forma de respuesta invalidos, limite de tiempo y rechazo de la ruta remota heredada. La prueba local de Git confirma el formato de metadatos; no es un smoke por SSH.

Verificacion: `pnpm check-types`; `pnpm test` (Host: 126 correctas y cinco omitidas; Vitest: 654 archivos, 4.823 pruebas); `pnpm lint` sin errores (1.626 avisos y 18 infos); Vitest focalizado (67); Biome lint focalizado sin errores y con un aviso previo de non-null assertion; Prettier pasa en los cuatro archivos TypeScript restantes; las comprobaciones completas tambien registran discrepancias de formato anteriores en `native.ts` (`GitOperationKind`) y `VOKTTY.md`; `git diff --check`; Graphify (24.699 nodos, 74.325 aristas y 567 comunidades); verificador de ports (66 commits upstream, tres merges, 33 exclusiones, cero sin clasificar y 270 mapeos). No hubo cambios Rust ni de dependencias.

Commit de producto: `110cbc4 Route Git History stashes through native SSH`. Commit del ledger: `1d4f756 Record Git History stash SSH integration`. No se hizo push. El runtime de Voktty no esta expuesto en esta sesion: el perfil seleccionado queda autorizado para el smoke, pero no se ejecuto ninguna instruccion sentinel local ni se afirma prueba SSH real. El port `0eb2773` sigue parcial.

Siguiente: auditar el flujo activo de gestion remota del Harness y confirmar que todas las operaciones de perfiles SSH usan el agente nativo de Voktty; revisar como reutilizar el picker tmux existente sin introducir el catalogo Host. Ejecutar el smoke contra el perfil seleccionado cuando el runtime de Voktty sea accesible. El efecto inicial `VokttySignal` ya reemplaza el minijuego desde el commit `d764f18`.

## Hito 162: renovar el helper SSH tras perder el flujo SSE

Cuando el flujo SSE de OpenCode v2 falla, Harness invalida la lease del helper SSH nativo asociada a esa sesion. El siguiente envio abre un helper y un tunel nuevos y reutiliza el mismo `providerSessionId`. Al compartir helper, solo se desvincula el propietario afectado; los demas siguen conectados. Si no se puede abrir el reemplazo, el siguiente intento mantiene la renovacion pendiente y no vuelve al canal fallido.

El turno interrumpido sigue reportando error y necesita un nuevo intento; no hay reanudacion automatica del turno. La auditoria confirma que el catalogo remoto Host no aplica al modelo de Harness de Voktty: la app persiste sus sesiones localmente y conserva el ID de OpenCode, que mantiene el historial remoto. No se agrego una ruta de gestion Host ni se cambio la ruta Tauri de proyectos locales.

Verificacion: `pnpm check-types`; `pnpm test` (Host: 126 correctas y cinco omitidas; Vitest: 654 archivos, 4.826 pruebas); Vitest focalizado (14); `pnpm lint` sin errores (1.626 avisos y 18 infos); Biome focalizado sin errores y con una advertencia previa de non-null assertion; Prettier pasa en helper y pruebas, mientras `opencode.ts` conserva discrepancias de formato previas fuera de las lineas cambiadas; `git diff --check`; Graphify (24.700 nodos, 74.328 aristas y 573 comunidades); verificador de ports (66 commits upstream, tres merges, 33 exclusiones, cero sin clasificar y 270 mapeos). No hubo cambios Rust ni dependencias.

Commit de producto: `1a8759e Reconnect remote Harness sessions after SSH stream loss`. Commit del ledger: `d0b91c2 Record native SSH reconnect integration`. No se hizo push. El perfil seleccionado esta autorizado para el smoke, pero el runtime de Voktty no esta conectado a esta sesion y no se ejecuto ningun sentinel local. La continuacion automatica del turno y el smoke SSH/Docker real siguen pendientes; el port `0eb2773` permanece parcial.

## Hito 163: terminales remotos de Harness por el helper SSH nativo

Las terminales de proyectos directos `remote://voktty-ssh-<id>` resuelven el perfil SSH guardado y abren su PTY mediante el helper autenticado de Voktty. La PTY recibe la ruta del servidor y su `WorkspaceEnv` SSH; conserva la configuracion tmux del perfil. La lease del helper se cierra al cerrar la terminal, al salir el proceso o si falla la apertura de la PTY. OSC 7 vuelve a guardar el cwd como `remote://`, y las rutas remotas invalidas, sin proyecto guardado o sin perfil se rechazan en vez de abrir una PTY local.

La terminal Harness aun no reutiliza el selector interactivo de sesiones tmux cuando hay varias sesiones o una sesion conectada; por ahora recibe los ajustes tmux guardados en el perfil. No se conecto al catalogo remoto Host. No se ejecuto smoke SSH real: aunque se autorizo el perfil/proyecto seleccionado, esta sesion no ofrece el runtime/conector de Voktty y los comandos enviados no aportan salida que confirme ejecucion remota.

Verificacion: `pnpm check-types`; `pnpm test` (Host: 126 correctas y cinco omitidas; Vitest: 655 archivos y 4.833 pruebas); `pnpm lint` sin errores (1.626 avisos y 18 infos); Prettier focalizado pasa en cuatro archivos; `TerminalView.tsx` conserva su discrepancia previa de formato en `oscColor`; `git diff --check`; Graphify actualizado (24.709 nodos, 74.369 aristas, 584 comunidades; dos errores previos de extraccion). No hubo cambios Rust. No se hizo push.

Commit de producto: `7126ef3 Route Harness remote terminals through native SSH`. Commit del ledger: `65dd997 Record Harness remote terminal SSH integration`.

## Hito 164: reutilizar el selector tmux en terminales Harness

Las terminales remotas activas de Harness reutilizan `SshSessionPickerModal`. El selector aparece cuando el perfil guardado esta en modo `ask` o el sondeo SSH detecta varias sesiones o alguna sesion adjunta. La accion y el nombre elegidos se convierten en la configuracion de multiplexer que reciben tanto el helper SSH autenticado como la PTY remota. Cancelar la seleccion no abre la sesion remota; las terminales inactivas restauradas siguen usando el perfil guardado sin abrir un modal en segundo plano.

Las pruebas cubren la politica de aparicion, la conversion de la seleccion, el paso de la sesion tmux al helper, la cancelacion, el montaje inactivo y el desmontaje mientras espera seleccion.

Verificacion: `pnpm check-types`; `pnpm test` (656 archivos y 4.842 pruebas); `pnpm lint` sin errores (1.625 avisos y 18 infos); checker i18n (793 archivos y 3.714 claves); pruebas focalizadas (18); Prettier focalizado; `git diff --check`; Graphify actualizado (24.720 nodos, 74.409 aristas y 550 comunidades); verificador de ports (66 commits upstream, tres merges, 33 exclusiones, cero sin clasificar y 270 mapeos). No hubo cambios Rust ni dependencias.

Commit de producto: `6a6c767 Route Harness terminals through tmux picker`. El runtime de esta sesion no permite controlar la interfaz Voktty con el perfil/proyecto seleccionados, asi que no ejecute los comandos sentinel en la shell local ni afirmo un smoke SSH/Docker real. No se hizo push.

Siguiente: auditar las superficies restantes del port `0eb2773`, empezando por las operaciones de worktree y su ruta para perfiles SSH directos; mantener el smoke con el perfil/proyecto seleccionado pendiente hasta tener acceso al runtime de Voktty.
