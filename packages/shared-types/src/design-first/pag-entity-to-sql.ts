import type { PagEntity, PagField } from "../project-architecture-graph.js";

export function resolvePagTableName(entity: PagEntity): string {
  const explicit = entity.tableName?.trim();
  if (explicit) return explicit;
  return entity.name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function pagFieldToSqlType(field: PagField): string {
  const t = field.type.trim().toLowerCase();
  if (t === "uuid") return "UUID";
  if (t === "string" || t === "text") return "VARCHAR(255)";
  if (t === "int" || t === "integer") return "INTEGER";
  if (t === "boolean" || t === "bool") return "BOOLEAN";
  if (t === "datetime" || t === "timestamptz" || t === "date") return "TIMESTAMPTZ";
  if (t === "float" || t === "decimal" || t === "numeric") return "NUMERIC(12, 2)";
  if (t.includes("json")) return "JSONB";
  return "VARCHAR(255)";
}

function onDeleteClause(onDelete?: string): string {
  if (!onDelete || onDelete === "NO_ACTION") return "";
  return ` ON DELETE ${onDelete.replace(/_/g, " ")}`;
}

export function pagEntityToCreateTable(entity: PagEntity, entitiesByName: Map<string, PagEntity>): string {
  const table = resolvePagTableName(entity);
  const pk = entity.primaryKey || "id";
  const parts: string[] = [];

  for (const field of entity.fields) {
    const fk = field.constraints.find((c) => c.type === "foreign_key" && c.reference);
    const sqlType = pagFieldToSqlType(field);
    let def = `  ${field.name} ${sqlType}`;
    const isPk = field.name === pk;
    if (isPk) {
      def += " PRIMARY KEY";
      if (sqlType === "UUID") def += " DEFAULT gen_random_uuid()";
    }
    if (fk?.reference) {
      const refEntity = entitiesByName.get(fk.reference.entity);
      const refTable = refEntity ? resolvePagTableName(refEntity) : fk.reference.entity.toLowerCase();
      def += ` REFERENCES ${refTable}(${fk.reference.field})${onDeleteClause(fk.reference.onDelete)}`;
    }
    if (field.required && !isPk && !fk) def += " NOT NULL";
    parts.push(def);
  }

  return `CREATE TABLE ${table} (\n${parts.join(",\n")}\n);`;
}

export function compilePagEntitiesToSql(pag: { entities: PagEntity[] }): string {
  const sorted = [...pag.entities].sort((a, b) => resolvePagTableName(a).localeCompare(resolvePagTableName(b)));
  const byName = new Map(sorted.map((e) => [e.name, e]));
  return sorted.map((e) => pagEntityToCreateTable(e, byName)).join("\n\n");
}
