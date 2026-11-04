import type { MergeConflict, ProjectType } from "@theforge/shared-types";
import type { Phase0Document } from "../ai-analysis/phase0/phase0.types.js";
import { normalizePhase0Document } from "../ai-analysis/phase0/phase0-normalize.util.js";

export interface MergeSourceSnapshot {
  projectId: string;
  name: string;
  projectType: ProjectType;
  borrador: Phase0Document;
  dbgaMarkdown?: string;
  benchmarkMarkdown?: string;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function detectMergeConflicts(sources: MergeSourceSnapshot[]): MergeConflict[] {
  const conflicts: MergeConflict[] = [];

  const types = new Set(sources.map((s) => s.projectType));
  if (types.size > 1) {
    conflicts.push({
      kind: "project_type_mismatch",
      severity: "warning",
      message: "Las fuentes mezclan proyectos NEW y LEGACY; revisa alcance post-fusión.",
      sources: sources.map((s) => s.name),
    });
  }

  const entityMap = new Map<string, { name: string; desc: string; sources: string[] }>();
  for (const source of sources) {
    for (const entity of source.borrador.entidades) {
      const key = normalizeKey(entity.nombre);
      const existing = entityMap.get(key);
      if (!existing) {
        entityMap.set(key, {
          name: entity.nombre,
          desc: entity.descripcion.trim(),
          sources: [source.name],
        });
        continue;
      }
      existing.sources.push(source.name);
      if (existing.desc && entity.descripcion.trim() && existing.desc !== entity.descripcion.trim()) {
        conflicts.push({
          kind: "entity_name_collision",
          severity: "warning",
          message: `La entidad «${entity.nombre}» tiene descripciones distintas entre fuentes.`,
          sources: [...new Set(existing.sources)],
        });
      }
    }
  }

  const roleMap = new Map<string, { permisos: Set<string>; sources: string[] }>();
  for (const source of sources) {
    for (const role of source.borrador.roles) {
      const key = normalizeKey(role.rol);
      const existing = roleMap.get(key);
      if (!existing) {
        roleMap.set(key, {
          permisos: new Set(role.permisos.map((p) => p.trim())),
          sources: [source.name],
        });
        continue;
      }
      existing.sources.push(source.name);
      const before = new Set(existing.permisos);
      for (const p of role.permisos) existing.permisos.add(p.trim());
      if (before.size > 0 && role.permisos.length > 0) {
        const a = [...before].sort().join("|");
        const b = [...role.permisos].sort().join("|");
        if (a !== b) {
          conflicts.push({
            kind: "role_permission_mismatch",
            severity: "critical",
            message: `El rol «${role.rol}» tiene permisos distintos entre fuentes.`,
            sources: [...new Set(existing.sources)],
          });
        }
      }
    }
  }

  const problemas = sources
    .map((s) => s.borrador.proposito.problema.trim())
    .filter((p) => p.length > 20);
  if (problemas.length >= 2) {
    const unique = new Set(problemas.map((p) => p.slice(0, 80)));
    if (unique.size >= 2) {
      conflicts.push({
        kind: "proposito_divergence",
        severity: "warning",
        message: "Los problemas de negocio declarados difieren; la fusión debe unificar el propósito.",
        sources: sources.map((s) => s.name),
      });
    }
  }

  return conflicts;
}

export function mergeLlmConflicts(
  deterministic: MergeConflict[],
  llmConflicts: MergeConflict[] | undefined,
): MergeConflict[] {
  const seen = new Set<string>();
  const merged: MergeConflict[] = [];
  for (const c of [...deterministic, ...(llmConflicts ?? [])]) {
    const key = `${c.kind}:${c.message.slice(0, 96)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  return merged.slice(0, 12);
}

export function snapshotFromRaw(
  projectId: string,
  name: string,
  projectType: ProjectType,
  borrador: unknown,
): MergeSourceSnapshot {
  return {
    projectId,
    name,
    projectType,
    borrador: normalizePhase0Document(borrador),
  };
}
