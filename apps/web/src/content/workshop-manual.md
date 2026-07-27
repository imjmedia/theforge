# Manual del Workshop (TheForge)

## 1. Qué es esta pantalla

El **Workshop** es la vista de trabajo de un **proyecto**: tres columnas.

| Zona | Función |
|------|---------|
| **Izquierda — Conversación** | Chat con el orquestador de IA. Según el **tab** central (MDD, Spec, Legacy, etc.), los mensajes van al flujo adecuado. Puedes escribir **`/`** para ver comandos (p. ej. regenerar una sección del MDD). |
| **Centro — Documentos** | Pestañas con el contenido generado o editado: Benchmark (Paso 0), MDD, Spec, arquitectura, casos, historias, blueprint, guía UX/UI, contratos API, flujos, infra, tasks, ADRs… |
| **Derecha — Semáforo y costos** | Estado del MDD respecto a la **Constitución SDD** (semáforo) y **estimación** en MXN. El botón **Generar entregables** lanza la cascada de documentos cuando el semáforo está en verde y hay Spec. |

Arriba a la derecha: **Descargar todo (ZIP)** agrupa los documentos con contenido en un archivo.

---

## 2. Orden recomendado del flujo

En el propio Workshop suele mostrarse una cadena del tipo:

`MDD → Spec → Arq. → Casos → H.U. → Blueprint → Guía UX/UI → API → Flujos → Tasks → Infra` (y **Paso 0** opcional: benchmark / investigación).

- **Paso 0 (opcional):** Benchmark & Gap Analysis (competencia, URLs, deep research). Alimenta el Spec y el contexto del MDD. Tras el stream del benchmark puede aparecer un **banner de complejidad propuesta** (HITL): confirma o descarta desde ahí, o escribe en el chat (p. ej. «sí, ejecuta este plan»); hasta confirmar, el nivel no queda aplicado al proyecto. En proyectos ya existentes puedes pulsar **Re-Valorar** (arriba en el chat) para volver a inferir la propuesta desde tu DBGA/MDD actual y abrir la entrevista sin regenerar todo el benchmark.

**Complejidad media (producto nuevo):** en la barra de documentos no verás MDD ni entregables fuera de la matriz (Spec → API → Guía UX/UI → Tasks); el insumo sigue siendo Paso 0 / Spec. Las pestañas con contenido se muestran con fondo verde esmeralda; las vacías, con borde punteado gris.
- **MDD (Master Design Document):** documento maestro de 7 secciones; gobierna el resto (SDD).
- **Spec:** benchmark + alcance clarificado; conviene tenerlo antes de cerrar el MDD.
- **Entregables:** cuando el **semáforo** está en verde y existe Spec, usa **Generar entregables** (o generación individual desde cada pestaña) para arquitectura, casos, historias, blueprint, API, flujos, infra, etc.

**Legacy:** el tab **Modificación** sustituye el Paso 0. El tab **MDD Inicial** es donde se **genera** (o regenera) la documentación de partida desde AriadneSpecs (`POST …/legacy/generate-codebase-doc`): botón grande en el panel vacío, enlace en **Modificación** si aún no hay doc de partida, o **Generar documentación de partida** en la barra de acciones. Puedes:

- **Ingeniería inversa:** Con solo la documentación de partida (MDD Inicial), usa **Generar entregables** para obtener Spec, Arq., Casos, Blueprint, API, etc. que describan el sistema existente — sin necesidad de describir una modificación.
- **Modificación:** Describe el cambio en Modificación → AriadneSpecs analiza → responde preguntas → Generar MDD → Generar entregables. Las modificaciones se documentan al agregar una **nueva etapa**.

---

## 3. Semáforo y estimación

- **Rojo / Amarillo / Verde:** indica si el MDD cumple reglas mínimas (entidades, contratos, casos límite, etc.) para generar código y documentos pesados.
- **Precisión %:** desglose de la última auditoría; puedes abrir **Ver logs y desglose**.
- **Estimación:** horas y MXN por rol; fórmula fija (no es “precio comercial” obligatorio, es referencia interna).

Sin **verde + Spec** no se habilita la generación masiva de entregables coherente con el diseño.

---

## 4. Chat: qué pedir

- Pide cambios al MDD en lenguaje natural; el **Manager** delega en Clarifier, Arquitecto, etc.
- Usa **`/`** en el campo de texto para **regenerar solo una sección** (1–7) sin rehacer todo el documento.
- En proyectos **Legacy**, describe la modificación en **Modificación**; el sistema consulta el contexto del repositorio vía AriadneSpecs cuando aplica.

---

## 5. Etapas (`Stage`)

Cada proyecto puede tener **varias etapas** (`Stage`): cada una tiene su propio **MDD**, **semáforo**, **precisión** y **estimación**. Los entregables **globales** del proyecto (Spec, Blueprint, etc. en la raíz del `Project`) siguen siendo compartidos salvo que el producto diga lo contrario.

En el **Workshop**, el **selector de etapa** (cuando hay más de una) define el foco: el MDD central, el semáforo y la estimación se leen/escriben con **`stageId`** en `PATCH` del proyecto y en los streams MDD (`/ai-analysis/mdd/...`). La **bienvenida** del orquestador acepta `stageId` para alinear el contexto al MDD de esa etapa (no solo al aplanado por defecto).

**Hilo del Manager (LangGraph)** y **checkpoint** (`AgentStateCheckpoint`) son **por etapa**: al cambiar de etapa, el front pide `GET /ai-analysis/mdd/thread?projectId=&stageId=` para rehidratar el `threadId` correcto.

**Chat por etapa (brownfield):** con **más de una etapa** en proyectos **LEGACY**, el chat filtra por defecto a la **etapa activa** (`chatScope: stage`). Puedes alternar **«Ver global»** en la barra del chat para el historial completo del tab. El contexto enviado al LLM (orquestador) usa el mismo alcance. Mensajes antiguos sin `stageId` no aparecen en vista por etapa.

**En la UI:** con **más de una etapa**, la barra sobre el chat indica si ves solo la etapa activa o el historial global. Al cambiar de etapa en modo global, un aviso recuerda que pueden mezclarse líneas AS-IS y delta.

**Nueva etapa:** botón **Nueva etapa** junto al selector → modal y `POST /projects/:projectId/stages` (respuesta `{ stage }`). En el modal, **Copiar MDD desde** permite elegir cualquier etapa existente o dejar el MDD vacío. El selector del header cambia la **vista en vivo** (MDD/semáforo de la etapa activa).

### Checklist manual (multi-etapa)

1. Crear o seleccionar proyecto con al menos dos etapas.
2. Cambiar el selector de etapa y comprobar que el MDD/semáforo cambian.
3. Abrir flujo Manager en etapa A, interrumpir; cambiar a etapa B — debe mostrar otro hilo o vacío según datos.
4. Generar MDD desde Benchmark con etapa B seleccionada — borrador en vivo y métricas deben corresponder a B.

---

## 6. Cómo organizar varias líneas de trabajo

| Enfoque | Cuándo usarlo |
|---------|----------------|
| **Varias etapas en un proyecto** | Releases o líneas de diseño paralelas con MDD separado por etapa (selector + API `stageId`). |
| **Varios proyectos** | Aislar por completo historial, chat y alcance cuando no quieres compartir nada. |
| **API / scripts** | `PATCH` con `stageId`, creación de `Stage` vía REST; detalle en `docs/notebooklm/STAGE-SDD.md`. |

**Etapas Workshop** (selector, REST, MDD por `stageId`): `docs/notebooklm/STAGE-SDD.md`.

---

## 7. Sincronización y errores

- **Sincronizado / Sincronizando:** indica si los cambios locales del documento activo están alineados con el servidor.
- Si aparece un **mensaje de error** en rojo arriba, léelo; suele ser timeout de IA, validación o red. Puedes cerrarlo con la **X** y reintentar la acción.

---

## 8. Más documentación

En el repositorio del producto: `docs/notebooklm/STAGE-SDD.md`, `docs/notebooklm/THEFORGE-INDEX.md`, `docs/notebooklm/ENTREGABLES-SDD-VALIDACION.md` (flujo SDD y validación).
