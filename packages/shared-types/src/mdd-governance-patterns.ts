/**
 * Gobernanza de patrones del MDD (SSOT). Sección inmutable bajo el título principal.
 */

import { peelDocumentBodyForPersist } from "./theforge-doc-stamp.js";

export const MDD_GOVERNANCE_HEADING_MARKER = "[ARQUITECTURA - SECCIÓN INMUTABLE]";

/** Cuerpo del wizard (sin título H1 del documento). Fuente: prompts/mdd/mdd-governance-patterns-wizard.md */
export const MDD_GOVERNANCE_WIZARD_BODY = `## [ARQUITECTURA - SECCIÓN INMUTABLE] CONFIGURACIÓN DE PATRONES DE DESARROLLO

> ### 🚨 NOTA DE SISTEMA PARA AGENTES DE IA (PROHIBIDO ELIMINAR O MODIFICAR)
> Esta sección contiene las decisiones de diseño arquitectónico globales del proyecto. 
> ANTES de generar cualquier documento posterior (Spec, Arq, API, Flujos, Tasks, Infra), DEBES leer obligatoriamente las opciones marcadas con [X] en este Wizard. Toda especificación, contrato, diagrama o tarea técnica generada debe alinearse estrictamente con los patrones activados.

### 🧙‍♂️ WIZARD DE SELECCIÓN DE PATRONES COMPLETO
*Instrucciones para el usuario: Marca con una [X] todos los patrones que aplicarán a este desarrollo.*

#### 🏛️ 1. PATRONES DE ARQUITECTURA GLOBAL Y DISTRIBUIDA
- [ ] **Arquitectura Hexagonal (Ports & Adapters):** Aísla la lógica de negocio central de agentes externos, bases de datos o frameworks mediante interfaces. *(Afecta a: Arq, MDD, Flujos, Tasks)*
- [ ] **Clean Architecture / Onion Architecture:** Estructura el software en capas concéntricas donde la dependencia va estrictamente hacia el centro (entidades de negocio). *(Afecta a: Arq, MDD, Tasks)*
- [ ] **Microservicios:** Divide el sistema en servicios autónomos, débilmente acoplados y desplegables de forma independiente. *(Afecta a: Arq, API, Infra, Tasks)*
- [ ] **Monolito Modular:** Mantiene una única unidad de despliegue pero con una separación estricta y lógica de módulos de negocio independientes. *(Afecta a: Arq, MDD)*
- [ ] **CQRS (Command Query Responsibility Segregation):** Separa los modelos y caminos de ejecución para operaciones de lectura y de escritura. *(Afecta a: Arq, API, Flujos, Tasks)*
- [ ] **Event-Driven Architecture (EDA):** Arquitectura basada en la producción, detección y consumo de eventos asíncronos. *(Afecta a: Arq, Flujos, Infra)*
- [ ] **SOA (Service-Oriented Architecture):** Estructura orientada a servicios que se comunican mediante un protocolo de enlace común (como ESB). *(Afecta a: Arq, API)*
- [ ] **Serverless Architecture:** Aplicaciones que dependen de servicios de terceros (BaaS) o contenedores efímeros (FaaS) gestionados por la nube. *(Afecta a: Arq, Infra, Tasks)*

#### 🏗️ 2. PATRONES DE DISEÑO: CREACIONALES (Gof)
- [ ] **Abstract Factory:** Proporciona una interfaz para crear familias de objetos relacionados o dependientes sin especificar sus clases concretas. *(Afecta a: MDD, Tasks)*
- [ ] **Builder:** Separa la construcción de un objeto complejo de su representación, permitiendo crear diferentes representaciones. *(Afecta a: MDD, Tasks)*
- [ ] **Factory Method:** Define una interfaz para crear un objeto, pero deja que las subclases decidan qué clase instanciar. *(Afecta a: MDD, Tasks)*
- [ ] **Prototype:** Permite copiar objetos existentes sin que el código dependa de sus clases concretas. *(Afecta a: MDD, Tasks)*
- [ ] **Singleton:** Garantiza que una clase tenga una única instancia en toda la aplicación y proporciona un acceso global a ella. *(Afecta a: MDD, Tasks)*

#### 🔌 3. PATRONES DE DISEÑO: ESTRUCTURALES (GoF)
- [ ] **Adapter:** Permite que interfaces incompatibles trabajen juntas, traduciendo las peticiones de un cliente a un formato comprensible. *(Afecta a: API, Flujos, Tasks)*
- [ ] **Bridge:** Desacopla una abstracción de su implementación, de modo que ambas puedan variar de forma independiente. *(Afecta a: MDD, Tasks)*
- [ ] **Composite:** Permite componer objetos en estructuras de árbol para representar jerarquías de parte-todo. *(Afecta a: MDD, Design System, Tasks)*
- [ ] **Decorator:** Añade responsabilidades a un objeto dinámicamente de forma transparente sin modificar su estructura base. *(Afecta a: MDD, Tasks)*
- [ ] **Facade (Fachada):** Proporciona una interfaz unificada y simplificada para un conjunto de interfaces en un subsistema complejo. *(Afecta a: API, MDD, Tasks)*
- [ ] **Flyweight (Peso Ligero):** Minimiza el uso de memoria compartiendo la mayor cantidad posible de datos con objetos similares. *(Afecta a: MDD, Tasks)*
- [ ] **Proxy:** Proporciona un sustituto o marcador de posición para otro objeto para controlar el acceso, interceptar llamadas o diferir costos. *(Afecta a: MDD, Tasks)*

#### 🧠 4. PATRONES DE DISEÑO: COMPORTAMIENTO (GoF)
- [ ] **Chain of Responsibility:** Permite pasar peticiones a lo largo de una cadena de manejadores; cada uno decide si procesa la petición o la pasa al siguiente. *(Afecta a: Flujos, Tasks)*
- [ ] **Command:** Encapsula una petición como un objeto, permitiendo parametrizar a los clientes con diferentes peticiones, hacer colas y operaciones reversibles. *(Afecta a: MDD, Flujos, Tasks)*
- [ ] **Interpreter:** Dada un lenguaje, define una representación para su gramática junto con un intérprete que la utiliza. *(Afecta a: Spec, MDD)*
- [ ] **Iterator:** Permite recorrer secuencialmente los elementos de una colección sin exponer su representación subyacente. *(Afecta a: MDD, Tasks)*
- [ ] **Mediator:** Define un objeto que encapsula cómo interactúa un conjunto de objetos, promoviendo un acoplamiento débil. *(Afecta a: MDD, Flujos, Tasks)*
- [ ] **Memento:** Permite capturar y externalizar el estado interno de un objeto para poder restaurarlo más tarde sin violar la encapsulación. *(Afecta a: Flujos, Tasks)*
- [ ] **Observer / Pub-Sub:** Establece una relación de dependencia de uno a muchos para que los cambios en un objeto notifiquen automáticamente a los demás. *(Afecta a: Flujos, Tasks)*
- [ ] **State:** Permite que un objeto modifique su comportamiento cada vez que cambia su estado interno, pareciendo cambiar de clase. *(Afecta a: Spec, Casos, Flujos, Tasks)*
- [ ] **Strategy:** Define una familia de algoritmos, encapsula cada uno y los hace intercambiables dinámicamente en tiempo de ejecución. *(Afecta a: Spec, MDD, Tasks)*
- [ ] **Template Method:** Define el esqueleto de un algoritmo en una operación, delegando algunos pasos a las subclases sin cambiar la estructura general. *(Afecta a: MDD, Tasks)*
- [ ] **Visitor:** Permite definir una nueva operación sobre una estructura de objetos sin cambiar las clases de los elementos sobre los que opera. *(Afecta a: MDD, Tasks)*

#### 💾 5. PATRONES DE PERSISTENCIA Y MANEJO DE DATOS
- [ ] **Repository:** Media entre el dominio y las capas de mapeo de datos mediante una interfaz de estilo colección abstracta. *(Afecta a: MDD, Tasks)*
- [ ] **Data Mapper:** Capa de mapeo que aísla los objetos de dominio de la base de datos, manteniendo la independencia del modelo. *(Afecta a: MDD, Tasks)*
- [ ] **Active Record:** Objeto que envuelve una fila de una tabla de base de datos, encapsula el acceso a los datos e incluye lógica de negocio asociada. *(Afecta a: MDD, Tasks)*
- [ ] **Unit of Work:** Mantiene una lista de objetos afectados por una transacción de negocio y coordina la escritura de los cambios. *(Afecta a: MDD, Flujos)*

#### 🛡️ 6. PATRONES DE INTEGRACIÓN, GESTIÓN DE APIs Y RESILIENCIA
- [ ] **API Gateway:** Único punto de entrada para todas las solicitudes de clientes, encargado de enrutar, agregar y autenticar. *(Afecta a: API, Arq, Infra)*
- [ ] **BFF (Backend For Frontend):** Crea variantes de backend específicas para optimizar el rendimiento y datos de interfaces web, móviles o IoT diferenciadas. *(Afecta a: Blueprint, Arq, API)*
- [ ] **Saga (Transacciones Distribuidas):** Gestiona la consistencia de datos entre microservicios mediante una secuencia de transacciones locales y acciones de compensación. *(Afecta a: Flujos, Tasks)*
- [ ] **Circuit Breaker:** Monitorea fallos en servicios externos y bloquea peticiones de forma temporal para evitar caídas en cascada. *(Afecta a: Arq, Tasks, Infra)*
- [ ] **Outbox Pattern:** Garantiza la publicación confiable de eventos asíncronos guardándolos primero en la base de datos local antes de enviarlos al Message Broker. *(Afecta a: Flujos, Tasks)*
- [ ] **Event Sourcing:** Almacena el estado de una entidad como una secuencia cronológica de eventos inmutables en lugar del estado actual puro. *(Afecta a: Arq, Flujos, Infra)*
- [ ] **Strangler Fig (Estrangulamiento):** Migra incrementalmente un sistema legado reemplazando características antiguas de forma gradual con nuevos servicios. *(Afecta a: Arq, Tasks)*

---`;

/** Label puede contener paréntesis; el cierre del bold es siempre `:**`. */
const PATTERN_LINE_RE = /^- \[\s*([xX ]?)\s*\] \*\*(.+):\*\*\s*(.*)$/;

export interface MddGovernancePatternOption {
  id: string;
  label: string;
  description: string;
  affects: string;
  group: string;
}

export interface MddActivePattern {
  label: string;
  affects: string;
}

function slugifyPatternLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Opciones del wizard para UI (grupos #### del cuerpo). */
export function listGovernancePatternOptions(
  wizardBody: string = MDD_GOVERNANCE_WIZARD_BODY,
): MddGovernancePatternOption[] {
  const out: MddGovernancePatternOption[] = [];
  let group = "";
  for (const line of wizardBody.split("\n")) {
    const g = line.match(/^####\s+(.+)$/);
    if (g) {
      group = g[1]!.trim();
      continue;
    }
    const m = line.match(PATTERN_LINE_RE);
    if (!m) continue;
    const label = m[2]!.trim();
    const rest = m[3]!.trim();
    const affectsMatch = rest.match(/\*\(Afecta a:\s*([^)]+)\)\*$/);
    const affects = affectsMatch?.[1]?.trim() ?? "";
    const description = affectsMatch ? rest.replace(/\*\(Afecta a:[^)]+\)\*$/, "").trim() : rest;
    out.push({
      id: slugifyPatternLabel(label),
      label,
      description,
      affects,
      group,
    });
  }
  return out;
}

export type HeuristicGovernancePatternInput = {
  dbgaContent?: string;
  phase0SummaryContent?: string;
  brdContent?: string;
};

const STACK_KEYWORD_GOVERNANCE_HINTS: ReadonlyArray<{ re: RegExp; ids: readonly string[] }> = [
  { re: /\b(nestjs|nestjs\.js|express\.js|fastify)\b/i, ids: ["monolito-modular", "repository", "arquitectura-hexagonal-ports-adapters"] },
  { re: /\b(postgres(?:ql)?|prisma|typeorm)\b/i, ids: ["repository", "data-mapper"] },
  { re: /\b(redis|cache distribuida)\b/i, ids: ["observer-pub-sub", "strategy"] },
  { re: /\b(rabbitmq|kafka|bullmq|message broker|event bus|cola de mensajes)\b/i, ids: ["event-driven-architecture-eda", "outbox-pattern", "observer-pub-sub"] },
  { re: /\b(jwt|oauth|openid|auth0|keycloak|passport)\b/i, ids: ["api-gateway", "facade-fachada"] },
  { re: /\b(stripe|webhook|pasarela de pago)\b/i, ids: ["api-gateway", "circuit-breaker"] },
  { re: /\b(react|vite|frontend|spa|tailwind)\b/i, ids: ["bff-backend-for-frontend", "monolito-modular"] },
  { re: /\b(langgraph|langchain|llm|agente|openai|anthropic)\b/i, ids: ["strategy", "chain-of-responsibility", "facade-fachada"] },
  { re: /\b(docker|kubernetes|k8s|dokploy|compose)\b/i, ids: ["monolito-modular", "api-gateway"] },
  { re: /\bcqrs\b/i, ids: ["cqrs-command-query-responsibility-segregation"] },
  { re: /\bsaga\b/i, ids: ["saga-transacciones-distribuidas"] },
  { re: /\bcircuit breaker|resilien/i, ids: ["circuit-breaker"] },
  { re: /\bevent sourcing\b/i, ids: ["event-sourcing"] },
  { re: /\bserverless|lambda|faas\b/i, ids: ["serverless-architecture"] },
  { re: /\bstrangler|legado\b/i, ids: ["strangler-fig-estrangulamiento"] },
];

/**
 * Preselección rápida de patrones SSOT sin LLM (Fase 0, benchmark, BRD).
 * Usada en API (fast path) y Workshop (apertura instantánea del wizard).
 */
export function heuristicGovernancePatternIds(
  input: HeuristicGovernancePatternInput,
): string[] {
  const blob = `${input.dbgaContent ?? ""}\n${input.phase0SummaryContent ?? ""}\n${input.brdContent ?? ""}`.toLowerCase();
  const opts = listGovernancePatternOptions();
  const validIds = new Set(opts.map((o) => o.id));
  const hits = new Set<string>();

  for (const o of opts) {
    const labelTokens = o.label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3);
    if (labelTokens.some((t) => blob.includes(t))) hits.add(o.id);
    const descTokens = o.description
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 5);
    if (descTokens.some((t) => blob.includes(t))) hits.add(o.id);
  }

  for (const { re, ids } of STACK_KEYWORD_GOVERNANCE_HINTS) {
    if (!re.test(blob)) continue;
    for (const id of ids) {
      if (validIds.has(id)) hits.add(id);
    }
  }

  if (/microservicio|microservice/.test(blob)) {
    const ms = opts.find((o) => o.label.toLowerCase().includes("microservicio"));
    if (ms) hits.add(ms.id);
  }
  if (/hexagonal|ports?\s*&\s*adapters?/.test(blob)) {
    const hx = opts.find((o) => o.label.toLowerCase().includes("hexagonal"));
    if (hx) hits.add(hx.id);
  }
  if (/monolito|monolith|monorepo/.test(blob)) {
    const mo = opts.find((o) => o.label.toLowerCase().includes("monolito"));
    if (mo) hits.add(mo.id);
  }
  if (/clean architecture|onion architecture/.test(blob)) {
    const ca = opts.find((o) => o.label.toLowerCase().includes("clean architecture"));
    if (ca) hits.add(ca.id);
  }

  if (hits.size === 0) {
    for (const id of ["repository", "monolito-modular"]) {
      if (validIds.has(id)) hits.add(id);
    }
  }

  return [...hits].slice(0, 12);
}

export function hasGovernanceSection(md: string): boolean {
  return (md ?? "").includes(MDD_GOVERNANCE_HEADING_MARKER);
}

/** Índice del encabezado ## [ARQUITECTURA - SECCIÓN INMUTABLE]… */
function governanceStartIndex(md: string): number {
  const escaped = MDD_GOVERNANCE_HEADING_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^##\\s*${escaped}`, "im");
  const m = md.match(re);
  return m?.index ?? -1;
}

/** Extrae la sección de gobernanza (incl. cierre --- opcional). */
export function extractGovernanceSection(md: string): string | null {
  const s = (md ?? "").trim();
  const start = governanceStartIndex(s);
  if (start < 0) return null;
  const after = s.slice(start);
  const nextCanon = after.search(/^##\s*\d+\.\s/m);
  if (nextCanon > 0) return after.slice(0, nextCanon).trim();
  return after.trim();
}

/** Quita gobernanza y el HR previo inmediato si existe. */
export function stripGovernanceSection(md: string): string {
  const s = (md ?? "").trim();
  const start = governanceStartIndex(s);
  if (start < 0) return s;
  let before = s.slice(0, start).trimEnd();
  before = before.replace(/\n?---\s*$/m, "").trimEnd();
  const after = s.slice(start);
  const nextCanon = after.search(/^##\s*\d+\.\s/m);
  const tail = nextCanon > 0 ? after.slice(nextCanon).trim() : "";
  if (!before) return tail;
  if (!tail) return before;
  return `${before}\n\n${tail}`.trim();
}

/** Intro del wizard (sin líneas de patrón ni grupos ####). */
function governanceIntroBlock(wizardBody: string = MDD_GOVERNANCE_WIZARD_BODY): string {
  const lines: string[] = [];
  for (const line of wizardBody.split("\n")) {
    if (line.match(/^####\s+/) || line.match(PATTERN_LINE_RE)) break;
    lines.push(line);
  }
  return lines
    .join("\n")
    .replace(
      /### 🧙‍♂️ WIZARD DE SELECCIÓN DE PATRONES COMPLETO[\s\S]*$/m,
      "### Patrones activos (SSOT)\n\n*Selección vigente del proyecto. Para cambiarla usa «Editar patrones (SSOT)» en el Workshop.*",
    )
    .trim();
}

/**
 * Sección de gobernanza mostrada en el MDD: solo patrones seleccionados (marcados [X]).
 * No lista el catálogo completo con casillas vacías.
 */
export function buildGovernanceBodySelectedOnly(
  selectedIds: ReadonlySet<string>,
  wizardBody: string = MDD_GOVERNANCE_WIZARD_BODY,
): string {
  const intro = governanceIntroBlock(wizardBody);
  const byGroup = new Map<string, MddGovernancePatternOption[]>();
  for (const o of listGovernancePatternOptions(wizardBody)) {
    if (!selectedIds.has(o.id)) continue;
    const list = byGroup.get(o.group) ?? [];
    list.push(o);
    byGroup.set(o.group, list);
  }
  const parts = [intro];
  if (byGroup.size === 0) {
    parts.push("", "_Ningún patrón seleccionado. Usa «Editar patrones (SSOT)»._");
  } else {
    for (const [group, items] of byGroup) {
      parts.push("", `#### ${group}`);
      for (const item of items) {
        const aff = item.affects ? ` *(Afecta a: ${item.affects})*` : "";
        const desc = item.description ? ` ${item.description}` : "";
        parts.push(`- [X] **${item.label}:**${desc}${aff}`);
      }
    }
  }
  parts.push("", "---");
  return parts.join("\n").trim();
}

/** Marca [X] en las líneas cuyo id (slug del label) está en selectedIds. */
export function applyPatternSelectionsToWizardBody(
  wizardBody: string,
  selectedIds: ReadonlySet<string>,
): string {
  return wizardBody
    .split("\n")
    .map((line) => {
      const m = line.match(/^- \[\s*([xX ]?)\s*\] \*\*(.+):\*\*\s*(.*)$/);
      if (!m) return line;
      const label = m[2]!.trim();
      const id = slugifyPatternLabel(label);
      const checked = selectedIds.has(id);
      const suffix = m[3] ?? "";
      const spaced = suffix.startsWith(" ") ? suffix : ` ${suffix}`;
      return `- [${checked ? "X" : " "}] **${label}:**${spaced}`;
    })
    .join("\n");
}

export function buildMddWithGovernanceSkeleton(
  title = "Master Design Document",
  wizardBody: string = MDD_GOVERNANCE_WIZARD_BODY,
): string {
  return `# ${title}\n\n---\n\n${wizardBody.trim()}\n`;
}

export function parseActivePatternsFromMdd(md: string): MddActivePattern[] {
  const gov = extractGovernanceSection(md);
  if (!gov) return [];
  const active: MddActivePattern[] = [];
  for (const line of gov.split("\n")) {
    const m = line.match(/^#?\s*- \[\s*[xX]\s*\] \*\*(.+):\*\*\s*(.*)$/);
    if (!m) continue;
    const label = m[1]!.trim();
    const rest = m[2]!.trim();
    const affectsMatch = rest.match(/\*\(Afecta a:\s*([^)]+)\)\*$/);
    active.push({
      label,
      affects: affectsMatch?.[1]?.trim() ?? "",
    });
  }
  return active;
}

export function formatActivePatternsPromptBlock(md: string): string {
  const active = parseActivePatternsFromMdd(md);
  if (!active.length) {
    return (
      "**Patrones de desarrollo (MDD — sección inmutable):** No hay patrones marcados con [X] en el Wizard del MDD. " +
      "Alinea el entregable a la Constitución (§1–§7) sin imponer patrones no seleccionados."
    );
  }
  const lines = active.map(
    (p) => `- **${p.label}**${p.affects ? ` (afecta: ${p.affects})` : ""}`,
  );
  return (
    "**Patrones de desarrollo activos (SSOT — Wizard del MDD, [X] obligatorios):**\n" +
    "Todo lo que generes debe reflejar explícitamente estos patrones sin contradecir el MDD.\n\n" +
    lines.join("\n")
  );
}

/**
 * Inserta o restaura la sección de gobernanza tras el título H1.
 * Si `preserved` se omite y el documento ya tiene gobernanza, la conserva.
 */
/** Actualiza solo la sección inmutable de patrones; conserva título H1 y §1–§7. */
export function updateMddGovernancePatterns(
  md: string,
  selectedIds: ReadonlySet<string>,
): string {
  const updatedGov = buildGovernanceBodySelectedOnly(selectedIds);
  return ensureMddGovernanceSection(md, updatedGov);
}

export function ensureMddGovernanceSection(md: string, preserved?: string | null): string {
  const body = stripGovernanceSection(md);
  const gov =
    preserved?.trim() ||
    extractGovernanceSection(md)?.trim() ||
    MDD_GOVERNANCE_WIZARD_BODY.trim();
  const titleMatch = body.match(/^#\s+(.+?)\s*$/m);
  const title = titleMatch?.[1]?.trim() || "Master Design Document";
  const rest = titleMatch ? body.replace(/^#\s+.+?\s*\n+/, "").trim() : body;
  const parts = [`# ${title}`, "", "---", "", gov.trim()];
  if (rest) parts.push("", rest);
  return parts.join("\n").trim() + "\n";
}

/** MDD con §1–§7 sustancial (no solo wizard / placeholders). */
export function mddHasSubstantialBody(md: string): boolean {
  const withoutGov = stripGovernanceSection(md);
  const s1 = withoutGov.match(/^##\s*1\.\s*[^\n]*\n+([\s\S]*?)(?=^##\s*\d+\.\s|$)/im);
  if (!s1) return false;
  const body = s1[1]!.replace(/\(Pendiente\)/gi, "").trim();
  return body.length > 80;
}

/** Solo sección SSOT con al menos un patrón [X] (sin §1–§7). */
export function mddHasGovernanceSeed(md: string): boolean {
  return hasGovernanceSection(md) && selectedPatternIdsFromMdd(md).size > 0;
}

/** Listo para lanzar generación MDD (cuerpo canónico o semilla de patrones). */
export function mddReadyForGeneration(md: string): boolean {
  return mddHasSubstantialBody(md) || mddHasGovernanceSeed(md);
}

/**
 * Wizard de patrones solo al empezar de cero (MDD vacío).
 * Si hay cualquier contenido guardado, «Regenerar MDD» no vuelve a preguntar — usar «Limpiar MDD».
 */
export function mddNeedsPatternWizard(md: string): boolean {
  return (md ?? "").trim().length === 0;
}

function patternIdSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** true si la selección [X] difiere entre dos borradores MDD. */
export function governancePatternSelectionDiffers(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return !patternIdSetsEqual(
    selectedPatternIdsFromMdd(a ?? ""),
    selectedPatternIdsFromMdd(b ?? ""),
  );
}

/** true si `received` omitiría algún patrón [X] presente en `sent`. */
export function serverWouldDropGovernancePatterns(sent: string, received: string): boolean {
  const sentIds = selectedPatternIdsFromMdd(sent);
  const recvIds = selectedPatternIdsFromMdd(received);
  if (sentIds.size === 0) return false;
  for (const id of sentIds) {
    if (!recvIds.has(id)) return true;
  }
  return false;
}

/** Detecta [X] en la sección de gobernanza aunque el parser estricto falle (p. ej. markdown corrupto). */
export function governanceSectionHasCheckedPatternMarkers(md: string): boolean {
  const gov = extractGovernanceSection(md);
  if (!gov) return false;
  return /^#?\s*- \[\s*[xX]\s*\]/m.test(gov);
}

/**
 * true si el PATCH debe ir con `allowGovernancePatternChange` para no perder [X]
 * (p. ej. Grabar con patrones activos sin cambio de selección vs baseline local).
 */
export function shouldAllowGovernancePatternChangeOnPersist(
  incomingMd: string,
  previousSavedMd: string | null | undefined,
): boolean {
  if (governancePatternSelectionDiffers(incomingMd, previousSavedMd)) return true;
  const incomingIds = selectedPatternIdsFromMdd(incomingMd);
  if (incomingIds.size === 0) return false;
  const enforced = enforceMddGovernancePatternsOnPersist(incomingMd, previousSavedMd ?? "", {});
  return serverWouldDropGovernancePatterns(incomingMd, enforced.markdown);
}

export type EnforceMddGovernancePatternsResult = {
  markdown: string;
  /** true si se ignoraron cambios manuales en la sección inmutable de patrones. */
  patternsReverted: boolean;
};

/**
 * Al persistir el MDD: bloquea edición manual del wizard salvo `allowPatternChange` (botón SSOT).
 * La selección [X] ancla al último MDD guardado en BD; el cuerpo del wizard se normaliza desde plantilla.
 */
export function enforceMddGovernancePatternsOnPersist(
  incomingMd: string,
  previousSavedMd: string | null | undefined,
  options?: { allowPatternChange?: boolean; clearMddCompletely?: boolean },
): EnforceMddGovernancePatternsResult {
  const incoming = (incomingMd ?? "").trim();
  const previous = (previousSavedMd ?? "").trim();

  if (options?.clearMddCompletely) {
    return { markdown: "", patternsReverted: false };
  }

  if (options?.allowPatternChange) {
    const ids = selectedPatternIdsFromMdd(incoming);
    if (
      ids.size === 0 &&
      governanceSectionHasCheckedPatternMarkers(incoming) &&
      hasGovernanceSection(incoming)
    ) {
      return { markdown: incoming, patternsReverted: false };
    }
    const markdown =
      ids.size > 0 || hasGovernanceSection(incoming)
        ? updateMddGovernancePatterns(incoming, ids)
        : ensureMddGovernanceSection(incoming, null);
    return { markdown, patternsReverted: false };
  }

  if (!previous.length) {
    const ids = selectedPatternIdsFromMdd(incoming);
    const markdown = updateMddGovernancePatterns(incoming, ids);
    return { markdown, patternsReverted: false };
  }

  const lockedIds = selectedPatternIdsFromMdd(previous);
  const incomingIds = selectedPatternIdsFromMdd(incoming);
  const markdown = updateMddGovernancePatterns(incoming, lockedIds);
  const outGov = extractGovernanceSection(markdown)?.trim() ?? "";
  const inGov = extractGovernanceSection(incoming)?.trim() ?? "";
  const patternsReverted =
    !patternIdSetsEqual(lockedIds, incomingIds) || inGov !== outGov;
  return { markdown, patternsReverted };
}

/** IDs de patrones actualmente marcados con [X] en el MDD. */
export function selectedPatternIdsFromMdd(md: string): Set<string> {
  const ids = new Set<string>();
  for (const p of parseActivePatternsFromMdd(md)) {
    ids.add(slugifyPatternLabel(p.label));
  }
  return ids;
}

/** Patrones y sección SSOT a conservar al regenerar MDD (editor cliente > BD). */
export function resolveMddGovernancePreservation(
  clientMdd: string | null | undefined,
  dbMdd: string | null | undefined,
): { preservedGovernance: string | null; lockedPatternIds: Set<string> } {
  const client = peelDocumentBodyForPersist((clientMdd ?? "").trim());
  const db = peelDocumentBodyForPersist((dbMdd ?? "").trim());
  const clientIds = selectedPatternIdsFromMdd(client);
  const dbIds = selectedPatternIdsFromMdd(db);
  const lockedPatternIds = clientIds.size > 0 ? clientIds : dbIds;
  const preservedGovernance =
    (clientIds.size > 0 ? extractGovernanceSection(client) : null) ??
    extractGovernanceSection(db) ??
    null;
  return { preservedGovernance, lockedPatternIds };
}
