/**
 * Catálogo allowlist de configuración de plataforma (UI Ajustes → Sistema + tabla AppConfig).
 * Prioridad en runtime: BD → env → defaultValue.
 */

export type SystemConfigCategory =
  | "integrations"
  | "llm"
  | "queues"
  | "mcp"
  | "legacy"
  | "debug"
  | "cost";

export type SystemConfigFieldType = "string" | "number" | "boolean" | "secret";

export interface SystemConfigDefinition {
  key: string;
  envKey: string;
  type: SystemConfigFieldType;
  defaultValue: string;
  label: string;
  description: string;
  category: SystemConfigCategory;
  min?: number;
  max?: number;
  /** Si true, la UI enmascara el valor y PATCH vacío no borra el secreto existente. */
  secret?: boolean;
  /** BullMQ/workers: el valor en BD aplica tras reiniciar el proceso worker. */
  restartRequired?: boolean;
}

export const SYSTEM_CONFIG_CATEGORIES: ReadonlyArray<{
  id: SystemConfigCategory;
  label: string;
  /** Texto breve para la UI (Ajustes → Sistema): alcance e impacto de la categoría. */
  description: string;
}> = [
  {
    id: "integrations",
    label: "Integraciones",
    description:
      "Conexión con MCP Ariadne, documentación Context7, búsqueda Tavily y converge brownfield. Sin MCP configurado, los proyectos LEGACY no indexan ni generan doc. de partida.",
  },
  {
    id: "llm",
    label: "LLM y LangGraph",
    description:
      "Límites globales del motor de IA y del grafo LangGraph (MDD, chat, entregables). Afecta longitud de respuestas, coste por token e iteraciones del Manager/Auditor.",
  },
  {
    id: "queues",
    label: "Colas BullMQ",
    description:
      "Paralelismo de jobs en background (MDD y entregables). Más concurrencia acelera generaciones simultáneas pero exige más CPU/RAM; requiere reiniciar el worker.",
  },
  {
    id: "mcp",
    label: "MCP y caché",
    description:
      "Timeouts y caché de llamadas MCP (TheForge y Context7). Reduce latencia y evita cortes en ingest largos; TTL alto puede servir contexto desactualizado tras cambios en Ariadne.",
  },
  {
    id: "legacy",
    label: "Legacy / brownfield",
    description:
      "Comportamiento de proyectos LEGACY: diagramas, pipeline evidencia-primero, gates de índice y merge de entregables. Desactivar flags acelera pero puede bajar calidad o trazabilidad.",
  },
  {
    id: "debug",
    label: "Depuración",
    description:
      "Logs y atajos solo para diagnóstico. En producción aumentan ruido en consola y pueden exponer payloads sensibles; OTP dev nunca debe quedar activo en entornos reales.",
  },
  {
    id: "cost",
    label: "Coste & facturación",
    description:
      "Conversión de moneda y límites de facturación IA. El tipo de cambio MXN/USD es un valor estimado (no live) que el usuario introduce en Ajustes → Sistema y se conserva en BD; úselo solo como referencia para la conversión de USD a MXN mostrada en la columna de métricas y el panel de Coste IA.",
  },
] as const;

function def(
  key: string,
  envKey: string,
  type: SystemConfigFieldType,
  defaultValue: string,
  label: string,
  description: string,
  category: SystemConfigCategory,
  extra?: Pick<SystemConfigDefinition, "min" | "max" | "secret" | "restartRequired">,
): SystemConfigDefinition {
  return { key, envKey, type, defaultValue, label, description, category, ...extra };
}

export const SYSTEM_CONFIG_DEFINITIONS: readonly SystemConfigDefinition[] = [
  def(
    "theforge_mcp_url",
    "THEFORGE_MCP_URL",
    "string",
    "",
    "TheForge MCP — URL",
    "Endpoint HTTP del MCP AriadneSpecs (LEGACY, brownfield, herramientas del arquitecto). Vacío desactiva indexación, converge y doc. de partida desde código.",
    "integrations",
  ),
  def(
    "tech_docs_mcp_default_url",
    "TECH_DOCS_MCP_DEFAULT_URL",
    "string",
    "https://mcp.context7.com/mcp",
    "Docs técnicas — URL MCP por defecto",
    "URL de Context7 cuando el usuario no define la suya en Ajustes → Docs técnicas. Determina qué documentación de librerías alimentan Spec, Blueprint y entregables.",
    "integrations",
  ),
  def(
    "tavily_api_key",
    "TAVILY_API_KEY",
    "secret",
    "",
    "Tavily — API key",
    "Clave para búsqueda web en Scout y Fase 0. Vacía desactiva búsqueda en internet sin bloquear el resto del taller.",
    "integrations",
    { secret: true },
  ),
  def(
    "ariadne_brownfield_converge_auto",
    "ARIADNE_BROWNFIELD_CONVERGE_AUTO",
    "boolean",
    "1",
    "Brownfield — auto converge",
    "Al crear un proyecto LEGACY, lanza converge en el repo vía MCP si está configurado. Acelera onboarding pero puede tardar y modificar el remoto de Ariadne.",
    "integrations",
  ),
  def(
    "ariadne_brownfield_converge_mode",
    "ARIADNE_BROWNFIELD_CONVERGE_MODE",
    "string",
    "incremental",
    "Brownfield — modo converge",
    "Alcance del converge en el repo: off, incremental, full o all. Modos más amplios tardan más y tocan más archivos del índice.",
    "integrations",
  ),
  def(
    "ariadne_brownfield_converge_persist",
    "ARIADNE_BROWNFIELD_CONVERGE_PERSIST",
    "boolean",
    "0",
    "Brownfield — persistir converge",
    "Guarda el resultado del converge en el repositorio Ariadne. Desactivado = efecto transitorio; activado = cambios persistidos en el grafo.",
    "integrations",
  ),
  def(
    "llm_max_tokens",
    "LLM_MAX_TOKENS",
    "number",
    "131072",
    "LLM — tope global max_tokens",
    "Techo de tokens de salida por llamada LLM; los perfiles por tarea nunca lo superan. Valores altos permiten documentos largos pero suben coste y latencia.",
    "llm",
    { min: 1024, max: 1_000_000 },
  ),
  def(
    "langgraph_recursion_limit",
    "LANGGRAPH_RECURSION_LIMIT",
    "number",
    "50",
    "LangGraph — límite de recursión",
    "Pasos máximos del grafo LangGraph por invocación (MDD Manager, pipeline). Bajo puede cortar pipelines; alto permite más reintentos del Auditor.",
    "llm",
    { min: 10, max: 500 },
  ),
  def(
    "agent_evaluator_legacy",
    "AGENT_EVALUATOR_LEGACY",
    "boolean",
    "0",
    "Evaluador legacy en respuesta",
    "Incluye el evaluador legacy en la respuesta del orquestador de chat. Útil para depurar calidad; añade tokens y latencia a cada mensaje.",
    "llm",
  ),
  def(
    "mdd_bullmq_concurrency",
    "MDD_BULLMQ_CONCURRENCY",
    "number",
    "2",
    "Cola MDD — concurrencia",
    "Jobs MDD (pipeline LangGraph) procesados en paralelo por worker. Más valor = más generaciones simultáneas y mayor carga en CPU, RAM y APIs LLM.",
    "queues",
    { min: 1, max: 8, restartRequired: true },
  ),
  def(
    "deliverables_bullmq_concurrency",
    "DELIVERABLES_BULLMQ_CONCURRENCY",
    "number",
    "2",
    "Cola entregables — concurrencia",
    "Jobs de entregables greenfield en paralelo por worker. Subir acelera cascadas simultáneas; bajar reduce picos de memoria en el servidor.",
    "queues",
    { min: 1, max: 6, restartRequired: true },
  ),
  def(
    "legacy_deliverables_bullmq_concurrency",
    "LEGACY_DELIVERABLES_BULLMQ_CONCURRENCY",
    "number",
    "1",
    "Cola legacy entregables — concurrencia",
    "Jobs legacy/generate-deliverables en paralelo por worker. Legacy suele ser más pesado; conviene mantener bajo en instancias pequeñas.",
    "queues",
    { min: 1, max: 4, restartRequired: true },
  ),
  def(
    "theforge_mcp_timeout_ms",
    "THEFORGE_MCP_TIMEOUT_MS",
    "number",
    "60000",
    "TheForge MCP — timeout (ms)",
    "Tiempo máximo por llamada MCP rápida (tools JSON-RPC). Muy bajo falla en redes lentas; muy alto retiene conexiones ocupadas.",
    "mcp",
    { min: 1000, max: 600_000 },
  ),
  def(
    "theforge_mcp_ask_codebase_timeout_ms",
    "THEFORGE_MCP_ASK_CODEBASE_TIMEOUT_MS",
    "number",
    "900000",
    "TheForge MCP — timeout ask_codebase (ms)",
    "Timeout exclusivo para ask_codebase (ingest/indexación de repos). Operaciones de minutos; bajarlo corta ingests grandes.",
    "mcp",
    { min: 60_000, max: 3_600_000 },
  ),
  def(
    "tech_docs_mcp_timeout_ms",
    "TECH_DOCS_MCP_TIMEOUT_MS",
    "number",
    "15000",
    "Docs técnicas — timeout MCP (ms)",
    "Tiempo máximo por llamada al MCP Context7. Afecta generaciones que consultan docs de librerías en §2 y entregables.",
    "mcp",
    { min: 1000, max: 120_000 },
  ),
  def(
    "tech_docs_mcp_max_libraries",
    "TECH_DOCS_MCP_MAX_LIBRARIES",
    "number",
    "3",
    "Docs técnicas — máx. librerías",
    "Cuántas librerías de Context7 se consultan por generación desde MDD §2. Más librerías = prompts más ricos pero más latencia y coste.",
    "mcp",
    { min: 1, max: 6 },
  ),
  def(
    "theforge_list_projects_cache_ms",
    "THEFORGE_LIST_PROJECTS_CACHE_MS",
    "number",
    "60000",
    "MCP — caché list_known_projects (ms)",
    "TTL de caché para list_known_projects. 0 desactiva caché (más llamadas MCP); valores altos pueden ocultar proyectos recién registrados.",
    "mcp",
    { min: 0, max: 3_600_000 },
  ),
  def(
    "theforge_context_cache",
    "THEFORGE_CONTEXT_CACHE",
    "boolean",
    "1",
    "Caché contexto MCP",
    "Activa caché en memoria del contexto TheForge/Ariadne inyectado en prompts. Desactivar fuerza lecturas frescas del MCP en cada job.",
    "mcp",
  ),
  def(
    "theforge_context_cache_ttl_ms",
    "THEFORGE_CONTEXT_CACHE_TTL_MS",
    "number",
    "1800000",
    "Caché contexto — TTL (ms)",
    "Cuánto tiempo se reutiliza cada entrada de contexto cacheado. TTL corto = datos más frescos; largo = menos carga MCP.",
    "mcp",
    { min: 60_000, max: 86_400_000 },
  ),
  def(
    "theforge_context_cache_max_entries",
    "THEFORGE_CONTEXT_CACHE_MAX_ENTRIES",
    "number",
    "80",
    "Caché contexto — máx. entradas",
    "Límite de entradas en la caché de contexto (mín. efectivo 8). Bajo = menos RAM; alto = más hits pero más memoria.",
    "mcp",
    { min: 8, max: 500 },
  ),
  def(
    "theforge_context_revision",
    "THEFORGE_CONTEXT_REVISION",
    "string",
    "",
    "Caché contexto — revisión manual",
    "Cambia este valor para invalidar toda la caché de contexto sin reiniciar el API. Útil tras reindexar Ariadne o cambiar roots del workspace.",
    "mcp",
  ),
  def(
    "theforge_context_prepend_max_chars",
    "THEFORGE_CONTEXT_PREPEND_MAX_CHARS",
    "number",
    "16000",
    "Contexto TheForge — tope en prompts",
    "Máximo de caracteres del bloque de contexto TheForge/Ariadne en prompts de entregables legacy. Bajo recorta evidencia; alto aumenta tokens LLM.",
    "legacy",
    { min: 2000, max: 200_000 },
  ),
  def(
    "mdd_proposed_component_diagram",
    "MDD_PROPOSED_COMPONENT_DIAGRAM",
    "boolean",
    "1",
    "MDD greenfield — diagrama §2",
    "Inyecta un diagrama de componentes propuesto en §2 del MDD greenfield. Mejora legibilidad; el diagrama es heurístico, no evidencia del código.",
    "legacy",
  ),
  def(
    "legacy_evidence_first_context",
    "LEGACY_EVIDENCE_FIRST_CONTEXT",
    "boolean",
    "1",
    "Legacy — pipeline evidencia-primero",
    "Prioriza evidencia del índice MCP sobre texto libre al armar contexto legacy. Desactivar puede alucinar stack no presente en el repo.",
    "legacy",
  ),
  def(
    "legacy_analyzer_compact",
    "LEGACY_ANALYZER_COMPACT",
    "boolean",
    "1",
    "Legacy — analyzer compacto",
    "Reduce tamaño del Analyzer legacy (menos tokens). Acelera y abarata; puede omitir matices en proyectos grandes.",
    "legacy",
  ),
  def(
    "legacy_analyzer_require_graph_hits",
    "LEGACY_ANALYZER_REQUIRE_GRAPH_HITS",
    "boolean",
    "1",
    "Legacy — exigir hits en grafo",
    "Bloquea el Analyzer si el índice MCP no devolvió símbolos. Evita análisis vacío; puede impedir generar cuando el grafo aún no indexó.",
    "legacy",
  ),
  def(
    "legacy_sdd_index_gate",
    "LEGACY_SDD_INDEX_GATE",
    "boolean",
    "1",
    "Legacy — gate índice SDD",
    "Compara índice MCP con SDD en Falkor antes de generar. Detecta desalineaciones; puede devolver 409 hasta que el usuario confirme.",
    "legacy",
  ),
  def(
    "legacy_mdd_component_diagram",
    "LEGACY_MDD_COMPONENT_DIAGRAM",
    "boolean",
    "1",
    "Legacy MDD — diagrama componentes",
    "Añade diagrama Mermaid de componentes en doc. de partida y §2 legacy. Ayuda a visualizar arquitectura inferida del índice.",
    "legacy",
  ),
  def(
    "legacy_deliverables_section_merge",
    "LEGACY_DELIVERABLES_SECTION_MERGE",
    "string",
    "all",
    "Legacy entregables — section merge",
    "Cómo fusionar secciones al generar entregables legacy: all, blueprint, auto u off. Cambia si el LLM reescribe todo el doc. o solo partes.",
    "legacy",
  ),
  def(
    "debug_mcp",
    "DEBUG_MCP",
    "boolean",
    "0",
    "Debug MCP",
    "Escribe petición y respuesta MCP en consola del API. Solo diagnóstico; en producción puede filtrar secretos y volumen alto de logs.",
    "debug",
  ),
  def(
    "debug_mdd_section3",
    "DEBUG_MDD_SECTION3",
    "boolean",
    "0",
    "Debug MDD §3",
    "Log detallado de la sección 3 (modelo de datos) en el pipeline MDD. Útil para depurar SQL/ER; muy verboso en consola.",
    "debug",
  ),
  def(
    "debug_mcp_max_request_chars",
    "DEBUG_MCP_MAX_REQUEST_CHARS",
    "number",
    "65536",
    "Debug MCP — truncado request",
    "Máximo de caracteres logueados por petición MCP cuando debug está activo. Evita logs gigantes en ask_codebase.",
    "debug",
    { min: 1024, max: 1_048_576 },
  ),
  def(
    "debug_mcp_max_response_chars",
    "DEBUG_MCP_MAX_RESPONSE_CHARS",
    "number",
    "32768",
    "Debug MCP — truncado response",
    "Máximo de caracteres logueados por respuesta MCP cuando debug está activo. Respuestas grandes se cortan en el log.",
    "debug",
    { min: 1024, max: 1_048_576 },
  ),
  def(
    "otp_dev_expose_code",
    "OTP_DEV_EXPOSE_CODE",
    "boolean",
    "0",
    "OTP dev — exponer código",
    "Devuelve devCode en POST /auth/otp/request sin enviar correo. Solo desarrollo local; en producción expone códigos OTP en la API.",
    "debug",
  ),
  def(
    "mxn_per_usd",
    "MXN_PER_USD",
    "number",
    "20",
    "Tipo de cambio MXN/USD (estimado)",
    "Multiplicador estimado para convertir USD a MXN en la columna de métricas y el panel de Coste IA. Valor estático (no live); el usuario lo mantiene en Ajustes → Sistema. Cambia aquí cuando necesites reflejar un tipo de cambio actualizado sin tocar la base de datos.",
    "cost",
    { min: 1, max: 100 },
  ),
] as const;

const DEFINITION_BY_KEY = new Map(SYSTEM_CONFIG_DEFINITIONS.map((d) => [d.key, d]));

export function getSystemConfigDefinition(key: string): SystemConfigDefinition | undefined {
  return DEFINITION_BY_KEY.get(key);
}

export function isTruthyPlatformFlag(raw: string | undefined | null): boolean {
  const v = raw?.trim().toLowerCase();
  if (!v) return false;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function normalizePlatformBooleanInput(value: unknown): string {
  if (value === true || value === 1) return "1";
  if (value === false || value === 0) return "0";
  if (typeof value === "string") {
    return isTruthyPlatformFlag(value) ? "1" : "0";
  }
  return "0";
}

export type SystemConfigSource = "database" | "env" | "default";

export interface SystemConfigSettingView {
  key: string;
  envKey: string;
  label: string;
  description: string;
  type: SystemConfigFieldType;
  category: SystemConfigCategory;
  value: string;
  defaultValue: string;
  source: SystemConfigSource;
  secret: boolean;
  restartRequired: boolean;
  min?: number;
  max?: number;
}

export interface SystemConfigSnapshot {
  version: string;
  categories: typeof SYSTEM_CONFIG_CATEGORIES;
  settings: SystemConfigSettingView[];
}
