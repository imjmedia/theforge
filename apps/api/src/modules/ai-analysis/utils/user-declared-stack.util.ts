/**
 * @fileoverview Extracción de stack tecnológico declarado por el usuario.
 */

/**
 * Detects and surfaces stack technologies the user explicitly named in idea/chat/MDD.
 * Used to prevent DBGA/Clarifier/Architect from substituting market defaults (e.g. Next.js).
 */

/** Framework/runtime names and stack-related keywords. */
export const STACK_TECHNOLOGY_REGEX =
  /\b(stack|arquitectura|frontend|backend|framework|tecnolog[ií]a|nestjs|nest(?:\.?js)?|react|vue(?:\.?js)?|angular|svelte(?:kit)?|next(?:\.?js)?|nuxt|remix|astro|vite|webpack|flutter|ionic|expo|django|fastapi|flask|laravel|rails|ruby\s+on\s+rails|spring(?:\s+boot)?|dotnet|\.net|node\.?js|postgresql|postgres|mysql|mongodb|redis|docker|kubernetes|kubernets|k8s|dokploy|coolify|despliegue|contenedores?|secci[oó]n\s*2|§2|php|golang|\bgo\b|rust|blazor|solid(?:\.?js)?|tanstack|prisma|typeorm|bullmq|graphql|supabase|firebase)\b/i;

const FRAMEWORK_NAMES_REGEX =
  /\b(next(?:\.?js)?|vue(?:\.?js)?|nuxt|svelte(?:kit)?|angular|react|vite|nest(?:\.?js)?|django|fastapi|laravel|flutter|expo|remix|astro|solid(?:\.?js)?|blazor|spring(?:\s+boot)?|dotnet|\.net|rails|ruby\s+on\s+rails|nuxt|remix)\b/i;

/** User intent to fix a stack (not incidental mention in competitor text). */
export const USER_STACK_DECLARATION_REGEX =
  /\b(?:quiero|usar|usa|usando|prefiero|preferencia|stack\s*(?:ser[aá]|:)|frontend\s*(?:en|con|:)|backend\s*(?:en|con|:)|con\s+(?:next|vue|angular|svelte|django|fastapi|laravel|flutter|nest|react|vite|nuxt|remix|astro)|tecnolog[ií]a\s*(?:ser[aá]|:))\b/i;

/** Min length for explicit-requirements when stack keywords are present. */
export const STACK_EXPLICIT_REQUIREMENTS_MIN_LENGTH = 20;

export function mentionsStackTechnology(text: string): boolean {
  const t = text?.trim() ?? "";
  return t.length > 0 && STACK_TECHNOLOGY_REGEX.test(t);
}

/** True when the user (not DBGA competitors) appears to have chosen a stack/framework. */
export function hasUserDeclaredStack(text: string): boolean {
  const t = text?.trim() ?? "";
  if (!t || !FRAMEWORK_NAMES_REGEX.test(t)) return false;
  if (USER_STACK_DECLARATION_REGEX.test(t)) return true;
  return /\b(stack|frontend|backend|framework|tecnolog[ií]a|bundler|runtime)\b/i.test(t);
}

export function collectUserStackSources(...sources: (string | null | undefined)[]): string {
  return sources
    .map((s) => s?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/** Prompt block injected into MDD/DBGA agents when the user named a stack. */
export function buildUserDeclaredStackPromptBlock(...sources: (string | null | undefined)[]): string {
  const combined = collectUserStackSources(...sources);
  if (!hasUserDeclaredStack(combined)) return "";
  const excerpt = combined.slice(0, 2000);
  return (
    "**STACK DECLARADO POR EL USUARIO (prioridad inviolable):** El usuario ya indicó tecnologías concretas en su idea o mensajes. " +
    "Refleja esas tecnologías literalmente en §1, clarifiedScope y §2. **PROHIBIDO** sustituirlas por Next.js, NestJS u otro stack «de mercado», del benchmark o del HISTORIAL salvo petición explícita del usuario. " +
    "Insights de competidores = referencia comparativa, no mandato de implementación.\n\n" +
    excerpt
  );
}

/** Appended after HISTORIAL_DE_APRENDIZAJE when current turn fixes stack. */
export function learningHistoryStackGuardBlock(): string {
  return (
    "\n\n**IMPORTANTE — Stack en este proyecto:** El mensaje o documento actual ya fija tecnologías concretas. " +
    "El HISTORIAL_DE_APRENDIZAJE **no** puede cambiar frontend, backend ni framework (p. ej. no sustituir Vue/Svelte por Next.js). " +
    "Úsalo solo para rigor, auth, infra o patrones compatibles con el stack declarado."
  );
}

/** Effective min length for getUserExplicitRequirements when stack is mentioned. */
export function minLengthForExplicitRequirements(text: string): number {
  return mentionsStackTechnology(text) ? STACK_EXPLICIT_REQUIREMENTS_MIN_LENGTH : 50;
}
