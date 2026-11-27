/**
 * BRD decision log closure: «Por validar», placeholders fiscales/latencia/tokens.
 */

export type BrdDecisionLogFinding = {
  kind: "open_por_validar" | "empty_decision_log" | "unresolved_placeholder" | "orphan_por_validar";
  ref: string;
  detail?: string;
};

const DECISION_LOG_HEADING_RE =
  /^##+\s*(?:pendientes de validaci[oó]n|decision log|registro de decisiones)/im;

const POR_VALIDAR_LABEL = "Por validar suelto";

const PLACEHOLDER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\$\s*N\s*\$/gi, label: "latencia $N$" },
  { re: /\bpor\s+validar\b/gi, label: POR_VALIDAR_LABEL },
  { re: /impuesto\s+fiscal\s*%\s*sin\s+dato/gi, label: "fiscal % sin cerrar" },
  { re: /(?:tokens?|plan)\s*(?:\/|\s+)(?:tokens?|plan)\s*(?:sin\s+dato|tbd|por\s+definir|pendiente)/gi, label: "tokens/plan sin cerrar" },
  { re: /%\s*(?:fiscal|impuesto)\s*(?:tbd|por\s+validar|\?\?)/gi, label: "porcentaje fiscal abierto" },
];

/**
 * Cuenta las ocurrencias de «Por validar» y nombra hasta 3 ubicaciones distintas:
 * el heading `##`/`###` más cercano por encima o, si no hay, el número de línea.
 */
function locatePorValidar(text: string): { count: number; locations: string[]; more: boolean } {
  const lines = text.split("\n");
  const re = /\bpor\s+validar\b/gi;
  let count = 0;
  const all: string[] = [];
  let heading: string | null = null;
  lines.forEach((line, i) => {
    const h = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) heading = h[2].trim();
    const n = (line.match(re) ?? []).length;
    if (n === 0) return;
    count += n;
    const loc = heading ? `§${heading}` : `línea ${i + 1}`;
    if (!all.includes(loc)) all.push(loc);
  });
  return { count, locations: all.slice(0, 3), more: all.length > 3 };
}

function extractDecisionLogSection(brdMarkdown: string): string | null {
  const text = (brdMarkdown ?? "").trim();
  if (!text) return null;
  const start = text.search(DECISION_LOG_HEADING_RE);
  if (start < 0) return null;
  const rest = text.slice(start);
  const next = rest.slice(1).search(/^##\s+\d/im);
  return next >= 0 ? rest.slice(0, next + 1) : rest;
}

function parseDecisionLogOpenRows(section: string): string[] {
  const open: string[] = [];
  for (const line of section.split("\n")) {
    if (!line.includes("|") || /^\|\s*[-:]+\s*\|/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const tema = cells[0] ?? "";
    const estado = (cells[1] ?? "").toLowerCase();
    if (/por\s+validar|pendiente|tbd|abierto|open/i.test(estado)) {
      open.push(tema || estado);
    }
  }
  return open;
}

/** Gate de cierre del decision log BRD antes de cascada / MDD SSOT. */
export function checkBrdDecisionLogClosure(brdMarkdown: string): {
  blockers: string[];
  warnings: string[];
  findings: BrdDecisionLogFinding[];
} {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const findings: BrdDecisionLogFinding[] = [];
  const text = (brdMarkdown ?? "").trim();
  if (text.length < 80) return { blockers, warnings, findings };

  const decisionSection = extractDecisionLogSection(text);
  if (!decisionSection) {
    const porValidar = locatePorValidar(text);
    for (const { re, label } of PLACEHOLDER_PATTERNS) {
      // Con /g, test() arrastra lastIndex entre llamadas: se resetea siempre.
      re.lastIndex = 0;
      // «Por validar suelto» lo cubre el aviso huérfano (un solo aviso por hecho).
      if (porValidar.count > 0 && label === POR_VALIDAR_LABEL) continue;
      if (re.test(text)) {
        findings.push({ kind: "unresolved_placeholder", ref: label });
        warnings.push(`BRD: placeholder sin decision log — ${label}`);
      }
    }
    if (porValidar.count > 0) {
      findings.push({
        kind: "orphan_por_validar",
        ref: "Por validar",
        detail: "Sin sección «Pendientes de validación»",
      });
      const where = porValidar.locations.length
        ? ` (en ${porValidar.locations.join(", ")}${porValidar.more ? ", …" : ""})`
        : "";
      warnings.push(`BRD: ${porValidar.count} «Por validar» sin sección «Pendientes de validación»${where}`);
    }
    return { blockers, warnings, findings };
  }

  const tableBody = decisionSection.replace(/^##.+$/m, "").trim();
  if (tableBody.length < 40 || !/\|/.test(tableBody)) {
    findings.push({ kind: "empty_decision_log", ref: "decision log", detail: "Tabla vacía o ausente" });
    if (/\bpor\s+validar\b/i.test(text)) {
      blockers.push("BRD decision log vacío pero el documento contiene «Por validar» — completar filas (tema, dueño, impacto, plazo).");
    }
  }

  const openRows = parseDecisionLogOpenRows(decisionSection);
  for (const tema of openRows) {
    findings.push({ kind: "open_por_validar", ref: tema });
  }
  if (openRows.length > 5) {
    blockers.push(
      `BRD decision log: ${openRows.length} ítems «Por validar» (máx. 5) — cerrar o mover a Supuestos con dato explícito.`,
    );
  } else if (openRows.length > 0) {
    warnings.push(
      `BRD decision log: ${openRows.length} ítem(s) abiertos — ${openRows.slice(0, 5).join("; ")}`,
    );
  }

  const outsideLog = text.replace(decisionSection, "");
  for (const { re, label } of PLACEHOLDER_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(outsideLog)) {
      findings.push({ kind: "unresolved_placeholder", ref: label });
      if (/latencia|fiscal|tokens/i.test(label)) {
        blockers.push(`BRD: ${label} sin fila en decision log ni supuesto numerado.`);
      } else {
        warnings.push(`BRD: ${label} fuera del decision log.`);
      }
    }
  }

  return { blockers, warnings, findings };
}
