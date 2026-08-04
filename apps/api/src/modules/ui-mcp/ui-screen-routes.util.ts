/**
 * Helpers para roles/journeys y rutas de pantalla en entregables UI.
 */

/** Extrae roles/actores mencionados en §1 del MDD (heurístico). */
export function extractRolesFromMdd(markdown: string): string[] {
  const text = (markdown ?? "").trim();
  if (!text) return [];

  const section1Match = text.match(/^##\s*1\.[^\n]*\n([\s\S]*?)(?=^##\s*[2-9]\.|$)/im);
  const section1 = section1Match?.[1] ?? text.slice(0, 4000);

  const roles = new Set<string>();
  const linePatterns = [
    /(?:rol|role|actor|perfil|usuario tipo|tipo de usuario)[:\s]+([^\n,;]+)/gi,
    /\*\*(?:Como|Rol|Actor):\*\*\s*([^\n]+)/gi,
  ];
  for (const re of linePatterns) {
    for (const m of section1.matchAll(re)) {
      const raw = (m[1] ?? "").trim();
      if (raw.length >= 3 && raw.length <= 48) roles.add(normalizeRoleLabel(raw));
    }
  }

  const known = [
    "inversor",
    "superadmin",
    "super admin",
    "admin",
    "tenant",
    "broker",
    "planner",
    "operador",
    "público",
    "publico",
    "guest",
    "anónimo",
  ];
  const lower = section1.toLowerCase();
  for (const k of known) {
    if (lower.includes(k)) roles.add(normalizeRoleLabel(k));
  }

  if (roles.size === 0) roles.add("Usuario autenticado");
  return [...roles];
}

export function normalizeRoleLabel(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^usuario\s+/i, "")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function slugifyRouteSegment(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Infiere ruta React Router desde nombre de pantalla / hint. */
export function inferScreenRoute(screenName: string, uiHint?: string): string {
  const name = screenName.toLowerCase();
  if (/login|sign[\s-]?in|iniciar sesi[oó]n|inicio de sesi[oó]n/.test(name)) return "/login";
  if (/dashboard|panel(?!\s+admin)|^home$/.test(name)) return "/dashboard";
  if (/registro|sign[\s-]?up|register/.test(name)) return "/register";
  if (/otp|verificaci[oó]n|2fa|mfa/.test(name)) return "/otp-verify";
  if (/configuraci[oó]n|settings/.test(name)) return "/settings";
  const slug = slugifyRouteSegment(screenName);
  if (uiHint === "chat") return "/chat";
  if (/^gesti[oó]n de /i.test(screenName)) {
    const entitySlug = slugifyRouteSegment(screenName.replace(/^gesti[oó]n de /i, ""));
    return entitySlug ? `/admin/${entitySlug}` : "/";
  }
  return slug ? `/${slug}` : "/";
}

/**
 * Convierte un identificador (snake_case, kebab-case, SCREAMING_SNAKE, con espacios
 * o con acentos) a PascalCase limpio: `app_packages` → `AppPackages`,
 * `app-packages` → `AppPackages`, `app packages` → `AppPackages`,
 * `APP_PACKAGES` → `AppPackages`, `gestión` → `Gestion`, `inicio de sesión` →
 * `InicioDeSesion`. Normaliza acentos primero (NFD + strip combining marks) para
 * que `ó` se considere `[a-zA-Z]` y no rompa la palabra. Usado por
 * `inferPageComponentName` para producir nombres de componente React limpios
 * sin restos de guiones bajos ni acentos sueltos como "ó" o "NDe".
 * CHANGELOG [Unreleased] → Fixed → "Pantallas: PascalCase limpio en
 * inferPageComponentName (incluye normalización de acentos)".
 */
function toPascalCase(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

export function inferPageComponentName(screenName: string): string {
  const cleaned = screenName.replace(/[^\w\sáéíóúñÁÉÍÓÚÑ-]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "ScreenPage";
  // Slugifica cada palabra por separado para que `app_packages` se vuelva
  // `AppPackages` (no `App_packages`). Antes concatenaba con `.charAt(0).toUpperCase()
  // + .slice(1)` que preservaba guiones bajos si la palabra los tenía.
  const pascal = words.map(toPascalCase).join("");
  return pascal ? `${pascal}Page` : "ScreenPage";
}

/** Estados UI sugeridos según tipo de pantalla. */
export function inferUiStates(screenName: string, uiHint?: string): string {
  const name = screenName.toLowerCase();
  if (/login|otp|mfa|auth/.test(name)) return "loading, error, locked, success";
  if (/dashboard|panel/.test(name) || uiHint === "dashboard") return "loading, empty, error";
  if (/form|crear|editar|alta|wizard/.test(name) || uiHint === "form" || uiHint === "wizard") {
    return "loading, error, success, disabled";
  }
  if (/listado|tabla|catálogo|catalogo/.test(name) || uiHint === "table") {
    return "loading, empty, error";
  }
  return "loading, empty, error";
}

/** ¿Entidad/pantalla debe evitar Kanban? */
export function shouldAvoidKanban(entityName: string, combinedText = ""): boolean {
  const t = `${entityName} ${combinedText}`.toLowerCase();
  return (
    /audit|log|session|otp|token|outbox|event|security|imperson/i.test(t) ||
    /sesi[oó]n|auditor[ií]a|consumo de tokens/i.test(t)
  );
}
