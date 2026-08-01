/** Utilidad mínima de clases — sin depender del core The Forge. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
