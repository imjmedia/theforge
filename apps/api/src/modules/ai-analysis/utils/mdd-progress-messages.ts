/**
 * @fileoverview Mensajes de progreso humano-legibles por nodo MDD.
 */

/**
 * Mensajes de progreso MDD en tiempo pasado: se emiten cuando el nodo LangGraph ya terminó.
 */
export const MDD_NODE_PROGRESS_MESSAGE: Record<string, string> = {
  manager: "Entrevista con el usuario completada",
  ask_initial_topic: "Tema o problema del MDD recopilado",
  plan_approval: "Plan presentado para aprobación",
  executor: "Plan ejecutado paso a paso",
  clarifier: "Alcance y requisitos clarificados",
  software_architect: "Schema SQL y contratos de API definidos",
  stack_architect: "Arquitectura y stack (§2) definidos",
  data_model: "Modelo de datos SQL y ER (§3) definidos",
  api_contracts: "Contratos de API (§4) definidos",
  architect_critic: "Modelo de datos verificado antes de contratos API",
  format_after_architect: "Documento formateado (post-arquitectura)",
  security: "Arquitectura de seguridad definida",
  integration: "Integraciones definidas",
  security_integration: "Seguridad e integración definidas",
  tail_parallel: "Lógica, seguridad e infraestructura definidas",
  format_after_redactor: "Documento formateado (post-redacción)",
  format_sec_int: "Documento formateado (seguridad e integración)",
  llm_formatter: "LLM formatter (deprecated)",
  cross_consistency_checker: "Consistencia entre secciones verificada",
  diagram_injector: "Diagramas Mermaid añadidos",
  prepare_output: "Salida del MDD preparada",
  graph_populator: "Grafo de dependencias actualizado",
  auditor: "Calidad del MDD evaluada",
};

/** Mensajes en presente continuo: se emiten al iniciar el nodo LangGraph. */
export const MDD_NODE_ACTIVE_PROGRESS_MESSAGE: Record<string, string> = {
  manager: "Entrevistando al usuario…",
  ask_initial_topic: "Recopilando tema o problema del MDD…",
  plan_approval: "Presentando plan para aprobación…",
  executor: "Ejecutando plan paso a paso…",
  clarifier: "Clarificando alcance y requisitos…",
  software_architect: "Definiendo schema SQL y contratos de API…",
  stack_architect: "Definiendo arquitectura y stack (§2)…",
  data_model: "Definiendo modelo de datos (§3)…",
  api_contracts: "Definiendo contratos de API (§4)…",
  architect_critic: "Verificando modelo de datos antes de contratos API…",
  format_after_architect: "Formateando documento (post-arquitectura)…",
  security: "Definiendo arquitectura de seguridad…",
  integration: "Definiendo integraciones…",
  security_integration: "Seguridad e integración generadas",
  tail_parallel: "Lógica, seguridad e infraestructura generadas en paralelo",
  format_sec_int: "Formateando seguridad e integración…",
  format_after_redactor: "Formateando documento (post-redacción)…",
  llm_formatter: "LLM formatter (deprecated)…",
  cross_consistency_checker: "Verificando consistencia entre secciones…",
  diagram_injector: "Añadiendo diagramas Mermaid…",
  prepare_output: "Preparando salida del MDD…",
  graph_populator: "Actualizando grafo de dependencias…",
  auditor: "Evaluando calidad del MDD…",
};

export function getMddNodeProgressMessage(nodeName: string): string {
  return MDD_NODE_PROGRESS_MESSAGE[nodeName] ?? `Paso «${nodeName}» completado`;
}

export function getMddNodeActiveProgressMessage(nodeName: string): string {
  return MDD_NODE_ACTIVE_PROGRESS_MESSAGE[nodeName] ?? `Ejecutando «${nodeName}»…`;
}
