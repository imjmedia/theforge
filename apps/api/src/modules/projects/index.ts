/** API pública del módulo projects para otros módulos (p. ej. ai-analysis): no importar sus archivos internos. */
export { ProjectsService } from "./projects.service.js";
export { MddWriteFencedError } from "./project-mdd-persist.service.js";
export { pickPrimaryStage } from "./stage-helpers.js";
