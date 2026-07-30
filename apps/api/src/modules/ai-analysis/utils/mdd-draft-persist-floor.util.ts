/**
 * @fileoverview Suelo de tamaño para persistir borradores intermedios del job MDD.
 *
 * Job 92: el run 1 falló en el persist final tras 17 min con ~70k chars ya generados.
 * BullMQ reintentó el job entero desde cero y el Clarificador del intento 2 emitió un
 * esqueleto de 3084 chars que, al persistirse como borrador intermedio (`finalize: false`),
 * pisó en BD el documento bueno del intento anterior — efecto «se borró todo».
 *
 * `lastPersistedLen` vive por invocación, así que no protege entre intentos: hace falta
 * comparar contra lo que ya hay almacenado. Los borradores intermedios sólo alimentan la
 * vista previa en vivo, de modo que descartar uno nunca pierde trabajo — el cierre del job
 * (`finalize: true`) siempre escribe, incluso si encoge.
 */

/** Fracción del baseline por debajo de la cual un borrador intermedio no se persiste. */
export const MDD_INTERMEDIATE_PERSIST_MIN_RATIO = 0.5;

/** Baseline mínimo para activar el suelo: por debajo, cualquier avance es mejora. */
export const MDD_INTERMEDIATE_PERSIST_MIN_BASELINE = 4_000;

export type MddDraftPersistFloorInput = {
  /** Longitud del markdown que se quiere persistir. */
  candidateLen: number;
  /** Longitud del MDD ya almacenado al arrancar el job (0 si no había). */
  storedBaselineLen: number;
  /** Escritura final del job: nunca se bloquea. */
  finalize: boolean;
};

export type MddDraftPersistFloorResult = {
  allowed: boolean;
  /** Motivo del descarte, para log. `undefined` si se permite. */
  reason?: string;
};

/** Decide si un borrador puede sobrescribir el MDD almacenado. */
export function evaluateMddDraftPersistFloor(
  input: MddDraftPersistFloorInput,
): MddDraftPersistFloorResult {
  if (input.finalize) return { allowed: true };
  if (input.storedBaselineLen < MDD_INTERMEDIATE_PERSIST_MIN_BASELINE) return { allowed: true };

  const floor = Math.floor(input.storedBaselineLen * MDD_INTERMEDIATE_PERSIST_MIN_RATIO);
  if (input.candidateLen >= floor) return { allowed: true };

  return {
    allowed: false,
    reason:
      `borrador intermedio de ${input.candidateLen} chars descartado: ` +
      `menos del ${Math.round(MDD_INTERMEDIATE_PERSIST_MIN_RATIO * 100)}% del MDD almacenado ` +
      `(${input.storedBaselineLen} chars, suelo ${floor})`,
  };
}
