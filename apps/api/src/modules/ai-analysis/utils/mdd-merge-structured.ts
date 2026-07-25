/**
 * @fileoverview Merge de objetos MDD estructurados con deduplicación.
 */

import type { MddStructured } from "../state/mdd-structured.schema.js";
import {
  mddContratosApiSchema,
  mddIntegracionSchema,
  mddModeloDatosSchema,
  mddStructuredSchema,
} from "../state/mdd-structured.schema.js";
import { hydrateStructuredFromDraft } from "./mdd-sanitize.js";

/**
 * Deep merge de modeloDatos: slice reemplaza campos definidos; el resto se hereda de prev.
 * Acepta slice parcial (p. ej. solo diagramaEr desde diagram injector).
 */
function mergeModeloDatos(
  prev: MddStructured["modeloDatos"],
  slice: Partial<NonNullable<MddStructured["modeloDatos"]>>,
): MddStructured["modeloDatos"] {
  const sql = slice.sql ?? prev?.sql ?? "";
  const diagramaEr = slice.diagramaEr !== undefined ? slice.diagramaEr : prev?.diagramaEr;
  const technicalMetadata =
    slice.technicalMetadata !== undefined ? slice.technicalMetadata : prev?.technicalMetadata;
  return mddModeloDatosSchema.parse({ sql, diagramaEr, technicalMetadata });
}

/**
 * Deep merge de contratosApi: slice reemplaza summary y endpoints si vienen definidos.
 */
function mergeContratosApi(
  prev: MddStructured["contratosApi"],
  slice: Partial<NonNullable<MddStructured["contratosApi"]>>,
): MddStructured["contratosApi"] {
  return mddContratosApiSchema.parse({
    summary: slice.summary !== undefined ? slice.summary : prev?.summary,
    endpoints: slice.endpoints !== undefined ? slice.endpoints : prev?.endpoints,
  });
}

/**
 * Merge de MddStructured: prev + slice.
 * - Si se pasa draft, se hidrata prev con §1 y §2 desde el draft (evita borrar Contexto/Arquitectura).
 * - Campos escalares/string: si slice los define, se usan; si no, se mantiene prev.
 * - Arrays (seguridad, customSections): si slice los define, reemplazan; si no, se mantiene prev.
 * - integracion: si slice lo define, reemplaza; si no, se mantiene prev.
 * - Objetos anidados (modeloDatos, contratosApi): deep merge.
 */
export function mergeMddStructured(
  prev: MddStructured | null | undefined,
  slice: Partial<MddStructured>,
  draft?: string,
): MddStructured {
  const base =
    draft != null && draft.trim()
      ? hydrateStructuredFromDraft(prev, draft)
      : ((prev ?? {}) as MddStructured);
  const out: MddStructured = {
    title: slice.title !== undefined ? slice.title : base.title,
    contextoAlcance:
      slice.contextoAlcance !== undefined ? slice.contextoAlcance : base.contextoAlcance,
    arquitecturaStack:
      slice.arquitecturaStack !== undefined ? slice.arquitecturaStack : base.arquitecturaStack,
    modeloDatos:
      slice.modeloDatos !== undefined
        ? mergeModeloDatos(base.modeloDatos ?? undefined, slice.modeloDatos)
        : base.modeloDatos,
    contratosApi:
      slice.contratosApi !== undefined
        ? mergeContratosApi(base.contratosApi ?? undefined, slice.contratosApi)
        : base.contratosApi,
    logicaEdgeCases:
      slice.logicaEdgeCases !== undefined ? slice.logicaEdgeCases : base.logicaEdgeCases,
    seguridad: slice.seguridad !== undefined ? slice.seguridad : base.seguridad,
    integracion:
      slice.integracion !== undefined
        ? mddIntegracionSchema.parse(slice.integracion)
        : base.integracion,
    arquitecturaFrontend:
      slice.arquitecturaFrontend !== undefined
        ? slice.arquitecturaFrontend
        : base.arquitecturaFrontend,
    customSections:
      slice.customSections !== undefined ? slice.customSections : base.customSections,
  };
  return mddStructuredSchema.parse(out);
}
