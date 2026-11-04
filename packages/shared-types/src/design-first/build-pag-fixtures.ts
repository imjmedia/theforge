import type { PagEntity, ProjectArchitectureGraph } from "../project-architecture-graph.js";
import {
  buildSeededEntityExample,
  DEFAULT_PAG_FIXTURE_SEED,
  seededUuid,
} from "./pag-fixture-seed.js";

export type PagFixturesMap = Record<string, unknown>;

function entityFileBase(entity: PagEntity): string {
  const base = entity.tableName?.trim() || entity.name.toLowerCase();
  return base.replace(/[^a-z0-9_-]+/gi, "_");
}

function resolveForeignKeys(
  seed: string,
  entity: PagEntity,
  rowsByTable: Map<string, Record<string, unknown>[]>,
): Record<string, unknown>[] {
  const primaryRows = rowsByTable.get(entityFileBase(entity)) ?? [];
  return primaryRows.map((row, index) => {
    const next = { ...row };
    for (const field of entity.fields) {
      const fk = field.constraints?.find((c) => c.type === "foreign_key" && c.reference);
      if (!fk?.reference) continue;
      const refEntityName = fk.reference.entity;
      const refEntity = [...rowsByTable.keys()].find((k) =>
        k.toLowerCase().includes(refEntityName.toLowerCase()),
      );
      const refRows = refEntity ? rowsByTable.get(refEntity) : undefined;
      const refRow = refRows?.[Math.min(index, (refRows?.length ?? 1) - 1)];
      if (refRow && fk.reference.field in refRow) {
        next[field.name] = refRow[fk.reference.field];
      } else {
        next[field.name] = seededUuid(seed, `fk:${entity.name}:${field.name}:${index}`);
      }
    }
    return next;
  });
}

export function buildPagFixtures(
  pag: ProjectArchitectureGraph,
  options?: { fixtureSeed?: string; rowsPerEntity?: number },
): PagFixturesMap {
  const seed = options?.fixtureSeed ?? DEFAULT_PAG_FIXTURE_SEED;
  const rowsPerEntity = options?.rowsPerEntity ?? 2;
  const sortedEntities = [...pag.entities].sort((a, b) => a.name.localeCompare(b.name));
  const rowsByTable = new Map<string, Record<string, unknown>[]>();

  for (const entity of sortedEntities) {
    const fileBase = entityFileBase(entity);
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < rowsPerEntity; i += 1) {
      rows.push(buildSeededEntityExample(seed, entity, { id: seededUuid(seed, `${entity.name}:${i}`) }));
    }
    rowsByTable.set(fileBase, rows);
  }

  const fixtures: PagFixturesMap = {};
  for (const entity of sortedEntities) {
    const fileBase = entityFileBase(entity);
    const consistent = resolveForeignKeys(seed, entity, rowsByTable);
    rowsByTable.set(fileBase, consistent);
    fixtures[`${fileBase}.json`] = consistent;
  }

  return fixtures;
}
