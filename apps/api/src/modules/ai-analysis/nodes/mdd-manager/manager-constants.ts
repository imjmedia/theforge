/** Umbrales y patrones de routing del Manager MDD. */

import { CASCADE_ACCURACY_THRESHOLD } from "@theforge/shared-types";

/** >= 85: done (cede intervención al usuario). < 85: Manager asigna gaps a agentes para corregir. */
export const QUALITY_THRESHOLD = 85;
/** Nota < 9/10: por debajo de 90% el documento se devuelve al Clarifier con reporte de gaps para segunda iteración. */
export const AUDITOR_RETRY_THRESHOLD = CASCADE_ACCURACY_THRESHOLD;
export const MAX_MDD_ITERATIONS = 2;

/** Usuario pide explícitamente detenerse: done solo si Auditor >= 85% o el usuario lo pide. */
export const USER_STOP_PATTERN = /^(parar|detener|stop|terminar|salir|no\s+continuar|basta|listo)$/i;

/** Petición explícita de auditar el documento → disparar solo el Auditor (no todo el pipeline). */
export const AUDIT_DOCUMENT_PATTERN =
  /audita\s+(el\s+)?(mdd|documento)|auditar\s+(el\s+)?(mdd|documento)/i;

/** Usuario pide solo reformatear el documento (sin LLM). */
export const REFORMAT_DOCUMENT_PATTERN =
  /reformatea\s+(el\s+)?(mdd|documento)|reformatear\s+(el\s+)?(mdd|documento)|reformateo\s+(del?\s+)?(mdd|documento)/i;

/** Usuario pide regenerar el diagrama ER desde el SQL (solo sección 2, sin LLM). */
export const REGENERATE_ER_DIAGRAM_PATTERN =
  /regenera(r)?\s+(el\s+)?(diagrama\s+)?(er|entidad-relación|entidad\s+relación)(\s+desde\s+el\s+sql)?|regenerar\s+(el\s+)?(diagrama\s+)?(er|entidad-relación)/i;

export const FULL_MDD_REGENERATE_DIRECTIVE =
  "ACCIÓN REQUERIDA — Regeneración completa del MDD (constitución vigente del repo):\n" +
  "1) §2: solo stack que §1 sustente; bloque ```TechnicalMetadata``` **prohibido** en §2 (va en §3).\n" +
  "2) §3: CREATE TABLE + erDiagram + ```TechnicalMetadata```; si hay GEOMETRY, extensiones `postgis` en el SQL; YAGNI.\n" +
  "3) §4: **obligatorio §4.A** (API del producto: tabla + /health + endpoints alineados a §3). **§4.B** solo para integraciones externas (DENUE, etc.). No dejes §4 = solo terceros.\n" +
  "4) §5: proporcional al alcance; sin checklist genérico interminable.\n" +
  "5) Reescribe §2–§5 desde cero si el borrador contradice lo anterior; conserva §1 salvo que el usuario pida cambiar contexto.\n" +
  "6) §6 y §7: placeholders breves para agentes posteriores si aún no aplican — sin fusionar `## 6. Seguridad` con `###`.";

/** Indica si el usuario pide seguir refinando (ej. "sigamos trabajando", "avanzar al 85%", "seguir con el MDD"). */
export const CONTINUE_REFINING_PATTERN =
  /(?:sigamos?|seguir|continu(?:ar|amos|emos)|avancemos?|avanzar|trabaj(?:ar|emos)|(?:del?\s+)?\d+\s*%\s*(?:al\s+)?85|(?:al\s+)?85\s*%|mejor(?:ar|emos)|refin(?:ar|emos)|complet(?:ar|emos)|termin(?:ar|emos)\s+el\s+mdd)/i;

/** Usuario pregunta qué falta o con qué continuar para llegar al 85% (debe responder con auditorFeedback). */
export const ASK_WHAT_NEEDED_FOR_85_PATTERN =
  /(?:con\s+qué|qué\s+falta|qué\s+necesitamos?|qué\s+hay\s+que\s+hacer|qué\s+pendiente|cómo\s+llegamos?)\s+(?:para\s+)?(?:llegar\s+al\s+)?\d+\s*%?|\d+\s*%?\s*(?:con\s+qué|qué\s+falta|qué\s+continuamos)/i;

/** Respuesta breve de acuerdo a una propuesta (ACID, MFA, etc.): delegar para que se incorpore al MDD, no responder "reply". */
export const SHORT_AGREEMENT_PATTERN =
  /^(?:s[ií]|s[ií]\s*,\s*de\s*acuerdo|de\s*acuerdo|ok|vale|correcto|estoy\s+de\s+acuerdo|perfecto|acepto|aprobado|procedamos?|adelante|hazlo|incorpóralo|agreg(?:ar|uen)(?:lo)?|inclu(?:ir|yan)(?:lo)?)[\s.]*$/i;

/** Confirmación de aprobación del plan (HITL 4.4): ejecutar el plan pendiente. */
export const PLAN_APPROVAL_CONFIRM_PATTERN =
  /^(?:s[ií]|s[ií]\s*,\s*ejecuta|ejecuta(r)?\s*(el\s+)?plan|adelante|aprobado|ok|vale|procedamos?|adelante\s+con\s+el\s+plan|ejecutar)[\s.]*$/i;

/** Petición explícita de regenerar una sección del MDD (p. ej. «regenera el paso 6»). */
export const REGENERATE_SECTION_N_PATTERN =
  /\b(?:regenera(?:r)?|rehacer|actualiza(?:r)?|genera(?:r)?\s+de\s+nuevo)\s+(?:solo\s+)?(?:la\s+)?(?:secci[oó]n|paso)\s*([1-7])\b/i;

/** Usuario indica que ya no tiene más información o que trabaje con lo que hay → armar plan actual y mostrar para aprobar. */
export const WORK_WITH_WHAT_WE_HAVE_PATTERN =
  /^(?:(?:no,?\s*)?ya\s*(?:trabaj(e|a)|haz\s*(?:la\s*)?modificaci[oó]n)|no\s*tengo\s*m[aá]s\s*(informaci[oó]n|info)?|ejecut(a|ar)|avanza|contin[uú]a|con\s+eso\s+est[aá]|listo\s*para\s*ejecut|haz\s*(la\s*)?modificaci[oó]n)[\s.]*$/i;

/** Indica si el mensaje ya describe tema/alcance del MDD (evitar preguntar "¿Sobre qué tema?"). */
export const INITIAL_TOPIC_PATTERN =
  /(?:necesito|quiero|requiero|busco|dame|genera?|elabora?|crea?)\s+(?:el\s+)?mdd|mdd\s+de\s+un\s+sistema|sistema\s+(?:de\s+)?(?:auth|sso|login|mfa|totp|jwks|api)|autenticación|single\s*sign|mfa|totp|jwks|well-known|oauth|jwt/i;
