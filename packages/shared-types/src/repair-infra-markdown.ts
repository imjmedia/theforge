/**
 * Reparaciones para documentos de Infra (Dockerfile, compose, .env) mal formateados por LLM.
 */

// Sensible a mayúsculas a propósito: la prosa en español ("Healthcheck de Docker…", "Copy…", "User…")
// no debe confundirse con instrucciones de Dockerfile ni abrir un fence ```dockerfile sin cierre.
const DOCKER_INSTR =
  /^(FROM|WORKDIR|RUN|COPY|CMD|EXPOSE|USER|ENV|ARG|ADD|VOLUME|ENTRYPOINT|STOPSIGNAL|HEALTHCHECK|SHELL|ONBUILD|MAINTAINER)(\s|$)/;

function isDockerfileLabelInstruction(trimmed: string): boolean {
  return /^LABEL\s+\S/.test(trimmed);
}

const COMPOSE_SERVICES = new Set([
  "postgres",
  "redis",
  "api",
  "backend",
  "frontend",
  "worker",
  "nginx",
  "frontend-admin",
  "theforge-api",
  "theforge-web",
  "theforge-db",
]);

const COMPOSE_PROPS = new Set([
  "image",
  "build",
  "container_name",
  "environment",
  "volumes",
  "ports",
  "depends_on",
  "networks",
  "healthcheck",
  "restart",
  "command",
  "expose",
  "env_file",
  "depends_on",
  "logging",
  "deploy",
]);

function isDockerfileLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (DOCKER_INSTR.test(trimmed)) return true;
  if (isDockerfileLabelInstruction(trimmed)) return true;
  if (/^#\s*----/.test(trimmed)) return true;
  if (/^#\s*(Copiar|Instalar|Compilar|Generar|Crear|Exponer|Usar|Comando|Construir|Nginx|Copy)/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isInfraProseLine(trimmed: string): boolean {
  if (/^\*\*[^*]+\*\*:?\s*$/.test(trimmed)) return true;
  if (/^Los servicios `/i.test(trimmed)) return true;
  if (/^Se utiliza `depends on`/i.test(trimmed)) return true;
  if (/^La API expone/i.test(trimmed)) return true;
  return false;
}

function isEnvLine(trimmed: string): boolean {
  return /^[A-Z_][A-Z0-9_]*=/.test(trimmed) || /^#\s*[-=]{3,}/.test(trimmed) || /^#\s*[-—]/.test(trimmed);
}

/** `### WORKDIR /app` → `WORKDIR /app` */
export function repairFalseDockerfileHeadings(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const m = line.trim().match(/^###\s+(.+)$/);
      if (!m) return line;
      const inner = m[1]!.trim();
      if (isDockerfileLine(inner)) return inner;
      return line;
    })
    .join("\n");
}

/** Cierra `}` huérfanos en bloques nginx antes de cerrar el fence. */
function repairUnclosedNginxBlocks(text: string): string {
  return text.replace(/```nginx\s*\n([\s\S]*?)```/gi, (_full, inner: string) => {
    const open = (inner.match(/\{/g) ?? []).length;
    const close = (inner.match(/\}/g) ?? []).length;
    if (open <= close) return _full;
    const pad = inner.match(/\n(\s+)\S/)?.[1] ?? "    ";
    const closes = Array.from({ length: open - close }, () => `${pad}}`).join("\n");
    return `\`\`\`nginx\n${inner.trimEnd()}\n${closes}\n\`\`\``;
  });
}

/** Cierra fences abiertos antes de ## / ---; evita ``` duplicado antes de ```nginx. */
export function repairOpenFencesBeforeSections(text: string): string {
  let out = text.replace(/\n```\s*\n+```(nginx|yaml|env|dockerfile)\b/gi, "\n\n```$1");
  out = out.replace(/\n```\s*\n```\s*\n/g, "\n\n");

  const lines = out.split("\n");
  const result: string[] = [];
  let openLang: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    const openMatch = t.match(/^```(\w*)\s*$/);

    if (openMatch && t !== "```") {
      if (openLang !== null && openMatch[1]) {
        result.push("```");
        result.push("");
      }
      openLang = openMatch[1] ?? "";
      result.push(line);
      continue;
    }

    if (t === "```") {
      openLang = null;
      result.push(line);
      continue;
    }

    if (openLang !== null) {
      if (t === "---") {
        result.push("```");
        openLang = null;
      } else if (/^##\s+\d+\./.test(t)) {
        result.push("```");
        openLang = null;
      } else if (isInfraProseLine(t) && openLang === "dockerfile") {
        result.push("```");
        result.push("");
        openLang = null;
      } else if (/^\*\*Configuración de nginx/i.test(t) && openLang === "dockerfile") {
        result.push("```");
        result.push("");
        openLang = null;
      } else if (/^```(\w+)/.test(t)) {
        result.push("```");
        result.push("");
        openLang = null;
      }
    }

    result.push(line);
  }

  if (openLang !== null) result.push("```");
  out = result.join("\n");
  return repairUnclosedNginxBlocks(out);
}

/** Elimina fences ``` sueltos entre secciones. */
export function repairStrayInfraFences(text: string): string {
  let out = text.replace(/\n---\s*\n+```\s*\n+(?=##\s)/g, "\n---\n\n");
  out = out.replace(/(\n##\s+\d+\.[^\n]+\n)\n```\s*\n+(?=[#\w])/g, "$1\n");
  out = out.replace(/(\n```(?:dockerfile|yaml|env|nginx)?\s*\n[\s\S]*?\n```)\s*\n```\s*\n+(?=##\s)/g, "$1\n\n");
  return out;
}

/** Envuelve bloques Dockerfile sueltos. */
export function repairOrphanDockerfileBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inAnyFence = false;
  let inDockerFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();

    if (/^```/.test(t)) {
      if (inDockerFence && t === "```") {
        inDockerFence = false;
        inAnyFence = false;
      } else if (!inDockerFence) {
        inAnyFence = t !== "```";
      }
      out.push(line);
      continue;
    }

    if (inAnyFence && !inDockerFence) {
      out.push(line);
      continue;
    }

    if (inDockerFence && (/^##\s+\d+\./.test(t) || /^###\s+(Frontend|Backend)\b/i.test(t) || isInfraProseLine(t))) {
      out.push("```");
      inDockerFence = false;
      inAnyFence = false;
    }

    if (!inDockerFence && !inAnyFence && isDockerfileLine(t)) {
      out.push("```dockerfile");
      inDockerFence = true;
      inAnyFence = true;
    }

    out.push(line);

    if (inDockerFence && i + 1 < lines.length) {
      const next = lines[i + 1]!.trim();
      if (/^##\s+\d+\./.test(next) || /^###\s+(Frontend|Backend)\b/i.test(next) || isInfraProseLine(next)) {
        out.push("```");
        inDockerFence = false;
        inAnyFence = false;
      }
    }
  }

  if (inDockerFence) out.push("```");
  return out.join("\n");
}

/** ` ```dockerfile ` con KEY=VALUE → ```env`. */
export function repairMislabeledEnvFences(text: string): string {
  return text.replace(/```dockerfile\s*\n([\s\S]*?)```/gi, (full, inner: string) => {
    const lines = inner.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return full;
    const envLines = lines.filter((l) => isEnvLine(l) || /^#/.test(l)).length;
    const dockerLines = lines.filter((l) => isDockerfileLine(l)).length;
    if (dockerLines === 0 && envLines >= Math.max(2, lines.length * 0.6)) {
      return `\`\`\`env\n${inner.trim()}\n\`\`\``;
    }
    return full;
  });
}

function isYamlDesignTokenLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (/^(colors|tokens|spacing|typography|radius|shadows|palette|theme|font|breakpoints|components|rounded):/i.test(trimmed)) {
    return true;
  }
  if (/^-\s+[\w.-]+:/.test(trimmed)) return true;
  if (/^\s{2,}-\s+[\w.-]+:/.test(trimmed)) return true;
  if (/^[\w.-]+:\s*$/.test(trimmed)) return true;
  if (/^[\w.-]+:\s+['"#\d{]/.test(trimmed)) return true;
  if (/^\s{2,}[\w.-]+:/.test(trimmed)) return true;
  if (/\{(?:colors|rounded|spacing)\./.test(trimmed)) return true;
  return false;
}

/** YAML de design system fuera de fence seguido de ```dockerfile|yaml``` parcial → un solo bloque ```yaml`. */
export function repairUnfencedYamlDesignBlock(text: string): string {
  const designStart =
    /(?:^|\n)((?:typography|colors|tokens|spacing|rounded|components|palette|theme|font|breakpoints):[\s\S]*?)```(?:dockerfile|yaml)\s*\n([\s\S]*?)```/gi;

  return text.replace(designStart, (_full, orphan: string, inner: string) => {
    const merged = [orphan.trim(), inner.trim()].filter(Boolean).join("\n");
    if (!merged) return _full;
    return `\n\`\`\`yaml\n${merged}\n\`\`\``;
  });
}

/** ` ```dockerfile ` con tokens YAML (design system) → ```yaml`. */
export function repairMislabeledYamlFences(text: string): string {
  return text.replace(/```dockerfile\s*\n([\s\S]*?)```/gi, (full, inner: string) => {
    const lines = inner.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return full;
    const yamlLines = lines.filter((l) => isYamlDesignTokenLine(l)).length;
    const dockerLines = lines.filter((l) => isDockerfileLine(l)).length;
    const designSystemMarkers =
      /^(typography|components|rounded|spacing|colors|tokens):/im.test(inner) ||
      /\{(?:colors|rounded)\./.test(inner);
    if (
      dockerLines === 0 &&
      (yamlLines >= Math.max(2, lines.length * 0.4) || (designSystemMarkers && yamlLines >= 2))
    ) {
      return `\`\`\`yaml\n${inner.trim()}\n\`\`\``;
    }
    return full;
  });
}

/** Quita prosa (**Notas:**, bullets explicativos) del cuerpo YAML. */
function stripProseFromYamlBody(yaml: string): string {
  const lines = yaml.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      out.push("");
      continue;
    }
    if (/^```/.test(t)) continue;
    if (isInfraProseLine(t)) break;
    if (/^[-*]\s+[A-ZÁÉÍÓÚ`"]/.test(t) && !/^[-*]\s+"[\d:]/.test(t)) break;
    if (/^Los servicios/i.test(t)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Reindenta servicios compose que el LLM anidó en cascada. */
export function repairComposeYamlStructure(yaml: string): string {
  const lines = stripProseFromYamlBody(yaml).split("\n");
  const out: string[] = [];
  let versionLine = "";
  let mode: "services" | "volumes" | "networks" | "idle" = "idle";
  let currentService = "";
  let subMode: "environment" | "volumes" | "ports" | "depends_on" | "healthcheck" | "build" | null = null;
  let sawService = false;

  const pushService = (name: string) => {
    currentService = name;
    subMode = null;
    sawService = true;
    out.push(`  ${name}:`);
  };

  const handleServiceLine = (trimmed: string): boolean => {
    if (!currentService) return false;

    const prop = trimmed.match(/^([a-z_]+):\s*(.*)$/i);
    if (prop && COMPOSE_PROPS.has(prop[1]!.toLowerCase())) {
      subMode = prop[1]!.toLowerCase() as typeof subMode;
      const val = prop[2]?.trim() ?? "";
      if (subMode === "environment" || subMode === "ports" || subMode === "volumes" || subMode === "depends_on") {
        out.push(`    ${prop[1]}:`);
      } else if (val) {
        out.push(`    ${prop[1]}: ${val}`);
        subMode = null;
      } else {
        out.push(`    ${prop[1]}:`);
      }
      return true;
    }

    if (/^[a-z_][\w-]*:\/.*/.test(trimmed) || /^\.?\/?[\w./-]+:\/.*/.test(trimmed)) {
      if (subMode !== "volumes") {
        out.push("    volumes:");
        subMode = "volumes";
      }
      out.push(`      - ${trimmed}`);
      return true;
    }

    if (/^[A-Z_][A-Z0-9_]*=/.test(trimmed)) {
      if (subMode !== "environment") {
        out.push("    environment:");
        subMode = "environment";
      }
      out.push(`      ${trimmed}`);
      return true;
    }

    if (/^[A-Z_][A-Z0-9_]*:\s*\S/.test(trimmed)) {
      if (subMode !== "environment") {
        out.push("    environment:");
        subMode = "environment";
      }
      out.push(`      ${trimmed}`);
      return true;
    }

    if (/^-\s+[A-Z_][A-Z0-9_]*:/.test(trimmed)) {
      const envLine = trimmed.replace(/^-\s+/, "");
      if (subMode !== "environment") {
        out.push("    environment:");
        subMode = "environment";
      }
      out.push(`      ${envLine}`);
      return true;
    }

    if (/^-\s+/.test(trimmed)) {
      out.push(`      ${trimmed}`);
      return true;
    }

    if (/^"[\d:]+"/.test(trimmed) || /^'\d/.test(trimmed) || /^\d+:\d+/.test(trimmed)) {
      if (subMode !== "ports") {
        out.push("    ports:");
        subMode = "ports";
      }
      const port = trimmed.replace(/^-\s*/, "");
      out.push(`      - ${port.startsWith('"') ? port : `"${port}"`}`);
      return true;
    }

    if (/^test:/.test(trimmed) || /^interval:/.test(trimmed) || /^timeout:/.test(trimmed) || /^retries:/.test(trimmed) || /^start_period:/.test(trimmed)) {
      if (subMode !== "healthcheck") {
        out.push("    healthcheck:");
        subMode = "healthcheck";
      }
      out.push(`      ${trimmed}`);
      return true;
    }

    if (/^condition:/.test(trimmed)) {
      out.push(`        ${trimmed}`);
      return true;
    }

    if (subMode === "depends_on" && COMPOSE_SERVICES.has(trimmed.replace(":", ""))) {
      out.push(`      ${trimmed.endsWith(":") ? trimmed : `${trimmed}:`}`);
      return true;
    }

    if (/^context:/.test(trimmed) || /^dockerfile:/.test(trimmed)) {
      out.push(`      ${trimmed}`);
      return true;
    }

    if (trimmed.startsWith("#")) {
      out.push(`    ${trimmed}`);
      return true;
    }

    if (/^restart:/.test(trimmed) || /^command:/.test(trimmed)) {
      out.push(`    ${trimmed}`);
      subMode = null;
      return true;
    }

    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || /^```/.test(trimmed)) continue;

    if (/^version\s*:/i.test(trimmed)) {
      versionLine = trimmed;
      continue;
    }

    if (/^services\s*:/i.test(trimmed)) {
      mode = "services";
      currentService = "";
      subMode = null;
      continue;
    }

    const svcOnly = trimmed.match(/^([a-z][\w-]*):\s*$/);
    if (svcOnly && COMPOSE_SERVICES.has(svcOnly[1]!)) {
      if (mode === "idle" || mode === "services") {
        if (mode === "idle") mode = "services";
        pushService(svcOnly[1]!);
        continue;
      }
    }

    if ((mode === "services" || mode === "idle") && currentService && handleServiceLine(trimmed)) {
      continue;
    }

    if (/^volumes\s*:/i.test(trimmed) && (mode === "idle" || (mode === "services" && !currentService))) {
      mode = "volumes";
      currentService = "";
      subMode = null;
      out.push("");
      out.push("volumes:");
      continue;
    }

    if (/^volumes\s*:/i.test(trimmed) && mode === "services" && currentService) {
      const next = lines[i + 1]?.trim() ?? "";
      if (/^[a-z_][\w-]*:\s*$/.test(next) && !/:\//.test(next)) {
        currentService = "";
        subMode = null;
        mode = "volumes";
        out.push("");
        out.push("volumes:");
        continue;
      }
    }

    if (/^networks\s*:/i.test(trimmed)) {
      mode = "networks";
      currentService = "";
      subMode = null;
      out.push("");
      out.push("networks:");
      continue;
    }

    if (mode === "volumes") {
      const volKey = trimmed.match(/^([a-z_][\w-]*):\s*$/);
      if (volKey) {
        out.push(`  ${trimmed}`);
        subMode = "volumes";
        continue;
      }
      if (/^driver:/.test(trimmed) || /^name:/.test(trimmed)) {
        out.push(`    ${trimmed}`);
        continue;
      }
    }
  }

  const body = out.join("\n").replace(/\bdepends on:/gi, "depends_on:").replace(/\n{3,}/g, "\n\n").trim();
  if (!body) return yaml;

  if (!sawService && /^volumes:/m.test(body)) {
    return [versionLine, body].filter(Boolean).join("\n").trim();
  }

  const serviceBody = body.replace(/^services:\s*\n?/i, "");
  return [versionLine, "", "services:", serviceBody].filter(Boolean).join("\n").replace(/^services:\s*\n\s*services:/i, "services:");
}

/** Convierte `- image: foo` en YAML con indentación. */
export function repairBulletedYamlLines(yaml: string): string {
  const lines = yaml.split("\n");
  const out: string[] = [];
  let indent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }
    if (/^```/.test(trimmed)) continue;

    if (/^(version|name)\s*:/i.test(trimmed)) {
      indent = 0;
      out.push(trimmed);
      continue;
    }
    if (/^(services|volumes|networks)\s*:/i.test(trimmed)) {
      indent = 0;
      out.push(trimmed);
      if (/^services\s*:/i.test(trimmed)) indent = 2;
      continue;
    }

    const serviceMatch = trimmed.match(/^([a-zA-Z][\w-]*):\s*$/);
    if (serviceMatch && !trimmed.startsWith("-") && COMPOSE_SERVICES.has(serviceMatch[1]!)) {
      out.push(`${" ".repeat(Math.max(indent, 2))}${trimmed}`);
      indent = Math.max(indent, 2) + 2;
      continue;
    }

    const bulletMatch = trimmed.match(/^-\s+(.+)$/);
    if (bulletMatch) {
      const content = bulletMatch[1]!;
      if (/^[a-zA-Z_-]+:\s*$/.test(content)) {
        out.push(`${" ".repeat(indent)}${content}`);
        indent += 2;
      } else {
        out.push(`${" ".repeat(indent)}${content}`);
      }
      continue;
    }

    if (trimmed.startsWith("#")) {
      out.push(`${" ".repeat(Math.max(indent, 2))}${trimmed}`);
      continue;
    }

    out.push(line);
  }

  return repairComposeYamlStructure(
    out
      .join("\n")
      .replace(/\bdepends on:/gi, "depends_on:")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

/** Sección ## 2. docker-compose → ```yaml. */
export function repairComposeYamlSection(text: string): string {
  return text.replace(
    /(##\s*2\.[^\n]*(?:docker-compose|compose)[^\n]*\n)([\s\S]*?)(?=\n---\s*\n|\n##\s*3\.|\n##\s*4\.|\n##\s+Cumplimiento|$)/i,
    (_full, heading: string, body: string) => {
      let yaml = body;
      yaml = yaml.replace(/```yaml\s*/gi, "");
      yaml = yaml.replace(/```\s*/g, "");
      yaml = repairBulletedYamlLines(yaml);
      if (!yaml.trim()) return heading;
      return `${heading}\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;
    },
  );
}

/** Sección ## 3. Variables de entorno → ```env. */
export function repairEnvExampleSection(text: string): string {
  return text.replace(
    /(##\s*3\.[^\n]*(?:Variables de entorno|\.env)[^\n]*\n)([\s\S]*?)(?=\n---\s*\n|\n##\s*4\.|\n##\s+Cumplimiento|$)/i,
    (_full, heading: string, body: string) => {
      if (/```env/i.test(body) && !/```dockerfile/i.test(body)) return _full;
      let env = body.replace(/```(?:dockerfile|env)?\s*/gi, "");
      env = env.replace(/^\s*```\s*$/gm, "").trim();
      if (!env) return _full;
      return `${heading}\n\`\`\`env\n${env}\n\`\`\`\n`;
    },
  );
}

/** Sección ## 4. Volúmenes: yaml + bullets separados. */
export function repairVolumesSection(text: string): string {
  return text.replace(
    /(##\s*4\.[^\n]*(?:Volúmenes|volumen)[^\n]*\n)([\s\S]*?)(?=\n---\s*\n|\n##\s+Cumplimiento|\n##\s*Registro|$)/i,
    (_full, heading: string, body: string) => {
      const fenceMatch = body.match(/```yaml\s*([\s\S]*?)```/i);
      const yaml = fenceMatch?.[1]?.trim() ?? "";
      const prose = body
        .replace(/```[\s\S]*?```/g, "")
        .trim();
      let result = heading;
      if (yaml) result += `\n\`\`\`yaml\n${repairComposeYamlStructure(yaml)}\n\`\`\`\n`;
      if (prose) result += `\n${prose}\n`;
      return result;
    },
  );
}

/** Alinea instrucciones RUN/COPY del Dockerfile con el gestor de paquetes del MDD §2. */
export function alignDockerfilePackageManager(
  infraMarkdown: string,
  packageManager: "pnpm" | "yarn" | "npm",
): string {
  if (!infraMarkdown?.trim() || packageManager !== "pnpm") return infraMarkdown ?? "";

  let out = infraMarkdown;
  out = out.replace(
    /\bRUN\s+yarn\s+install(?:\s+--frozen-lockfile)?/gi,
    "RUN pnpm install --frozen-lockfile",
  );
  out = out.replace(/\bRUN\s+yarn\s+build\b/gi, "RUN pnpm build");
  out = out.replace(/\bRUN\s+yarn\s+(test|lint|typecheck)\b/gi, "RUN pnpm $1");
  out = out.replace(/\bRUN\s+yarn\s+run\s+(\w+)\b/gi, "RUN pnpm run $1");
  out = out.replace(/\bCOPY\s+([^\n]*?)yarn\.lock\b/gi, "COPY $1pnpm-lock.yaml");
  return out;
}

export function repairInfraMarkdown(text: string): string {
  if (!text?.trim()) return text ?? "";
  let out = text.replace(/\r\n/g, "\n");
  out = repairOpenFencesBeforeSections(out);
  out = repairStrayInfraFences(out);
  out = repairFalseDockerfileHeadings(out);
  out = repairOrphanDockerfileBlocks(out);
  out = repairOpenFencesBeforeSections(out);
  out = repairUnfencedYamlDesignBlock(out);
  out = repairMislabeledEnvFences(out);
  out = repairMislabeledYamlFences(out);
  out = repairComposeYamlSection(out);
  out = repairEnvExampleSection(out);
  out = repairVolumesSection(out);
  out = repairOpenFencesBeforeSections(out);
  out = repairStrayInfraFences(out);
  return out;
}
