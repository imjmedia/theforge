# AI / Utils

Utilidades compartidas del módulo AI: gobernanza de agentes, extracción BRD, validación Mermaid, adjuntos de chat.

- **`agent-governance.util.ts`** — orquestador del scaffold de gobernanza IA (parse, reconcile, export multi-target).
- **`agent-governance/`** — plantillas por artefacto (reglas, skills, agents) + README.
- **`brd-extract.util.ts`** — extracción de contenido BRD desde documentos.
- **`chat-image-attachments.util.ts`** — procesamiento de imágenes adjuntas en chat (multimodal).
- **`dbga-prompt-context.util.ts`** — construcción de contexto para prompts DBGA.
- **`legacy-as-is-logic-flows-ariadne.util.ts`** — mapeo determinista AS-IS de `business_logic` Ariadne / MDD §5 a Flujos de lógica mínimos válidos (sin depender solo del LLM; evita stubs changelog vacío en etapa 1 legacy).