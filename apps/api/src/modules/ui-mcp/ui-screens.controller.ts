/**
 * @fileoverview Endpoint del deliverable "Pantallas / UI Screens Spec".
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */
import { Controller, Param, Post } from "@nestjs/common";
import { ProjectScoped } from "../../common/access/project-scoped.decorator.js";
import { UiScreensService } from "./ui-screens.service.js";

@Controller("projects/:id/ui-screens")
export class UiScreensController {
  constructor(private readonly uiScreens: UiScreensService) {}

  /**
   * Genera/actualiza el deliverable de pantallas desde el MCP gráfico compatible activo.
   * Nivel `contribute`: deriva del MDD de forma determinista (plan + heurística/MCP gráfico), sin LLM.
   */
  @ProjectScoped("contribute")
  @Post("sync")
  sync(@Param("id") id: string) {
    return this.uiScreens.syncUiScreens(id);
  }
}
