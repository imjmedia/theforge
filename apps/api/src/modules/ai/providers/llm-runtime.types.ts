/**
 * @fileoverview Tipos de runtime LLM resueltos desde configuración BYOK del usuario.
 * {@link UserLLMRuntime} es el tipo canónico que todo adapter recibe en ejecución.
 */
import type { ProviderId } from "./provider-catalog.js";

/** Runtime resuelto desde BYOK del usuario (sin leer claves de env). */
export interface UserLLMRuntime {
  providerId: ProviderId;
  apiKey: string;
  baseURL: string;
  chatModel: string;
  chatModelFallbacks: string[];
  embeddingModel: string | null;
  /** Dimensión de vectores para Falkor (derivada o override de usuario). */
  embeddingDimension: number | null;
  embeddingsEnabled: boolean;
  sttModel: string | null;
  visionModel: string;
  imageModel: string | null;
  extras?: Record<string, unknown>;
}
