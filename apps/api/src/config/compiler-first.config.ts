/**
 * Flags `COMPILER_FIRST_*` validados en `env.schema.ts`.
 * Centraliza la semántica heredada de `process.env` en `AiService` (paso Design-First 1).
 */
import type { ConfigService } from "@nestjs/config";
import type { Env } from "./env.schema.js";

export type CompilerFirstConfig = {
  useCompilerFirstBlueprint: boolean;
  useCompilerFirstApiContracts: boolean;
  useCompilerFirstLogicFlows: boolean;
  useCompilerFirstInfra: boolean;
};

type CompilerFirstEnvKeys = Pick<
  Env,
  | "COMPILER_FIRST_BLUEPRINT"
  | "COMPILER_FIRST_API_CONTRACTS"
  | "COMPILER_FIRST_LOGIC_FLOWS"
  | "COMPILER_FIRST_INFRA"
>;

function fromValidatedEnv(env: CompilerFirstEnvKeys): CompilerFirstConfig {
  return {
    useCompilerFirstBlueprint: env.COMPILER_FIRST_BLUEPRINT === true,
    useCompilerFirstApiContracts: env.COMPILER_FIRST_API_CONTRACTS !== false,
    useCompilerFirstLogicFlows: env.COMPILER_FIRST_LOGIC_FLOWS !== false,
    useCompilerFirstInfra: env.COMPILER_FIRST_INFRA !== false,
  };
}

function readKeysFromConfigService(config: Pick<ConfigService, "get">): CompilerFirstEnvKeys {
  return {
    COMPILER_FIRST_BLUEPRINT: config.get<boolean>("COMPILER_FIRST_BLUEPRINT") ?? false,
    COMPILER_FIRST_API_CONTRACTS: config.get<boolean>("COMPILER_FIRST_API_CONTRACTS") ?? true,
    COMPILER_FIRST_LOGIC_FLOWS: config.get<boolean>("COMPILER_FIRST_LOGIC_FLOWS") ?? true,
    COMPILER_FIRST_INFRA: config.get<boolean>("COMPILER_FIRST_INFRA") ?? true,
  };
}

/** Lee los flags desde el `ConfigService` global de Nest (valores ya validados al arrancar). */
export function readCompilerFirstConfig(config: Pick<ConfigService, "get">): CompilerFirstConfig {
  return fromValidatedEnv(readKeysFromConfigService(config));
}

/** Variante para pruebas unitarias que ya tienen un `Env` parseado con `validateEnv`. */
export function readCompilerFirstConfigFromEnv(env: CompilerFirstEnvKeys): CompilerFirstConfig {
  return fromValidatedEnv(env);
}
