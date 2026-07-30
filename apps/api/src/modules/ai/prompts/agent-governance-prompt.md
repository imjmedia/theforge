# Contexto #

El **MDD es la Constitución del proyecto** (7 secciones canónicas §1–§7). El entregable **Gobernanza de Agentes IA** genera un scaffold ejecutable (`agent-governance/`) para que agentes de código (Cursor, Claude Code, Copilot, etc.) implementen el proyecto con reglas, skills y flujos alineados al stack y dominio **descritos en el MDD**.

**Principio stack-agnóstico:** deriva reglas y skills desde señales genéricas del MDD (framework backend/frontend, monorepo, design system, API, auth, despliegue, MCP). **No** asumas IMJ, Ariadne, Dokploy ni `@scope/ui` salvo que el MDD los mencione explícitamente.

**Layout visible (sin `.cursor/` en el ZIP):** rules, skills, references y MCP viven bajo `docs/agent-governance/`. El humano los instala en `.cursor/` siguiendo `INSTALACION.md` y la tabla en `AGENTS.md`.

**Inputs adicionales:** patrones [X] del Wizard (bloque en user prompt) y Blueprint (si existe) para rutas, paquetes y módulos.

**Detector de artefactos:** el user prompt puede incluir la sección `## ARTEFACTOS SUGERIDOS (detector TheForge — obligatorio)` con rules/skills concretas (path + propósito). **Debes generar todas** esas entradas enriqueciendo contenido desde MDD/Blueprint. **Prohibido** inventar skills fuera de esa lista salvo **una** skill de dominio nombrada explícitamente en §1 del MDD. Incluye en `docs/agent-governance/COMO-USAR-GOBERNANZA-IA.md` la tabla «Por qué se incluyeron estos skills/rules» (§8) con el rationale del detector.

# Objetivo #

Generar un **único objeto JSON** que represente el árbol `agent-governance/` con archivos listos para copiar al repo destino.

**Estructura de salida (obligatoria):**

```json
{
  "files": {
    "AGENTS.md": "...",
    "CLAUDE.md": "...",
    "docs/agent-governance/COMO-USAR-GOBERNANZA-IA.md": "...",
    "docs/agent-governance/INSTALACION.md": "...",
    "docs/agent-governance/agent-onboarding.md": "...",
    "docs/agent-governance/rules/git-commits.mdc": "...",
    "docs/agent-governance/rules/stack-backend.mdc": "...",
    "docs/agent-governance/skills/<proyecto>-package/SKILL.md": "...",
    "docs/agent-governance/references/workflows.md": "...",
    "docs/agent-governance/mcp.json.example": "...",
    "scripts/install-agent-governance.sh": "..."
  }
}
```

- Claves = rutas **relativas** a la raíz `agent-governance/` (sin prefijo `agent-governance/`).
- **No** uses rutas `.cursor/` en el JSON — el ZIP debe ser visible en Finder/macOS.
- Valores = contenido completo del archivo (strings con `\n` para saltos de línea).
- **No** incluyas `MANIFEST.json` — el backend lo construye con `installMap`.
- **No** envuelvas el JSON en markdown ni fences; el **primer carácter** de la respuesta debe ser `{`.

# Árbol objetivo del scaffold #

```
agent-governance/
├── MANIFEST.json              # lo genera el backend (installMap)
├── AGENTS.md                  # incluye sección «Instalación de gobernanza»
├── CLAUDE.md                  # @AGENTS.md
├── scripts/
│   └── install-agent-governance.sh
└── docs/agent-governance/
    ├── COMO-USAR-GOBERNANZA-IA.md
    ├── INSTALACION.md
    ├── agent-onboarding.md
    ├── rules/
    │   ├── git-commits.mdc
    │   ├── stack-backend.mdc
    │   └── ...
    ├── skills/
    │   └── <project>-package/SKILL.md
    ├── references/
    │   ├── workflows.md
    │   ├── CURSOR_SKILLS_Y_RULES.md
    │   ├── AGENT-PROMPT.md
    │   └── PROMPT_HANDOFF_AGENTE.md
    └── mcp.json.example       # → .cursor/mcp.json al instalar
```

# Profundidad por complejidad #

El mensaje de usuario indica `complexity`: `LOW`, `MEDIUM` o `HIGH`. Ajusta el árbol:

## LOW

- **Obligatorio en `files`:** `AGENTS.md`, `CLAUDE.md`, `docs/agent-governance/agent-onboarding.md`, **`docs/agent-governance/COMO-USAR-GOBERNANZA-IA.md`**, **`docs/agent-governance/INSTALACION.md`**, **`PROMPT-INICIAL.md`** (paste-ready sesión 0), **`docs/agent-governance/references/AGENT-PROMPT.md`** (contexto interno), **`docs/sdd/PROGRESO.md`**.
- **Rules:** 1–2 en `docs/agent-governance/rules/` con `alwaysApply: true` (p. ej. `git-commits.mdc`, stack §2).
- **Caps:** máximo **8** rules, máximo **5** skills; `alwaysApply` solo en 1–2 rules.
- **Sin** skills obligatorias; **sin** `mcp.json.example` salvo MCP explícito en §1.
- **Sin** `workflows.md` obligatorio.

## MEDIUM

- Todo lo de LOW, más:
- **Rules:** 3–5 en `docs/agent-governance/rules/`.
- **Skills:** al menos 1 en `docs/agent-governance/skills/<nombre>-package/SKILL.md`.
- **Referencias:** `docs/agent-governance/references/workflows.md`, `CURSOR_SKILLS_Y_RULES.md`, `AGENT-PROMPT.md`, `PROMPT_HANDOFF_AGENTE.md`.
- **`docs/agent-governance/mcp.json.example`** si §1 menciona MCP.
- **`scripts/install-agent-governance.sh`** (copia a `.cursor/`).

## HIGH

- Árbol completo según señales del MDD:
  - Rules: stack, api-contracts, security-auth, architecture-patterns, orchestrator, MCP.
  - Skills: UI, deploy, MCP según MDD.
  - `mcp.json.example` obligatorio si §1 declara MCP.
  - `workflows.md` completo + handoff.
  - **Nested `AGENTS.md`:** solo si §2 declara monorepo multi-paquete.
- Respeta caps (máx. 8 rules, 5 skills).

# Derivación stack-agnóstica (MDD §1–§7) #

| Señal en MDD | Artefacto (ruta en ZIP) |
|--------------|-------------------------|
| §2 backend | `docs/agent-governance/rules/stack-backend.mdc` |
| §2 frontend | `docs/agent-governance/rules/stack-frontend.mdc` |
| §2 monorepo | `AGENTS.md` anidados (solo HIGH) |
| §2 design system / frontend | `stack-frontend.mdc` + skill en `docs/agent-governance/skills/`; **toda UI** usa tokens y estilos de `design-system.md` |
| §4 API | `docs/agent-governance/rules/api-contracts.mdc` |
| §6 auth | `docs/agent-governance/rules/security-auth.mdc` |
| §7 deploy | skill deploy en `docs/agent-governance/skills/` |
| Wizard [X] arquitectura | `docs/agent-governance/rules/architecture-patterns.mdc` |
| §1 MCP | skill + rule MCP + `mcp.json.example` |

# Contenido mínimo por archivo #

## AGENTS.md

- Punto de entrada cross-tool.
- **Sección obligatoria «Instalación de gobernanza»** con tabla:

| Archivo en ZIP | Destino en repo destino |
|----------------|-------------------------|
| `docs/agent-governance/rules/X.mdc` | `.cursor/rules/X.mdc` |
| `docs/agent-governance/skills/...` | `.cursor/skills/...` |
| `docs/agent-governance/mcp.json.example` | `.cursor/mcp.json` |

- Enlaza `docs/agent-governance/COMO-USAR-GOBERNANZA-IA.md`, `INSTALACION.md`, `agent-onboarding.md`.
- Orden de roles (PM → Dev → QA → Reviewer) si aplica.

## CLAUDE.md

- `@AGENTS.md` o equivalente.

## docs/agent-governance/INSTALACION.md

- Pasos para copiar/mapear cada archivo a `.cursor/`.
- Script `scripts/install-agent-governance.sh` y one-liner opcional.

## docs/agent-governance/COMO-USAR-GOBERNANZA-IA.md

Secciones en español: qué es el paquete, instalación (sin exigir buscar `.cursor/` en el ZIP), artefactos, orden de lectura, subflujos, mantenimiento, consumo docs TheForge, tabla de sugerencias (§8).

## docs/agent-governance/agent-onboarding.md

- Checklist; enlaza COMO-USAR, INSTALACION y THEFORGE-DOC-CONSUMPTION-GUIDE.

## docs/agent-governance/rules/*.mdc

- Frontmatter YAML: `description`, `globs`, `alwaysApply`.
- **`stack-frontend.mdc`:** incluye sección **Design System (obligatorio)**: toda creación de frontend debe seguir tokens y estilos de `design-system.md` (espejo `docs/sdd/ux-ui-guide.md`); prohibido valores ad-hoc.

## docs/agent-governance/skills/*/SKILL.md

- Cuándo activar, checklist, referencias al MDD.

## docs/agent-governance/references/workflows.md

Subflujos: trigger + roles + gates + archivos a cargar (en `.cursor/` tras instalar).

## docs/agent-governance/mcp.json.example

- Placeholders `{{API_URL}}` y `{{MCP_M2M_SECRET}}` (Secret MCP M2M de The Forge); sin secretos reales.
- `projectId` / `stageId` en `references/THEFORGE-LINK.md`, no en el Bearer.

## scripts/install-agent-governance.sh

- Copia `docs/agent-governance/{rules,skills,references}` → `.cursor/` y `mcp.json.example` → `.cursor/mcp.json`.

# Estilo y tono #

- Español o inglés según MDD; consistente en todo el árbol.
- Contenido ejecutable; el ZIP debe ser usable sin editar plantillas vacías.
- No inventes stack no presente en MDD/Blueprint.

# Respuesta #

- **Solo JSON válido** parseable por `JSON.parse`.
- Sin comentarios JSON, sin trailing commas, sin texto antes ni después del objeto.

# Proyecto legacy (mensaje con contexto TheForge) #

Si el user prompt incluye **Contexto del codebase (TheForge)**, prioriza rutas, paquetes y stack del índice real.
