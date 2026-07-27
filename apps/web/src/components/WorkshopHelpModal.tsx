import { useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Boxes,
  Brain,
  CheckSquare,
  ClipboardList,
  FileText,
  GitBranch,
  Clock,
  HelpCircle,
  LayoutTemplate,
  Link2,
  ListTodo,
  Palette,
  Plug,
  Puzzle,
  Scale,
  Server,
  Sparkles,
  Target,
  Users,
  Webhook,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import convergeWebhookCiHelp from "../content/help/converge-webhook-ci.md?raw";
import generacionSegundoPlanoHelp from "../content/help/generacion-en-segundo-plano.md?raw";
import legacyNewIntegrationHelp from "../content/help/legacy-new-integration.md?raw";
import modelosProveedorIaHelp from "../content/help/modelos-proveedor-ia.md?raw";
import pluginsPackagingHelp from "../content/help/plugins-packaging.md?raw";
import validacionPlanAriadneHelp from "../content/help/validacion-plan-ariadne.md?raw";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { MarkdownMermaidPre, tryRenderMarkdownMermaid } from "./MarkdownMermaid";

type WorkshopHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

/* ───── Help section definitions ───── */

interface HelpSection {
  id: string;
  label: string;
  content: string;
}

const SECTION_ICONS: Record<string, LucideIcon> = {
  manual: BookOpen,
  "modelos-proveedor-ia": Bot,
  "legacy-new-integration": Link2,
  "converge-webhook-ci": Webhook,
  "plugins-packaging": Puzzle,
  "generacion-segundo-plano": Clock,
  "validacion-plan-ariadne": ShieldCheck,
  sdd: Brain,
  mdd: FileText,
  spec: ClipboardList,
  brd: Target,
  "to-be": Sparkles,
  architecture: Boxes,
  "use-cases": Users,
  "user-stories": ListTodo,
  blueprint: LayoutTemplate,
  "ux-ui-guide": Palette,
  "api-contracts": Plug,
  "logic-flows": GitBranch,
  tasks: CheckSquare,
  infra: Server,
  adrs: Scale,
};

const SECTIONS: HelpSection[] = [
  {
    id: "manual",
    label: "Manual de TheForge",
    content: [
      "# Manual de TheForge",
      "",
      "## ¿Qué es el Workshop?",
      "",
      "El **Workshop** es el núcleo del producto: gestionas la especificación completa de un proyecto de software. Tres zonas principales:",
      "",
      "| Zona | Función |",
      "|------|---------|",
      "| **Izquierda — Chat** | Conversación con el orquestador IA. Según la pestaña activa, los mensajes van al flujo adecuado. Escribe **`/`** para ver comandos rápidos (ej. `/contexto` para regenerar solo esa sección del MDD). |",
      "| **Centro — Documentos** | Pestañas con los documentos generados: MDD, Spec, Arquitectura, Casos de Uso, Blueprint, etc. Cada uno se genera y edita aquí. |",
      "| **Derecha — Semáforo y costos** | Estado de conformidad del MDD contra la **Constitución SDD** y estimación económica por rol. |",
      "",
      "---",
      "",
      "## Orden recomendado del flujo",
      "",
      "El flujo completo depende de la **complejidad** del proyecto (Baja / Media / Alta):",
      "",
      "**Alta complejidad (producto nuevo):**",
      "`Paso 0 → BRD → To-Be → MDD → Spec → Arq. → Casos → H.U. → Blueprint → Design System → API → Flujos → Tasks → Infra`",
      "",
      "- **Paso 0:** investigación de mercado, benchmark y gap analysis (opcional).",
      "- **BRD / To-Be:** requisitos de negocio y estado deseado del producto.",
      "- **MDD:** documento maestro que gobierna todo el resto.",
      "- **Entregables:** el **semáforo en verde + Spec** habilita la generación masiva.",
      "",
      "**Complejidad media (producto nuevo sin MDD explícito):**",
      "No ves MDD en la barra; el insumo es Paso 0 / Spec. Los entregables se limitan a Spec → API → Design System → Tasks.",
      "",
      "**Legacy:**",
      "El tab **Modificación** sustituye el Paso 0. Describe el cambio → AriadneSpecs analiza el código → responde preguntas → genera MDD de cambio → entregables.",
      "",
      "---",
      "",
      "## Semáforo y estimación",
      "",
      "- **Rojo / Amarillo / Verde:** indica si el MDD cumple las reglas mínimas (entidades, contratos, edge cases, etc.) para generar código.",
      "- **Precisión %:** desglose de la última auditoría; puedes abrir logs detallados.",
      "- **Estimación:** horas y costo MXN por rol. Es referencia interna, no precio comercial.",
      "",
      "Sin **verde + Spec** no se habilita la generación masiva de entregables.",
      "",
      "---",
      "",
      "## Chat: qué pedir",
      "",
      "- Pide cambios al MDD en lenguaje natural; el **Manager** delega en agentes (Clarificador, Arquitecto, etc.).",
      "- Usa **`/`** en el campo de texto para regenerar **solo una sección** del MDD (1–7) sin rehacer todo.",
      "- En proyectos **Legacy**, describe la modificación en el tab **Modificación**; el sistema consulta el código real vía AriadneSpecs.",
      "",
      "---",
      "",
      "## Etapas (Stage)",
      "",
      "Cada proyecto puede tener **varias etapas**, cada una con su propio **MDD**, **semáforo** y **estimación**. Los entregables globales (Spec, Blueprint, etc.) son compartidos entre etapas.",
      "",
      "- El **selector de etapa** (arriba a la derecha) define qué MDD se muestra.",
      "- El **hilo del Manager (LangGraph)** es **por etapa**: al cambiar de etapa, el front solicita el thread correcto.",
      "- En **brownfield multi-etapa**, el chat filtra por defecto a la **etapa activa**; usa **«Ver global»** en la barra del chat para ver todo el historial del tab.",
      "- Al cambiar de etapa aparece un aviso recordando que el historial es compartido.",
      "",
      "**Nueva etapa:** botón junto al selector → modal → `POST /projects/:projectId/stages`. Puedes copiar el MDD de otra etapa o empezar vacío.",
      "",
      "---",
      "",
      "## Más documentación",
      "",
      "En el repositorio: `docs/notebooklm/STAGE-SDD.md`, `docs/notebooklm/THEFORGE-INDEX.md`, `docs/notebooklm/ENTREGABLES-SDD-VALIDACION.md`.",
      "",
      "Integración entre monolito legacy y producto nuevo: ver **Integración Legacy ↔ Nuevo** en esta misma ayuda.",
      "",
      "Automatizar drift brownfield en CI (Ariadne + webhook converge): ver **Webhook converge (CI)** en esta misma ayuda.",
      "",
      "Generación en background y orden de entregables: ver **Generación en segundo plano**.",
      "",
      "Plugins comerciales (EVD, empaquetado `.tfplugin`, instalación desde UI): ver **Plugins (.tfplugin)** en esta misma ayuda.",
      "",
      "Modelos IA por campo de proveedor (económico / medio / top): ver **Modelos por proveedor IA**.",
    ].join("\n"),
  },
  {
    id: "modelos-proveedor-ia",
    label: "Modelos por proveedor IA",
    content: modelosProveedorIaHelp.trim(),
  },
  {
    id: "generacion-segundo-plano",
    label: "Generación en segundo plano",
    content: generacionSegundoPlanoHelp.trim(),
  },
  {
    id: "validacion-plan-ariadne",
    label: "Validación plan (Ariadne)",
    content: validacionPlanAriadneHelp.trim(),
  },
  {
    id: "legacy-new-integration",
    label: "Integración Legacy ↔ Nuevo",
    content: legacyNewIntegrationHelp.trim(),
  },
  {
    id: "converge-webhook-ci",
    label: "Webhook converge (CI)",
    content: convergeWebhookCiHelp.trim(),
  },
  {
    id: "plugins-packaging",
    label: "Plugins (.tfplugin)",
    content: pluginsPackagingHelp.trim(),
  },
  {
    id: "sdd",
    label: "Specification Driven Development",
    content: [
      "# Specification Driven Development (SDD)",
      "",
      "## ¿Qué es SDD?",
      "",
      "**Specification Driven Development (SDD)** es una metodología donde **las especificaciones son la fuente de verdad** y el código se deriva de ellas, no al revés. En lugar de \"escribir código y documentar después\", SDD propone:",
      "",
      "1. **Especifica primero** — describe qué debe hacer el sistema, con qué datos, bajo qué reglas.",
      "2. **Valida la especificación** — verifica que sea completa, consistente y sin ambigüedades.",
      "3. **Genera el código** — el código es una consecuencia directa de la especificación.",
      "4. **El cambio empieza en la especificación** — cualquier modificación se hace primero en los documentos, y el código se actualiza en consecuencia.",
      "",
      "Esto se relaciona con enfoques como **Contract-First Design**, **Behavior-Driven Development (BDD)** y **Model-Driven Architecture (MDA)**, pero SDD va más allá al cubrir **todo el ciclo de vida**: requisitos, diseño, implementación y verificación.",
      "",
      "---",
      "",
      "## ¿Por qué TheForge usa SDD?",
      "",
      "El desarrollo de software tradicional tiene tres problemas fundamentales:",
      "",
      "1. **Deriva documentación-código** — los docs se vuelven obsoletos días después de escritos. Al momento de mantener, nadie confía en la documentación.",
      "2. **Ambigüedad en los requisitos** — lo que el PM entiende, lo que el dev implementa y lo que QA prueba son tres cosas distintas.",
      "3. **Costo del cambio exponencial** — cambiar código ya escrito cuesta más que cambiar una especificación.",
      "",
      "TheForge resuelve esto con **SDD automatizado por IA**:",
      "",
      "| Problema | Solución en TheForge |",
      "|----------|---------------------|",
      "| Documentación obsoleta | Los documentos **son la especificación viva**. El código se genera desde ellos. |",
      "| Ambigüedad | El **MDD de 7 secciones** fuerza cubrir datos, contratos, edge cases y seguridad. El **semáforo** valida completitud. |",
      "| Costo del cambio | Cambias la especificación → la IA regenera el código automáticamente. |",
      "",
      "---",
      "",
      "## La cascada SDD en TheForge",
      "",
      "```",
      "+---------+",
      "|  Paso 0 |  Benchmark, investigación de mercado, gap analysis (opcional)",
      "+----+----+",
      "     |",
      "+----v----+",
      "|   BRD   |  Requisitos de negocio: problema, KPIs, alcance, reglas con stakeholders",
      "+----+----+",
      "     |",
      "+----v----+",
      "|  To-Be  |  Estado deseado del producto, comportamiento esperado",
      "+----+----+",
      "     |",
      "+----v-------+         ←── CONSTITUCIÓN ──→",
      "|    MDD      |  Documento maestro de 7 secciones. Gobierna todo lo demás.",
      "+----+-------++         La conformidad se mide contra el MDD.",
      "     |       |",
      "+----v----+  +----v----+",
      "|  Spec   |  |   ...   |  (en paralelo se derivan: Arq., Casos, HU, etc.)",
      "+---------+  +---------+",
      "```",      "",
      "El **MDD** es la **Constitución**. Cada documento derivado (Blueprint, API, Tasks, etc.) debe ser conforme al MDD. El **semáforo** (rojo/amarillo/verde) mide esa conformidad.",
      "",
      "---",
      "",
      "## El ciclo de vida SDD",
      "",
      "1. **Definir** — se escribe el MDD y documentos de especificación.",
      "2. **Validar** — el semáforo verifica que todos los documentos estén alineados y completos.",
      "3. **Generar** — cuando el semáforo está en verde y existe Spec, se lanza la cascada de entregables.",
      "4. **Implementar** — el código se genera desde los documentos (Hermes Agent).",
      "5. **Evolucionar** — los cambios empiezan en los documentos, el semáforo se actualiza, el código se regenera.",
      "",
      "---",
      "",
      "## Diferencias clave con otros enfoques",
      "",
      "| Enfoque | Énfasis | Limitación |",
      "|---------|---------|------------|",
      "| **BDD** | Comportamiento desde el usuario | No cubre arquitectura, datos ni infra |",
      "| **DDD** | Modelado de dominio | Requiere equipo experto, no escala sin herramientas |",
      "| **MDA** | Modelos UML → código | Pesado, los modelos se desincronizan |",
      "| **SDD (TheForge)** | Especificación completa IA-asistida | Depende del LLM, pero siempre trazable |",
      "",
      "---",
      "",
      "## Trazabilidad: del documento al código",
      "",
      "Cada documento en TheForge tiene un **impacto directo** en el código generado:",
      "",
      "| Documento | Impacto en el código |",
      "|-----------|---------------------|",
      "| **MDD** | Modelo de datos (entidades, relaciones), stack tecnológico, estructura del proyecto |",
      "| **Spec** | Comportamiento esperado, criterios de aceptación, reglas de negocio |",
      "| **Blueprint** | Esquema Prisma/TypeORM, controladores, servicios, rutas |",
      "| **API Contracts** | Endpoints, request/response, validación, middleware |",
      "| **Design System** | Componentes visuales, paleta, espaciado, tokens de diseño |",
      "| **Tasks** | Desglose de trabajo ejecutable para el equipo de desarrollo |",
      "",
      "Cada sección más abajo en esta ayuda explica en detalle cada documento.",
    ].join("\n"),
  },
  {
    id: "mdd",
    label: "MDD — Master Design Document",
    content: [
      "# MDD — Master Design Document",
      "",
      "## ¿Qué es en SDD?",
      "",
      "El **MDD** es la **Constitución del proyecto**. Es el documento maestro del que derivan todos los demás. En SDD, el MDD ocupa el lugar central: cualquier documento o línea de código debe ser **conforme** al MDD.",
      "",
      "Sin un MDD completo y validado (semáforo verde), los entregables generados pueden ser inconsistentes o incompletos.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "El MDD se estructura en **7 secciones** obligatorias:",
      "",
      "| # | Sección | Qué define |",
      "|---|---------|------------|",
      "| 1 | **Contexto** | Propósito del proyecto, stack tecnológico, restricciones, dominio del problema |",
      "| 2 | **Arquitectura** | Componentes del sistema, patrón (monolito, microservicios, BFF), boundaries |",
      "| 3 | **Modelo de Datos** | Entidades, relaciones, atributos clave, agregados, tipos de datos |",
      "| 4 | **Contratos de API** | Endpoints, métodos, request/response esperados (alto nivel, no implementación) |",
      "| 5 | **Lógica y Edge Cases** | Reglas de negocio, validaciones, flujos alternativos, errores, límites |",
      "| 6 | **Seguridad** | Autenticación, autorización, roles, protección de datos, OWASP básico |",
      "| 7 | **Infraestructura** | Despliegue, base de datos, almacenamiento, redes, CI/CD |",
      "",
      "---",
      "",
      "## Orden y dependencias del pipeline",
      "",
      "Dependencias entre secciones (qué necesita qué antes de escribirse):",
      "",
      "```mermaid",
      "flowchart TD",
      '  S1["§1 Contexto / alcance"]',
      '  S2["§2 Arquitectura y stack"]',
      '  S3["§3 Modelo de datos"]',
      '  S4["§4 Contratos API"]',
      '  S5["§5 Lógica y edge cases"]',
      '  S6["§6 Seguridad"]',
      '  S7["§7 Infraestructura"]',
      '  CC["Cross-consistency + diagramas"]',
      '  AUD["Auditor"]',
      "",
      "  S1 --> S2",
      "  S2 --> S3",
      "  S3 --> S4",
      "  S4 --> S5",
      "  S5 --> S6",
      "  S5 --> S7",
      "  S2 --> S7",
      "  S3 --> S7",
      "  S6 --> CC",
      "  S7 --> CC",
      "  CC --> AUD",
      "```",
      "",
      "### Flujo paralelizado (`tail_parallel`)",
      "",
      "En la pasada completa, tras el Software Architect (**§2–§4**), **§5**, **§6** y **§7** se generan en paralelo, se fusionan y luego entra cross-consistency:",
      "",
      "```mermaid",
      "flowchart LR",
      "  SA[SA §2–§4] --> TP[tail_parallel]",
      "  TP --> S5[§5]",
      "  TP --> S6[§6]",
      "  TP --> S7[§7]",
      "  S5 & S6 & S7 --> M[merge]",
      "  M --> CC[cross-consistency]",
      "```",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "El MDD determina:",
      "",
      "- **Stack tecnológico** (lenguaje, frameworks, bases de datos).",
      "- **Estructura del proyecto** (monorepo, paquetes, módulos).",
      "- **Modelo de datos** entidad-relación → schemas de base de datos y entidades en código.",
      "- **Arquitectura de componentes** → estructura de directorios y servicios.",
      "- **Reglas de seguridad** → guards, middleware, policies.",
      "",
      "Cada sección del MDD tiene una correlación 1:1 con módulos del código generado. Si cambia la sección 3 (Modelo de Datos), cambiarán las entidades, migraciones y servicios relacionados.",
    ].join("\n"),
  },
  {
    id: "spec",
    label: "Spec — Especificación Funcional",
    content: [
      "# Spec — Especificación Funcional / Técnica",
      "",
      "## ¿Qué es en SDD?",
      "",
      "El **Spec** traduce el MDD y el contexto del negocio (BRD, Benchmark) en una especificación accionable. Es el puente entre el \"qué\" (MDD) y el \"cómo se implementa\".",
      "",
      "Mientras el MDD define la **constitución técnica**, el Spec define el **comportamiento esperado** del sistema desde la perspectiva del usuario y del negocio.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Alcance funcional:** módulos, features, flujos principales.",
      "- **Criterios de aceptación** por feature (inspirados en Gherkin/BDD).",
      "- **Reglas de negocio detalladas:** validaciones, cálculos, políticas.",
      "- **Integraciones externas:** APIs third-party, webhooks, eventos.",
      "- **No-funcionales:** performance, disponibilidad, escalabilidad esperada.",
      "- **Datos de prueba:** ejemplos concretos de entrada/salida esperada.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Define los **tests de aceptación** del sistema.",
      "- Las **reglas de negocio** se traducen directamente a lógica en servicios.",
      "- Las **integraciones** se convierten en adapters/clients en el código.",
      "- Los **criterios** guían la implementación de controladores y validación.",
      "",
      "**Importante:** el Spec es **requisito para generar entregables masivos**. Sin Spec + semáforo verde, no se habilita la cascada de documentos.",
    ].join("\n"),
  },
  {
    id: "brd",
    label: "BRD — Business Requirements Document",
    content: [
      "# BRD — Business Requirements Document",
      "",
      "## ¿Qué es en SDD?",
      "",
      "El **BRD** captura los **requisitos de negocio**: el problema que se resuelve, los KPIs, el alcance desde la perspectiva del stakeholder. En SDD, el BRD es el **punto de partida del ciclo de especificación**: toda decisión técnica debe poder trazarse a un requisito de negocio.",
      "",
      "Se genera **por etapa** del Workshop y se refina mediante entrevista con el orquestador.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Problema y oportunidad:** contexto del negocio, dolor identificado.",
      "- **Alcance:** qué entra y qué no entra en la solución.",
      "- **KPIs y métricas de éxito:** cómo se medirá el impacto.",
      "- **Stakeholders y roles:** quién usa el sistema y con qué propósito.",
      "- **Reglas de negocio de alto nivel:** políticas, restricciones, flujos.",
      "- **Riesgos y dependencias:** qué puede fallar y de qué depende el proyecto.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Las **reglas de negocio** del BRD se refinan en el MDD (sección 5) y luego en código de servicios.",
      "- Los **KPIs** guían la instrumentación (métricas, logging, analytics).",
      "- Los **roles de stakeholder** definen la estructura de autorización (RBAC).",
      "- El **alcance** determina qué módulos se construyen y cuáles no.",
    ].join("\n"),
  },
  {
    id: "to-be",
    label: "To-Be — Manual de Estado Deseado",
    content: [
      "# To-Be — Manual de Estado Deseado",
      "",
      "## ¿Qué es en SDD?",
      "",
      "El **Manual To-Be** describe el **estado deseado del producto** desde la perspectiva del usuario: cómo debería comportarse el sistema una vez implementado. Es la visión aspiracional que guía todas las decisiones de diseño.",
      "",
      "En SDD, el To-Be responde a: **¿cómo se ve el éxito desde afuera?** Mientras el BRD dice \"qué necesita el negocio\", el To-Be dice \"cómo se experimenta eso\".",
      "",
      "Se genera junto con el BRD y se refina en el chat del Workshop.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Flujos de usuario ideales:** recorridos completos paso a paso.",
      "- **Pantallas y estados:** lo que el usuario ve en cada momento.",
      "- **Comportamiento esperado:** respuestas del sistema, notificaciones, feedback.",
      "- **Casos de éxito y error:** cómo se comporta el sistema en cada escenario.",
      "- **UX writing:** los mensajes, labels y textos que ve el usuario.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Los **flujos de usuario** se traducen a casos de uso y rutas en el frontend.",
      "- Las **pantallas** guían la estructura de componentes UI.",
      "- Los **estados** definen loading/empty/error/edge cases en cada componente.",
      "- El **UX writing** se convierte en constantes de i18n/localización.",
    ].join("\n"),
  },
  {
    id: "architecture",
    label: "Arquitectura",
    content: [
      "# Arquitectura de Software",
      "",
      "## ¿Qué es en SDD?",
      "",
      "El documento de **Arquitectura** describe la estructura del sistema: componentes, boundaries, patrones de comunicación y decisiones estructurales. En SDD, es la **traducción de la sección 2 del MDD** en un diseño concreto.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Diagrama de arquitectura:** componentes y sus relaciones.",
      "- **Patrón arquitectónico:** monolito modular, microservicios, BFF, event-driven.",
      "- **Boundaries y módulos:** límites entre dominios, carpetas, paquetes.",
      "- **Comunicación:** APIs, eventos, colas, streaming entre componentes.",
      "- **Stack detallado:** versiones específicas de lenguajes, frameworks, librerías.",
      "- **Decisiones justificadas (ADRs):** por qué se eligió cada opción técnica.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Determina la **estructura de directorios** del proyecto generado.",
      "- Define los **módulos de NestJS** / carpetas de frontend.",
      "- Establece los **patrones de inyección de dependencias** y comunicación.",
      "- Las **decisiones arquitectónicas** se registran como ADRs para trazabilidad.",
    ].join("\n"),
  },
  {
    id: "use-cases",
    label: "Casos de Uso",
    content: [
      "# Casos de Uso",
      "",
      "## ¿Qué es en SDD?",
      "",
      "Los **Casos de Uso** describen interacciones concretas entre actores (usuarios, sistemas externos) y el sistema. En SDD, son la **especificación de comportamiento** que conecta el MDD con el código: cada caso de uso se implementa como un flujo en la capa de aplicación.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Actor:** quién inicia la interacción (usuario, admin, sistema externo, cron).",
      "- **Precondiciones:** qué debe ser verdad antes de ejecutar el caso.",
      "- **Flujo principal:** pasos secuenciales del escenario feliz.",
      "- **Flujos alternativos:** variaciones, errores, edge cases.",
      "- **Postcondiciones:** qué queda después de ejecutar el caso.",
      "- **Reglas de negocio aplicables:** referencias al MDD sección 5.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Cada **caso de uso** se traduce típicamente a un **servicio** o **controlador**.",
      "- Los **flujos alternativos** se implementan como manejadores de error o ramas en la lógica.",
      "- Las **pre/post condiciones** → validación de entrada y aserciones de salida.",
      "- Los **casos de uso** también generan **tests de integración**.",
    ].join("\n"),
  },
  {
    id: "user-stories",
    label: "H. de Usuario",
    content: [
      "# Historias de Usuario",
      "",
      "## ¿Qué es en SDD?",
      "",
      "Las **Historias de Usuario** son el desglose priorizable del trabajo desde la perspectiva del usuario. En SDD, se derivan de los Casos de Uso y el Spec: **cada historia es un incremento de valor entregable** que puede ser estimado, asignado y completado en un ciclo de trabajo.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Formato estándar:** *Como [rol], quiero [acción] para [beneficio]*.",
      "- **Criterios de aceptación:** escenarios concretos (Given/When/Then) que validan la historia.",
      "- **Priorización:** orden sugerido de implementación (MoSCoW o similar).",
      "- **Dependencias:** qué historias deben completarse antes.",
      "- **Estimación:** puntos de historia o tiempo estimado.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Cada historia se traduce a **tareas técnicas** en el generador de código.",
      "- Los **criterios de aceptación** se convierten en **tests automatizados**.",
      "- La **priorización** define el orden de generación de módulos y componentes.",
      "- Las **dependencias** evitan generar código que depende de algo que no existe.",
    ].join("\n"),
  },
  {
    id: "blueprint",
    label: "Blueprint",
    content: [
      "# Blueprint",
      "",
      "## ¿Qué es en SDD?",
      "",
      "El **Blueprint** es la **especificación técnica detallada** del sistema. Mientras el MDD dice \"qué\", el Blueprint dice **\"cómo se construye exactamente\"**. Es el documento más cercano al código: contiene los esquemas de base de datos, las rutas de API detalladas y la estructura de servicios.",
      "",
      "En SDD, el Blueprint es el **último paso antes de generar código**. Si el Blueprint es correcto, el código es una transcripción directa.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Esquema de base de datos:** tablas, columnas, tipos, relaciones, índices (formato Prisma / TypeORM).",
      "- **Servicios y controladores:** lista de módulos con sus métodos y dependencias.",
      "- **DTOs y validación:** schemas de entrada/salida para cada operación.",
      "- **Middleware y guards:** autenticación, autorización, logging, rate limiting.",
      "- **Módulos y dependencias:** árbol de imports y providers de NestJS.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- El **esquema de BD** se convierte en el schema de Prisma/TypeORM + migraciones.",
      "- Los **servicios** se generan como módulos NestJS con inyección de dependencias.",
      "- Los **DTOs** se generan con decoradores de validación (class-validator, zod).",
      "- Los **guards y middleware** se inyectan en las rutas correspondientes.",
      "- El Blueprint es la **entrada principal del pipeline de generación de código**.",
    ].join("\n"),
  },
  {
    id: "ux-ui-guide",
    label: "Design System",
    content: [
      "# Design System",
      "",
      "## ¿Qué es en SDD?",
      "",
      "La **Design System** estandariza la experiencia visual del producto. En formato **DESIGN.md**, define tokens de diseño (colores, tipografía, espaciado, elevación) y componentes visuales. En SDD, es la especificación que asegura que el frontend generado sea **visualmente coherente** sin depender de un diseñador en cada iteración.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Tokens de diseño:** paleta de colores (12 slots), tipografía (9 niveles), border-radius, espaciado, sombras/elevación.",
      "- **Componentes visuales:** botones, inputs, cards, badges, modales, tabs, skeletons, tablas, kanban.",
      "- **Estados:** hover, active, disabled, focus, error para cada componente.",
      "- **Layout:** sistema de rejilla, breakpoints responsive, padding general.",
      "- **Iconografía:** estilo de iconos, sizes, colores por contexto.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Los **tokens de diseño** se traducen a variables CSS y configuración de Tailwind.",
      "- Los **componentes** se generan como componentes React con PrimeReact o Tailwind.",
      "- Los **estados** definen clases condicionales en cada componente.",
      "- El **layout** guía la estructura de páginas y vistas del frontend.",
      "- Sin Design System, el frontend generado usa defaults genéricos.",
    ].join("\n"),
  },
  {
    id: "api-contracts",
    label: "Contratos de API",
    content: [
      "# Contratos de API",
      "",
      "## ¿Qué es en SDD?",
      "",
      "Los **Contratos de API** son la especificación explícita de cada endpoint. En SDD, son el **contrato entre frontend y backend**: definen exactamente qué espera cada lado. Sin contratos explícitos, el frontend y backend pueden desincronizarse incluso con el mismo MDD.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Método y ruta:** `GET /api/v1/projects/:id`.",
      "- **Request:** headers, query params, path params, body (schema completo).",
      "- **Response:** status codes, body por cada código, headers.",
      "- **Validación:** reglas de cada campo (required, type, min, max, pattern).",
      "- **Autenticación:** qué endpoints requieren auth, qué roles tienen acceso.",
      "- **Ejemplos:** payload de request y response para cada endpoint.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Cada **endpoint** se genera como un método en el controlador NestJS correspondiente.",
      "- Los **schemas de request/response** se convierten en DTOs con validación (class-validator, zod).",
      "- Los **códigos de error** se traducen a excepciones HTTP estandarizadas.",
      "- Los **contratos** también generan el **cliente API** para el frontend (fetch/axios).",
    ].join("\n"),
  },
  {
    id: "logic-flows",
    label: "Flujos de Lógica",
    content: [
      "# Flujos de Lógica",
      "",
      "## ¿Qué es en SDD?",
      "",
      "Los **Flujos de Lógica** documentan visualmente (diagramas) el comportamiento del sistema. En SDD, traducen las reglas de la sección 5 del MDD en **diagramas de flujo, state machines y secuencias** que el generador de código puede interpretar.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Diagramas de flujo:** procesos de negocio paso a paso.",
      "- **State machines:** estados posibles del sistema y transiciones.",
      "- **Diagramas de secuencia:** interacción entre componentes a lo largo del tiempo.",
      "- **Reglas de transición:** condiciones que disparan cada cambio de estado.",
      "- **Manejo de errores:** qué pasa cuando falla cada paso.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Los **diagramas de flujo** se traducen a lógica condicional en servicios.",
      "- Las **state machines** se implementan como enumeraciones + transiciones validadas.",
      "- Los **diagramas de secuencia** definen el orden de llamadas entre servicios.",
      "- El **manejo de errores** se traduce a bloques try/catch con respuestas específicas.",
    ].join("\n"),
  },
  {
    id: "tasks",
    label: "Tasks",
    content: [
      "# Tasks — Desglose de Trabajo",
      "",
      "## ¿Qué es en SDD?",
      "",
      "Las **Tasks** son el desglose ejecutable del trabajo. En SDD, representan el **nivel más granular de la especificación**: cada task es una unidad de trabajo que un desarrollador puede tomar e implementar directamente.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Título y descripción:** qué hay que hacer y por qué.",
      "- **Archivos afectados:** lista de archivos a crear o modificar.",
      "- **Dependencias:** qué tasks deben completarse antes.",
      "- **Criterios de aceptación:** cómo saber si la task está completa.",
      "- **Estimación:** tiempo estimado en horas.",
      "- **Prioridad:** alta, media, baja dentro del sprint/fase.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Las tasks **no se generan automáticamente como código**, sino como **guía para el equipo** (o para Hermes Agent al generar código).",
      "- Definen el **orden de implementación**: qué módulo se construye primero.",
      "- Cada task mapea a uno o más **commits/PRs** esperados.",
      "- Son la entrada del **pipeline de desarrollo** (theforge-development-workflow).",
    ].join("\n"),
  },
  {
    id: "infra",
    label: "Infraestructura",
    content: [
      "# Infraestructura",
      "",
      "## ¿Qué es en SDD?",
      "",
      "El documento de **Infraestructura** describe cómo se despliega y opera el sistema. En SDD, asegura que la especificación no se limite al código: **la infraestructura también se especifica** y se genera desde los documentos.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "- **Servicios:** lista de contenedores, imágenes, puertos, volúmenes.",
      "- **Base de datos:** motor, versión, conexión, backups, replicación.",
      "- **Redes:** dominios, DNS, proxies reversos (Traefik, Nginx), SSL.",
      "- **CI/CD:** pipeline de build, test, deploy, variables de entorno.",
      "- **Monitoreo:** logs, métricas, alertas, healthchecks.",
      "- **Costos y escalado:** recursos estimados, auto-scaling, límites.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Genera archivos de **Docker Compose** y **Dockerfile**.",
      "- Define las **variables de entorno** necesarias para cada servicio.",
      "- Configura **healthchecks** y dependencias entre servicios.",
      "- Genera la configuración de **CI/CD** (.github/workflows, Dokploy config).",
      "- Define los **proveedores externos** (DB, Redis, colas, storage).",
    ].join("\n"),
  },
  {
    id: "adrs",
    label: "ADRs — Architectural Decision Records",
    content: [
      "# ADRs — Architectural Decision Records",
      "",
      "## ¿Qué es en SDD?",
      "",
      "Los **ADRs** documentan las decisiones arquitectónicas importantes y su justificación. En SDD, son el **registro histórico de por qué el sistema es como es**. Cada vez que el orquestador toma una decisión de diseño, la registra como ADR para que futuras iteraciones tengan contexto.",
      "",
      "---",
      "",
      "## ¿Qué contiene?",
      "",
      "Cada ADR sigue el formato estándar **Y-Statements**:",
      "",
      "- **Contexto:** situación que motiva la decisión.",
      "- **Decisión:** qué se decidió, con detalles técnicos.",
      "- **Consecuencias:** impacto positivo y negativo de la decisión.",
      "- **Alternativas consideradas:** otras opciones y por qué se descartaron.",
      "- **Estado:** propuesta, aceptada, deprecated, superada.",
      "",
      "---",
      "",
      "## Impacto en el código",
      "",
      "- Los ADRs **no generan código directamente**, pero guían decisiones futuras.",
      "- Previenen **regresiones arquitectónicas**: si alguien quiere cambiar una decisión, el ADR explica por qué se tomó.",
      "- Ayudan a la IA a **mantener consistencia** entre sesiones de generación.",
      "- Se almacenan como **memoria semántica** del proyecto y se inyectan en el contexto del LLM.",
    ].join("\n"),
  },
];

const NAV_GROUPS: { label: string; sectionIds: string[] }[] = [
  { label: "Guía", sectionIds: ["manual", "modelos-proveedor-ia", "generacion-segundo-plano", "validacion-plan-ariadne", "legacy-new-integration", "converge-webhook-ci", "plugins-packaging"] },
  { label: "Metodología", sectionIds: ["sdd"] },
  {
    label: "Documentos",
    sectionIds: [
      "mdd",
      "spec",
      "brd",
      "to-be",
      "architecture",
      "use-cases",
      "user-stories",
      "blueprint",
      "ux-ui-guide",
      "api-contracts",
      "logic-flows",
      "tasks",
      "infra",
      "adrs",
    ],
  },
];

const SECTION_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

/* ───── Markdown renderer components ───── */

function FlowStepPills({ text }: { text: string }) {
  const steps = text.split(/\s*→\s*/).map((s) => s.trim()).filter(Boolean);
  if (steps.length < 2) return null;
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_22%,var(--card))] p-3"
      role="list"
      aria-label="Secuencia del flujo"
    >
      {steps.map((step, index) => (
        <span key={`${step}-${index}`} className="inline-flex items-center gap-1.5" role="listitem">
          {index > 0 ? (
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
          ) : null}
          <span className="rounded-full border border-[color-mix(in_oklch,var(--primary)_25%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))] px-2.5 py-1 font-mono text-[11px] font-medium text-[var(--foreground)]">
            {step}
          </span>
        </span>
      ))}
    </div>
  );
}

const mdComponents = {
  h1: (props: ComponentPropsWithoutRef<"h1">) => (
    <h1
      className="mt-2 border-b border-[var(--border)] pb-2 text-xl font-semibold text-[var(--foreground)] first:mt-0"
      {...props}
    />
  ),
  h2: (props: ComponentPropsWithoutRef<"h2">) => (
    <h2
      className="mt-6 text-base font-semibold text-[var(--primary)] first:mt-0"
      {...props}
    />
  ),
  h3: (props: ComponentPropsWithoutRef<"h3">) => (
    <h3 className="mt-4 text-sm font-medium text-[var(--foreground)]" {...props} />
  ),
  p: (props: ComponentPropsWithoutRef<"p">) => (
    <p className="mb-3 text-sm leading-relaxed text-[var(--foreground-muted)] last:mb-0 sm:text-[15px]" {...props} />
  ),
  ul: (props: ComponentPropsWithoutRef<"ul">) => (
    <ul className="mb-3 list-disc space-y-1.5 pl-5 text-[var(--foreground-muted)]" {...props} />
  ),
  ol: (props: ComponentPropsWithoutRef<"ol">) => (
    <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-[var(--foreground-muted)]" {...props} />
  ),
  li: (props: ComponentPropsWithoutRef<"li">) => <li className="leading-relaxed" {...props} />,
  strong: (props: ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold text-[var(--foreground)]" {...props} />
  ),
  code: (props: ComponentPropsWithoutRef<"code"> & { node?: unknown }) => {
    const mermaidBlock = tryRenderMarkdownMermaid(props);
    if (mermaidBlock) return mermaidBlock;

    const { className, children, ...rest } = props;
    const isBlock = Boolean(className?.startsWith("language-"));
    if (isBlock) {
      return (
        <code className={cn("font-mono text-sm", className)} {...rest}>
          {children}
        </code>
      );
    }
    const inlineText = String(children ?? "").replace(/\n/g, " ").trim();
    if (inlineText.includes("→")) {
      return <FlowStepPills text={inlineText} />;
    }
    return (
      <code
        className="rounded-[calc(var(--radius)-2px)] border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-[0.85em] text-[var(--foreground)]"
        {...rest}
      >
        {children}
      </code>
    );
  },
  pre: (props: ComponentPropsWithoutRef<"pre">) => (
    <MarkdownMermaidPre
      className="mb-4 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_45%,var(--card))] p-4 text-sm leading-relaxed text-[var(--foreground)] shadow-sm [scrollbar-color:var(--muted-foreground)_transparent]"
      {...props}
    />
  ),
  hr: () => <hr className="my-6 border-[var(--border)]" />,
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote
      className="mb-4 rounded-[var(--radius)] border border-[color-mix(in_oklch,var(--primary)_22%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_7%,var(--card))] px-4 py-3 text-sm leading-relaxed text-[var(--foreground-muted)] [&>p:last-child]:mb-0"
      {...props}
    />
  ),
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="mb-4 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_82%,var(--background))] shadow-sm [&_tbody_tr:last-child_td]:border-b-0">
      <table className="w-full border-collapse text-left text-xs" {...props} />
    </div>
  ),
  thead: (props: ComponentPropsWithoutRef<"thead">) => (
    <thead className="bg-[color-mix(in_oklch,var(--muted)_55%,var(--card))]" {...props} />
  ),
  th: (props: ComponentPropsWithoutRef<"th">) => (
    <th className="border-b border-[var(--border)] px-3 py-2.5 font-medium text-[var(--foreground)]" {...props} />
  ),
  td: (props: ComponentPropsWithoutRef<"td">) => (
    <td className="border-b border-[var(--border)] px-3 py-2.5 align-top text-[var(--foreground-muted)]" {...props} />
  ),
  a: (props: ComponentPropsWithoutRef<"a">) => (
    <a
      className="text-[var(--primary)] underline-offset-2 hover:underline"
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
};

function HelpNavButton({
  section,
  active,
  onSelect,
}: {
  section: HelpSection;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = SECTION_ICONS[section.id] ?? FileText;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors",
        active
          ? "bg-[color-mix(in_oklch,var(--primary)_14%,var(--sidebar))] text-[var(--primary)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_28%,transparent)]"
          : "text-[var(--muted-foreground)] hover:bg-[color-mix(in_oklch,var(--muted)_45%,transparent)] hover:text-[var(--foreground)]",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
          active
            ? "bg-[color-mix(in_oklch,var(--primary)_18%,var(--card))] text-[var(--primary)]"
            : "bg-[color-mix(in_oklch,var(--muted)_55%,var(--card))] text-[var(--muted-foreground)]",
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 truncate leading-snug">{section.label}</span>
    </button>
  );
}

function HelpSidebar({
  activeSection,
  onSelectSection,
}: {
  activeSection: string;
  onSelectSection: (id: string) => void;
}) {
  return (
    <nav
      className="flex min-h-0 flex-col gap-1 overflow-y-auto p-2 [scrollbar-gutter:stable] sm:max-h-[min(62vh,560px)]"
      aria-label="Secciones de ayuda"
    >
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="min-w-0">
          <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)] first:pt-1">
            {group.label}
          </p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {group.sectionIds.map((id) => {
              const section = SECTION_BY_ID.get(id);
              if (!section) return null;
              return (
                <li key={id}>
                  <HelpNavButton
                    section={section}
                    active={id === activeSection}
                    onSelect={() => onSelectSection(id)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/* ───── Component ───── */

export default function WorkshopHelpModal({ open, onClose }: WorkshopHelpModalProps) {
  const [activeSection, setActiveSection] = useState(SECTIONS[0]!.id);

  const section: HelpSection = SECTION_BY_ID.get(activeSection) ?? SECTIONS[0]!;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        size="xl"
        showClose
        className="flex max-h-[min(92vh,900px)] w-[calc(100vw-1.25rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <div className="shrink-0 border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--primary)_9%,var(--card))] px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-start gap-3 pr-6">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--primary)_16%,var(--card))] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_28%,transparent)]"
                aria-hidden
              >
                <HelpCircle className="h-5 w-5 text-[var(--primary)]" strokeWidth={2} />
              </span>
              <div className="min-w-0 space-y-1">
                <DialogTitle
                  id="workshop-help-title"
                  className="text-lg font-semibold tracking-tight text-[var(--foreground)] sm:text-xl"
                >
                  Ayuda — TheForge
                </DialogTitle>
                <DialogDescription className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                  Manual del workshop, metodología SDD y referencia de cada documento del flujo.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="shrink-0 border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_14%,var(--card))] sm:w-60 sm:border-b-0 sm:border-r lg:w-64">
            <select
              value={activeSection}
              onChange={(e) => setActiveSection(e.target.value)}
              className={cn(
                "sticky top-0 z-10 m-2 block w-[calc(100%-1rem)] rounded-md border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] shadow-sm sm:hidden",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]",
              )}
              aria-label="Sección de ayuda"
            >
              {SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="hidden sm:block">
              <HelpSidebar activeSection={activeSection} onSelectSection={setActiveSection} />
            </div>
          </div>

          <div className="relative min-h-0 min-w-0 flex-1">
            <div className="max-h-[min(62vh,560px)] overflow-y-auto px-5 py-4 scroll-smooth sm:px-6 sm:py-5 [scrollbar-gutter:stable]">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {section.content}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_18%,var(--card))] px-5 py-3 sm:px-6">
          <Button type="button" variant="default" className="w-full sm:w-auto" onClick={onClose}>
            Entendido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
