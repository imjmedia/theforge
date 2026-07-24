/** Construcción unificada del system prompt del Workshop (sync + stream). */
import type { GenerateResponseOptions, ChatMessage as LlmChatMessage } from "./interfaces/llm-provider.interface.js";
import { MASTER_PROMPT } from "./prompts/master-prompt.js";
import { UX_UI_GUIDE_PROMPT } from "./prompts/ux-ui-guide-prompt.js";
import { BENCHMARK_REFINE_PROMPT } from "./prompts/phase0-benchmark-refine-prompt.js";
import { DOCUMENT_CHANGELOG_CHAT_INSTRUCTION } from "./prompts/with-document-changelog-instructions.js";
import { BRD_CHAT_REFINE_BUSINESS_RULES } from "./prompts/brd-generation-prompt.js";
import {
  WORKSHOP_DBGA_APPROVAL_BEFORE_EDIT_INSTRUCTION,
  WORKSHOP_DBGA_EDIT_COVENANT,
  workshopFinDelimiterCovenant,
  isExplicitContext7ChatRequest,
} from "@theforge/shared-types";
import { appendTechDocsToSystemPrompt } from "../technology-docs-mcp/tech-docs-context.util.js";
import { frozenTabSystemPromptBlock } from "../sessions/workshop-document-turn.util.js";
import {
  buildUserDeclaredStackPromptBlock,
  collectUserStackSources,
  hasUserDeclaredStack,
  learningHistoryStackGuardBlock,
} from "../ai-analysis/utils/user-declared-stack.util.js";

const WELCOME_BRIEF_SYSTEM_PROMPT = `Eres el asistente del Workshop **The Forge** (especificación: MDD, BRD por etapa, Manual To-Be, Spec, Benchmark, etc.).
- Responde en **español**, tono profesional y **breve**.
- No inventes requisitos que contradigan el texto del **mensaje de usuario** (puede traer fragmentos de Benchmark, BRD u otros documentos).
- Si el mensaje pide **un solo** mensaje de bienvenida u orientación inicial, cumple sin divagar ni copiar el enunciado entero.`;

export const WORKSHOP_ACTIVE_TAB_LABELS: Record<string, string> = {
  spec: "Spec (SDD: what/why)",
  brd: "BRD (etapa)",
  mdd: "MDD",
  architecture: "Arquitectura del sistema",
  "use-cases": "Casos de Uso",
  "user-stories": "Historias de Usuario",
  "ux-ui-guide": "Guía UX/UI",
  blueprint: "Blueprint",
  "api-contracts": "Contratos de API",
  "logic-flows": "Flujos de lógica",
  infra: "Infraestructura",
  tasks: "Tareas (Breakdown)",
};

export type WorkshopSystemPromptVariant = "sync" | "stream";

export type BuildWorkshopSystemPromptContext = {
  variant: WorkshopSystemPromptVariant;
  history: LlmChatMessage[];
  userPrompt: string;
  phase0TechDocs: string | null;
};

/** Política Google Stitch + fragmentos SDD para Guía UX/UI (según projectType). */
export function appendUxGuideStitchPolicy(
  systemPrompt: string,
  options: GenerateResponseOptions | undefined,
): string {
  const pt = options?.projectTypeForUxGuide;
  if (!pt) return systemPrompt;
  if (options?.activeTab?.trim() !== "ux-ui-guide") return systemPrompt;
  let s = systemPrompt;
  if (pt === "LEGACY") {
    return (
      s +
      "\n\n**[Tipo de proyecto: LEGACY]** Cambio sobre sistema existente. **Prohibido** incluir en la Guía UX/UI ninguna sección titulada **«Prompt para Google Stitch»** ni brief para herramientas de diseño generativo (p. ej. Google Stitch) orientado a un producto greenfield desde cero. La guía debe alinearse con lo ya existente descrito en el MDD y el contexto del proyecto."
    );
  }
  if (pt === "NEW") {
    s +=
      "\n\n**[Tipo de proyecto: NEW]** Al generar o actualizar la **Guía UX/UI completa**, **incluye obligatoriamente** al final del documento markdown (antes de la línea `---FIN_UX_UI---`) la sección **## Prompt para Google Stitch (producto)** con **un único bloque de texto** listo para copiar y pegar en Google Stitch. Ese prompt debe describir **el producto que estamos especificando en este proyecto** (el sistema del cliente según el MDD y los documentos del contexto), **no** la aplicación interna The Forge ni su Workshop. Incluye: (1) nombre provisional del producto y propuesta de valor en una frase; (2) usuarios objetivo y contexto de uso; (3) inventario de **pantallas, vistas o flujos** inferidos de MDD, Blueprint, Spec, casos de uso, historias, flujos de lógica y arquitectura que recibes en el contexto; (4) dirección visual, stack de UI (p. ej. React, Tailwind, shadcn) y criterios de accesibilidad alineados a las secciones anteriores de esta guía; (5) si el producto es web, pedir **variantes desktop y móvil**; (6) estados vacío, carga y error en flujos críticos. Si faltan datos, **infórelos** y declara **supuestos explícitos** dentro del bloque Stitch.";
    const docs = options.uxGuideAdditionalDocs;
    if (docs) {
      const blocks: [string, string | undefined][] = [
        ["Spec (SDD what/why)", docs.spec],
        ["Casos de uso", docs.useCases],
        ["Historias de usuario", docs.userStories],
        ["Flujos de lógica / interacción", docs.logicFlows],
        ["Arquitectura del sistema (impacto UI)", docs.architecture],
        ["Contratos de API (datos y pantallas)", docs.apiContracts],
        ["Benchmark & Gap Analysis (dominio)", docs.dbga],
        ["Resumen fase 0", docs.phase0],
      ];
      for (const [title, body] of blocks) {
        if (body?.trim()) {
          s += `\n\n[${title} — contexto para Guía UX/UI y Prompt Stitch del producto]\n---\n${body.trim()}\n---`;
        }
      }
    }
  }
  // Design Reference: inyectar tokens de diseño seleccionado o auto-match
  const designRefBlock = options?.uxGuideDesignRefPromptBlock;
  if (designRefBlock) {
    const mode = options?.uxGuideDesignRefMode ?? "explicit";
    const slug = options?.uxGuideDesignRefEffectiveSlug ?? options?.uxGuideDesignRef ?? "reference";
    s += `\n\n## [Design Reference activo: ${slug} · modo ${mode}]\n${designRefBlock}`;
    if (mode === "explicit") {
      s +=
        "\n\n### Instrucciones\nUsa los hex del bloque anterior como **base canónica** del YAML (colors.primary, background, accent). Adapta nombres semánticos al dominio; **prohibido** sustituir por paleta shadcn genérica.";
    } else {
      s +=
        "\n\n### Instrucciones\nReferencia sugerida por dominio del MDD. Transpón paleta y personalidad al producto; evita colores genéricos repetidos entre proyectos.";
    }
  }
  return s;
}

function resolveBaseSystemPrompt(options: GenerateResponseOptions | undefined): string {
  const isUxUiGuide = options?.activeTab?.trim() === "ux-ui-guide";
  const isBenchmarkRefine =
    options?.activeTab?.trim() === "benchmark" && (options?.currentDbgaContent?.trim() ?? "").length > 0;
  return (
    options?.systemPrompt ??
    (options?.welcomeBrief
      ? WELCOME_BRIEF_SYSTEM_PROMPT
      : isBenchmarkRefine
        ? BENCHMARK_REFINE_PROMPT
        : isUxUiGuide
          ? UX_UI_GUIDE_PROMPT
          : MASTER_PROMPT)
  );
}

function appendSyncWorkshopInstructions(
  systemPrompt: string,
  options: GenerateResponseOptions | undefined,
): string {
  const isUxUiGuide = options?.activeTab?.trim() === "ux-ui-guide";
  const isBenchmarkRefine =
    options?.activeTab?.trim() === "benchmark" && (options?.currentDbgaContent?.trim() ?? "").length > 0;
  let s = systemPrompt;
    if (options?.activeTab?.trim()) {
      const at = options.activeTab.trim();
      const label = WORKSHOP_ACTIVE_TAB_LABELS[at] ?? at;
      const intent = options?.intent ?? "mixed";
  
      // TagMap para delimitadores
      const tagMap: Record<string, string> = {
        mdd: "MDD",
        benchmark: "DBGA",
        spec: "SPEC",
        brd: "BRD",
        architecture: "ARCH",
        "use-cases": "USECASES",
        "user-stories": "STORIES",
        blueprint: "BLUEPRINT",
        "api-contracts": "API",
        "logic-flows": "FLOWS",
        tasks: "TASKS",
        infra: "INFRA",
        phase0: "PHASE0",
        "ux-ui-guide": "UX_UI",
      };
      const tag = tagMap[at];
  
      // Contexto de documento activo
      s += `\n\n[Contexto de documento activo:] El usuario está trabajando en: **${label}**. Adapta tu respuesta a ese documento (preguntas, sugerencias o ediciones relevantes para ese contexto).\n`;

      const frozenBlock = frozenTabSystemPromptBlock(at);
      if (frozenBlock) {
        s += `\n\n${frozenBlock}`;
      } else if (intent === "explore") {
        s +=
          `\n**ATENCIÓN — MODO EXPLORACIÓN:** El usuario está **preguntando o explorando ideas** sobre el documento. ` +
          `NO hagas cambios al documento. Responde de forma conversacional, explica conceptos, discute alternativas. ` +
          `Si el usuario te pide explícitamente hacer un cambio (ej. "agrega esto", "actualiza", "haz el cambio"), ` +
          `entonces sí debes devolver el documento actualizado con el delimitador ---FIN_${tag ?? "DOC"}---. ` +
          `Pero mientras el usuario solo pregunte o explore, responde sin modificar el documento.`;
        if (at === "benchmark") {
          s += `\n\n${WORKSHOP_DBGA_APPROVAL_BEFORE_EDIT_INSTRUCTION}`;
        }
      } else if (!frozenBlock) {
        // direct_edit o mixed — mantener detección de cambios pero con matiz
        s +=
          `\n**INSTRUCCIÓN — DETECCIÓN DE CAMBIOS:** Si el usuario da una **instrucción directa** ` +
          `(ej. "agrega", "cambia", "modifica", "actualiza", "corrige", "elimina") es una solicitud de modificación. ` +
          `**Pero si el usuario está preguntando, explorando opciones o discutiendo alternativas** ` +
          `(ej. "qué tal si...", "cómo sería...", "sería mejor...", "se podría..."), ` +
          `**NO** hagas cambios — responde de forma conversacional. ` +
          `Solo aplica cambios cuando el usuario confirme explícitamente ` +
          `(ej. "sí", "dale", "aplica", "hazlo", "integra eso", "haz los cambios"). ` +
          `Cuando apliques cambios, DEBES devolver el documento actualizado con su delimitador ---FIN_TAG--- inmediatamente.`;
        if (at === "benchmark") {
          s += `\n\n${WORKSHOP_DBGA_APPROVAL_BEFORE_EDIT_INSTRUCTION}`;
        }
      }
  
      if (tag && !options?.welcomeBrief && !frozenBlock) {
        s += `\n\n${workshopFinDelimiterCovenant(tag, label)}`;
        if (at === "benchmark") {
          s += `\n\n${WORKSHOP_DBGA_EDIT_COVENANT}`;
        }
        if (at === "mdd") {
          s +=
            "\n\n**\u26a0\ufe0f REGLA ABSOLUTA \u2014 MDD:\n1. **No eval\u00faes si un cambio es \"ya est\u00e1 cubierto\" o \"impacto m\u00ednimo\".** Si el usuario expresa un requisito expl\u00edcito (\"necesitamos X\", \"queremos Y\", \"usa Z\", \"agrega\", \"cambia\", \"modifica\", \"actualiza\", \"corrige\", \"elimina\"), es una orden, no una sugerencia. **El requerimiento del usuario siempre tiene prioridad sobre tu inferencia.**\n2. **NO respondas \"El MDD actual ya especifica...\" y te saltes el cambio.** Si el usuario pide algo, actualiza el documento para reflejarlo expl\u00edcitamente.\n3. Cada vez que el usuario pida agregar, cambiar, modificar, actualizar, corregir o eliminar algo del MDD, o cuando despu\u00e9s de preguntar confirme (\"s\u00ed\", \"dale\", \"aplica\", \"correcto\"), **DEBES** devolver el **MDD COMPLETO ACTUALIZADO** (conservando TODO el contenido existente m\u00e1s los cambios) terminando con `---FIN_MDD---`.\n4. **NUNCA** respondas solo con un mensaje como \"MDD actualizado\" o \"Hecho\" \u2014 si lo haces, el sistema NO persiste ning\u00fan cambio y el usuario cree que se aplic\u00f3 cuando no es as\u00ed. Siempre incluye un mensaje breve resumiendo el cambio DESPU\u00c9S de `---FIN_MDD---`.";
        }
        if (at === "spec") {
          s +=
            "\n\n**Cuando el usuario confirme que integre o aplique cambios al Spec** (ej. \"sí ingrésalo\", \"integralo\", \"aplica\", \"confirma\", \"actualiza el spec\"), **debes** devolver el **documento Spec completo** actualizado (incluyendo lo que ya existía más la nueva sección o cambios), terminando con \`---FIN_SPEC---\`. Nunca respondas solo con un mensaje tipo \"El documento Spec ha sido actualizado con éxito\": el sistema solo persiste cuando encuentra el contenido del documento seguido de ---FIN_SPEC---.";
        }
        if (at === "brd") {
          s +=
            "\n\n**OBLIGATORIO - BRD (formato exacto obligatorio):**\n\n" +
            BRD_CHAT_REFINE_BUSINESS_RULES +
            "\n\n**NO preguntes ni pidas confirmaci\u00f3n**. Cuando el usuario pida agregar, modificar o eliminar algo del BRD, **Aplica el cambio inmediatamente** siguiendo este formato:\n\n```\n[BRD completo actualizado con el cambio incorporado, conservando TODO el contenido existente]\n---FIN_BRD---\n[breve mensaje de chat resumiendo lo que cambiaste]\n```\n\nEJEMPLO:\n```\n# BRD — [Nombre del producto]\n\n## 5. Reglas de Negocio, Políticas y Fórmulas\n### Criterios de aceptación de negocio (UAT)\n- Dado un usuario sin permiso de aprobación, cuando intente confirmar una operación restringida, entonces el sistema bloquea hasta autorización del rol superior.\n---FIN_BRD---\nAñadido criterio UAT de autorización por rol.\n```\n\n**IMPORTANTE:** Sin ``---FIN_BRD---`` no se persiste NADA. El contenido del BRD va ANTES del delimitador. El mensaje de chat va DESPU\u00c9S.";
        }
        if (at === "blueprint") {
          s +=
            "\n\n**OBLIGATORIO - Blueprint:** Cuando el usuario pida **agregar, modificar o eliminar** algo del Blueprint, **debes** devolver el **Blueprint completo actualizado** (conservando TODO el contenido existente) terminando con `---FIN_BLUEPRINT---`. Si solo envías una sección, el sistema la **fusiona** automáticamente con el contenido actual. Nunca respondas solo con un mensaje tipo \"El Blueprint ha sido actualizado\" — el sistema solo persiste cuando encuentra el contenido del documento seguido de `---FIN_BLUEPRINT---`.";
        }
        if (at === "ux-ui-guide") {
          s +=
            "\n\n**OBLIGATORIO - Guía UX/UI:** Cuando el usuario pida **agregar, modificar o regenerar** la Guía UX/UI, **debes** devolver la **Guía UX/UI completa actualizada** (conservando TODO el contenido existente) terminando con `---FIN_UX_UI---`. Si solo envías un fragmento sin el documento completo, el sistema ignora el cambio y el usuario no ve nada. **Siempre incluye la guía COMPLETA antes del delimitador.**";
        }
        s += `\n\n${DOCUMENT_CHANGELOG_CHAT_INSTRUCTION}`;
      }
    }
    if (!options?.welcomeBrief) {
      if (options?.currentDbgaContent?.trim()) {
        if (isBenchmarkRefine) {
          s +=
            "\n\n[Contenido actual del Benchmark & Gap Analysis del proyecto (a refinar según la petición del usuario)]\n---\n" +
            options.currentDbgaContent.trim() +
            "\n---";
        } else if (!options?.currentMddContent?.trim()) {
          s +=
            "\n\n[Contexto base: Domain Benchmark & Gap Analysis del usuario. Úsalo como referencia para guiar la entrevista y redactar el MDD.]\n---\n" +
            options.currentDbgaContent.trim() +
            "\n---";
        }
      }
      if (options?.activeTab?.trim() === "mdd" && options?.currentMddContent?.trim()) {
        s +=
          "\n\n[Contenido actual del MDD del proyecto (puede incluir ediciones del usuario)]\n---\n" +
          options.currentMddContent.trim() +
          "\n---";
      }
      if (isUxUiGuide && options?.currentBlueprintContent?.trim()) {
        s +=
          "\n\n[Blueprint del proyecto: estructura, pantallas y módulos. Úsalo para alinear la Guía UX/UI con las pantallas y flujos descritos.]\n---\n" +
          options.currentBlueprintContent.trim() +
          "\n---";
      }
      if (isUxUiGuide && options?.currentMddContent?.trim()) {
        s +=
          "\n\n[Resumen MDD para inferencia de Design System — producto, dominio, stack UI, entidades y flujos UX. No sustituye Blueprint ni Spec.]\n---\n" +
          options.currentMddContent.trim() +
          "\n---";
      }
      if (options?.currentUxUiGuideContent?.trim()) {
        s +=
          "\n\n[Contenido actual de la Guía UX/UI del proyecto (puede incluir ediciones del usuario)]\n---\n" +
          options.currentUxUiGuideContent.trim() +
          "\n---";
      }
      if (options?.activeTab?.trim() === "spec" && options?.currentSpecContent?.trim()) {
        s +=
          "\n\n[Contenido actual del Spec del proyecto. Al integrar o actualizar, incluye todo esto más la nueva sección o cambios, y termina con ---FIN_SPEC---.]\n---\n" +
          options.currentSpecContent.trim() +
          "\n---";
      }
      if (options?.activeTab?.trim() === "brd" && options?.currentBrdContent?.trim()) {
        s +=
          "\n\n[BRD actual de la etapa del Workshop. Al actualizar, conserva lo acordado y fusiona cambios; termina con ---FIN_BRD---.]\n---\n" +
          options.currentBrdContent.trim() +
          "\n---";
      }
      if (options?.learningHistory?.trim()) {
        s +=
          "\n\n**HISTORIAL_DE_APRENDIZAJE (proyectos previos del usuario):**\n---\n" +
          options.learningHistory.trim() +
          "\n---";
      }
      if (options?.complexityInterviewContext?.trim()) {
        s +=
          "\n\n**[Política de complejidad / entrevista Fase 0 — aplicar en esta conversación]**\n" +
          options.complexityInterviewContext.trim();
      }
    }
  return s;
}

function appendStreamWorkshopInstructions(
  systemPrompt: string,
  options: GenerateResponseOptions | undefined,
): string {
  const isUxUiGuide = options?.activeTab?.trim() === "ux-ui-guide";
  const isBenchmarkRefine =
    options?.activeTab?.trim() === "benchmark" && (options?.currentDbgaContent?.trim() ?? "").length > 0;
  let s = systemPrompt;
  if (options?.activeTab?.trim()) {
    const at = options.activeTab.trim();
    const label = WORKSHOP_ACTIVE_TAB_LABELS[at] ?? at;
    const intent = options?.intent ?? "mixed";
  
    // TagMap para delimitadores
    const tagMap: Record<string, string> = {
      mdd: "MDD",
      benchmark: "DBGA",
      spec: "SPEC",
      brd: "BRD",
      architecture: "ARCH",
      "use-cases": "USECASES",
      "user-stories": "STORIES",
      blueprint: "BLUEPRINT",
      "api-contracts": "API",
      "logic-flows": "FLOWS",
      tasks: "TASKS",
      infra: "INFRA",
      phase0: "PHASE0",
      "ux-ui-guide": "UX_UI",
    };
    const tag = tagMap[at];
  
    s += `\n\n[Contexto de documento activo:] El usuario está trabajando en: **${label}**. Adapta tu respuesta a ese documento (preguntas, sugerencias o ediciones relevantes para ese contexto).\n`;

    const frozenBlock = frozenTabSystemPromptBlock(at);
    if (frozenBlock) {
      s += `\n\n${frozenBlock}`;
    } else if (intent === "explore") {
      s +=
        `\n**ATENCIÓN — MODO EXPLORACIÓN:** El usuario está **preguntando o explorando ideas** sobre el documento. ` +
        `NO hagas cambios al documento. Responde de forma conversacional, explica conceptos, discute alternativas. ` +
        `Si el usuario te pide explícitamente hacer un cambio (ej. "agrega esto", "actualiza", "haz el cambio"), ` +
        `entonces sí debes devolver el documento actualizado con el delimitador ---FIN_${tag ?? "DOC"}---. ` +
        `Pero mientras el usuario solo pregunte o explore, responde sin modificar el documento.`;
      if (at === "benchmark") {
        s += `\n\n${WORKSHOP_DBGA_APPROVAL_BEFORE_EDIT_INSTRUCTION}`;
      }
    } else if (!frozenBlock) {
      s +=
        `\n**INSTRUCCIÓN — DETECCIÓN DE CAMBIOS:** Si el usuario da una **instrucción directa** ` +
        `(ej. "agrega", "cambia", "modifica", "actualiza", "corrige", "elimina") es una solicitud de modificación. ` +
        `**Pero si el usuario está preguntando, explorando opciones o discutiendo alternativas** ` +
        `(ej. "qué tal si...", "cómo sería...", "sería mejor...", "se podría..."), ` +
        `**NO** hagas cambios — responde de forma conversacional. ` +
        `Solo aplica cambios cuando el usuario confirme explícitamente ` +
        `(ej. "sí", "dale", "aplica", "hazlo", "integra eso", "haz los cambios"). ` +
        `Cuando apliques cambios, DEBES devolver el documento actualizado con su delimitador ---FIN_TAG--- inmediatamente. ` +
        `**Prohibido** afirmar en el chat que ya ajustaste o eliminaste algo del documento si no incluyes el markdown completo antes de \`---FIN_TAG---\`.`;
      if (at === "benchmark") {
        s += `\n\n${WORKSHOP_DBGA_APPROVAL_BEFORE_EDIT_INSTRUCTION}`;
      }
    }
  
    if (tag && !options?.welcomeBrief && !frozenBlock) {
      s += `\n\n**Instrucción DE delimitador (OBLIGATORIO):** Cuando generes o actualices el documento de ${label} (completo o solo una sección), DEBES escribir el contenido y TERMINAR con la línea exacta \`---FIN_${tag}---\`. Lo que vaya después se mostrará como mensaje en el chat. Sin ese delimitador, el sistema NO persiste ningún cambio y el usuario no ve nada en el panel del documento.`;
      if (at === "benchmark") {
        s +=
          "\n\n**OBLIGATORIO — Benchmark (DBGA):** Devuelve el **DBGA COMPLETO** (contexto actual + cambios), no solo el fragmento nuevo. Termina con `---FIN_DBGA---`. Sin delimitador no se persiste nada en el panel. **Prohibido** afirmar en chat que integraste o actualizaste el documento si no incluyes el markdown completo antes de `---FIN_DBGA---`.";
      }
      if (at === "mdd") {
          s +=
            "\n\n**\u26a0\ufe0f REGLA ABSOLUTA \u2014 MDD:\n1. **No eval\u00faes si un cambio es \"ya est\u00e1 cubierto\" o \"impacto m\u00ednimo\".** Si el usuario expresa un requisito expl\u00edcito (\"necesitamos X\", \"queremos Y\", \"usa Z\", \"agrega\", \"cambia\", \"modifica\", \"actualiza\", \"corrige\", \"elimina\"), es una orden, no una sugerencia. **El requerimiento del usuario siempre tiene prioridad sobre tu inferencia.**\n2. **NO respondas \"El MDD actual ya especifica...\" y te saltes el cambio.** Si el usuario pide algo, actualiza el documento para reflejarlo expl\u00edcitamente.\n3. Cada vez que el usuario pida agregar, cambiar, modificar, actualizar, corregir o eliminar algo del MDD, o cuando despu\u00e9s de preguntar confirme (\"s\u00ed\", \"dale\", \"aplica\", \"correcto\"), **DEBES** devolver el **MDD COMPLETO ACTUALIZADO** (conservando TODO el contenido existente m\u00e1s los cambios) terminando con `---FIN_MDD---`.\n4. **NUNCA** respondas solo con un mensaje como \"MDD actualizado\" o \"Hecho\" \u2014 si lo haces, el sistema NO persiste ning\u00fan cambio y el usuario cree que se aplic\u00f3 cuando no es as\u00ed. Siempre incluye un mensaje breve resumiendo el cambio DESPU\u00c9S de `---FIN_MDD---`.";
        }
      if (at === "spec") {
        s +=
          "\n\n**Cuando el usuario confirme que integre o aplique cambios al Spec** (ej. \"sí ingrésalo\", \"integralo\", \"aplica\", \"confirma\", \"actualiza el spec\"), **debes** devolver el **documento Spec completo** actualizado (incluyendo lo que ya existía más la nueva sección o cambios), terminando con \`---FIN_SPEC---\`. Nunca respondas solo con un mensaje tipo \"El documento Spec ha sido actualizado con éxito\": el sistema solo persiste cuando encuentra el contenido del documento seguido de ---FIN_SPEC---.";
      }
      if (at === "brd") {
        s +=
          "\n\n**OBLIGATORIO - BRD (formato exacto obligatorio):**\n\n" +
          BRD_CHAT_REFINE_BUSINESS_RULES +
          "\n\n**NO preguntes ni pidas confirmaci\u00f3n**. Cuando el usuario pida agregar, modificar o eliminar algo del BRD, **Aplica el cambio inmediatamente** siguiendo este formato:\n\n```\n[BRD completo actualizado con el cambio incorporado, conservando TODO el contenido existente]\n---FIN_BRD---\n[breve mensaje de chat resumiendo lo que cambiaste]\n```\n\n**IMPORTANTE:** Sin ``---FIN_BRD---`` no se persiste NADA. El contenido del BRD va ANTES del delimitador. El mensaje de chat va DESPU\u00c9S.";
      }
        if (at === "blueprint") {
          s +=
            "\n\n**OBLIGATORIO - Blueprint:** Cuando el usuario pida **agregar, modificar o eliminar** algo del Blueprint, **debes** devolver el **Blueprint completo actualizado** (conservando TODO el contenido existente) terminando con `---FIN_BLUEPRINT---`. Si solo envías una sección, el sistema la **fusiona** automáticamente con el contenido actual. Nunca respondas solo con un mensaje tipo \"El Blueprint ha sido actualizado\" — el sistema solo persiste cuando encuentra el contenido del documento seguido de `---FIN_BLUEPRINT---`.";
        }
      if (at === "ux-ui-guide") {
        s +=
          "\n\n**OBLIGATORIO - Guía UX/UI:** Devuelve la **Guía UX/UI completa** terminando con `---FIN_UX_UI---`.";
      }
      if (at === "architecture") {
        s +=
          "\n\n**OBLIGATORIO — Arquitectura:** Cuando el usuario pida **agregar, modificar, corregir o eliminar** algo (p. ej. stack, §6.3 Infraestructura, Kubernetes, Dokploy, Docker Compose), **debes** devolver el **documento de Arquitectura completo** actualizado (conservando TODO el contenido existente más los cambios) terminando con `---FIN_ARCH---`. Nunca respondas solo afirmando que ya ajustaste secciones: sin markdown + `---FIN_ARCH---` el panel no cambia.";
      }
      if (at === "infra") {
        s +=
          "\n\n**OBLIGATORIO — Infraestructura:** Devuelve el documento **Infra completo** actualizado terminando con `---FIN_INFRA---`. Sin delimitador no se persiste.";
      }
      if (at === "use-cases" || at === "user-stories" || at === "api-contracts" || at === "logic-flows" || at === "tasks") {
        s +=
          `\n\n**OBLIGATORIO — ${label}:** Devuelve el documento **completo** actualizado terminando con \`---FIN_${tag}---\`. Nunca afirmes cambios en el chat sin incluir el markdown antes del delimitador.`;
      }
      s += `\n\n${DOCUMENT_CHANGELOG_CHAT_INSTRUCTION}`;
      }
  }
  if (!options?.welcomeBrief) {
    if (options?.currentDbgaContent?.trim()) {
      if (isBenchmarkRefine) {
        s +=
          "\n\n[Contenido actual del Benchmark & Gap Analysis del proyecto (a refinar según la petición del usuario)]\n---\n" +
          options.currentDbgaContent.trim() +
          "\n---";
      } else if (!options?.currentMddContent?.trim()) {
        s +=
          "\n\n[Contexto base: Domain Benchmark & Gap Analysis del usuario. Úsalo como referencia para guiar la entrevista y redactar el MDD.]\n---\n" +
          options.currentDbgaContent.trim() +
          "\n---";
      }
    }
    if (options?.activeTab?.trim() === "mdd" && options?.currentMddContent?.trim()) {
      s +=
        "\n\n[Contenido actual del MDD del proyecto (puede incluir ediciones del usuario)]\n---\n" +
        options.currentMddContent.trim() +
        "\n---";
    }
    if (isUxUiGuide && options?.currentBlueprintContent?.trim()) {
      s +=
        "\n\n[Blueprint del proyecto: estructura, pantallas y módulos. Úsalo para alinear la Guía UX/UI con las pantallas y flujos descritos.]\n---\n" +
        options.currentBlueprintContent.trim() +
        "\n---";
    }
    if (isUxUiGuide && options?.currentMddContent?.trim()) {
      s +=
        "\n\n[Resumen MDD para inferencia de Design System — producto, dominio, stack UI, entidades y flujos UX. No sustituye Blueprint ni Spec.]\n---\n" +
        options.currentMddContent.trim() +
        "\n---";
    }
    if (options?.currentUxUiGuideContent?.trim()) {
      s +=
        "\n\n[Contenido actual de la Guía UX/UI del proyecto (puede incluir ediciones del usuario)]\n---\n" +
        options.currentUxUiGuideContent.trim() +
        "\n---";
    }
    if (options?.activeTab?.trim() === "spec" && options?.currentSpecContent?.trim()) {
      s +=
        "\n\n[Contenido actual del Spec del proyecto. Al integrar o actualizar, incluye todo esto más la nueva sección o cambios, y termina con ---FIN_SPEC---.]\n---\n" +
        options.currentSpecContent.trim() +
        "\n---";
    }
    if (options?.activeTab?.trim() === "brd" && options?.currentBrdContent?.trim()) {
      s +=
        "\n\n[BRD actual de la etapa del Workshop. Al actualizar, conserva lo acordado y fusiona cambios; termina con ---FIN_BRD---.]\n---\n" +
        options.currentBrdContent.trim() +
        "\n---";
    }
    if (options?.activeTab?.trim() === "architecture" && (options as any).currentArchitectureContent?.trim()) {
      s +=
        "\n\n[Contenido actual del documento Architecture del proyecto. Al actualizar, incluye el contenido completo más los cambios; termina con ---FIN_ARCH---.]\n---\n" +
        (options as any).currentArchitectureContent.trim() +
        "\n---";
    }
    if (options?.activeTab?.trim() === "use-cases" && (options as any).currentUseCasesContent?.trim()) {
      s +=
        "\n\n[Contenido actual de Use Cases del proyecto. Al actualizar, incluye el contenido completo más los cambios; termina con ---FIN_USECASES---.]\n---\n" +
        (options as any).currentUseCasesContent.trim() +
        "\n---";
    }
    if (options?.activeTab?.trim() === "user-stories" && (options as any).currentUserStoriesContent?.trim()) {
      s +=
        "\n\n[Contenido actual de User Stories del proyecto. Al actualizar, incluye el contenido completo más los cambios; termina con ---FIN_STORIES---.]\n---\n" +
        (options as any).currentUserStoriesContent.trim() +
        "\n---";
    }
    if (options?.activeTab?.trim() === "blueprint" && options?.currentBlueprintContent?.trim()) {
      s +=
        "\n\n[Contenido actual del Blueprint del proyecto. Al actualizar, incluye todo esto más los cambios; termina con ---FIN_BLUEPRINT---.]\n---\n" +
        options.currentBlueprintContent.trim() +
        "\n---";
    }
    if (options?.activeTab?.trim() === "api-contracts" && (options as any).currentApiContractsContent?.trim()) {
      s +=
        "\n\n[Contenido actual de API Contracts del proyecto. Al actualizar, incluye el contenido completo más los cambios; termina con ---FIN_API---.]\n---\n" +
        (options as any).currentApiContractsContent.trim() +
        "\n---";
    }
    if (options?.activeTab?.trim() === "logic-flows" && (options as any).currentLogicFlowsContent?.trim()) {
      s +=
        "\n\n[Contenido actual de Logic Flows del proyecto. Al actualizar, incluye el contenido completo más los cambios; termina con ---FIN_FLOWS---.]\n---\n" +
        (options as any).currentLogicFlowsContent.trim() +
        "\n---";
    }
    if (options?.activeTab?.trim() === "tasks" && (options as any).currentTasksContent?.trim()) {
      s +=
        "\n\n[Contenido actual de Tasks del proyecto. Al actualizar, incluye el contenido completo más los cambios; termina con ---FIN_TASKS---.]\n---\n" +
        (options as any).currentTasksContent.trim() +
        "\n---";
    }
    if (options?.activeTab?.trim() === "infra" && (options as any).currentInfraContent?.trim()) {
      s +=
        "\n\n[Contenido actual de Infraestructura del proyecto. Al actualizar, incluye el contenido completo más los cambios; termina con ---FIN_INFRA---.]\n---\n" +
        (options as any).currentInfraContent.trim() +
        "\n---";
    }
    if (options?.learningHistory?.trim()) {
      s +=
        "\n\n**HISTORIAL_DE_APRENDIZAJE (proyectos previos del usuario):**\n---\n" +
        options.learningHistory.trim() +
        "\n---";
    }
    if (options?.complexityInterviewContext?.trim()) {
      s +=
        "\n\n**[Política de complejidad / entrevista Fase 0 — aplicar en esta conversación]**\n" +
        options.complexityInterviewContext.trim();
    }
  }
  return s;
}

export function buildWorkshopSystemPrompt(
  options: GenerateResponseOptions | undefined,
  ctx: BuildWorkshopSystemPromptContext,
): string {
  const { variant, history, userPrompt, phase0TechDocs } = ctx;
  let systemPrompt = resolveBaseSystemPrompt(options);
  systemPrompt =
    variant === "sync"
      ? appendSyncWorkshopInstructions(systemPrompt, options)
      : appendStreamWorkshopInstructions(systemPrompt, options);
  systemPrompt = appendUxGuideStitchPolicy(systemPrompt, options);
  systemPrompt = appendTechDocsToSystemPrompt(systemPrompt, phase0TechDocs, {
    citeSource: isExplicitContext7ChatRequest(userPrompt),
  });
  if (
    (options?.userMessageImages?.length ?? 0) > 0 ||
    history.some((h) => h.role === "user" && (h.images?.length ?? 0) > 0)
  ) {
    systemPrompt +=
      "\n\n**Entrada multimodal:** Puede haber imágenes en el historial o en este mensaje. Interprétalas en el contexto del documento activo y la conversación (modelo de datos, UI, flujos); no inventes detalles no visibles.";
    if (
      options?.activeTab?.trim() === "mdd" &&
      (options?.currentMddContent?.trim().length ?? 0) > 400
    ) {
      systemPrompt +=
        "\n\n**MDD no destructivo (obligatorio si ya hay MDD en contexto):** El bloque \"Contenido actual del MDD\" incluye **todas** las secciones. Si el usuario pide revisar, alinear o ampliar (p. ej. tras un diagrama), **no sustituyas el proyecto por un solo fragmento**: devuelve el **MDD completo** actualizado (copia el contenido existente y aplica cambios), terminando con `---FIN_MDD---`. Si optas por enviar **solo una sección**, debe empezar por el **mismo patrón de encabezado** que ya usa el documento para esa sección (`## N.` recomendado, mismo `N` que corresponda). Nunca envíes solo tablas o JSON sueltos sin el título de sección reconocible.";
    }
  }
  const stackSources = collectUserStackSources(
    userPrompt,
    options?.currentMddContent,
    options?.currentDbgaContent,
  );
  const stackBlock = buildUserDeclaredStackPromptBlock(
    userPrompt,
    options?.currentMddContent,
    options?.currentDbgaContent,
  );
  if (stackBlock) {
    systemPrompt += `\n\n${stackBlock}`;
  }
  if (options?.learningHistory?.trim() && hasUserDeclaredStack(stackSources)) {
    systemPrompt += learningHistoryStackGuardBlock();
  }
  return systemPrompt;
}
