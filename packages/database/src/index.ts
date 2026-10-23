/**
 * @fileoverview Paquete **@theforge/database**: reexporta el cliente Prisma generado y tipos de dominio
 * (proyectos, sesiones, estimaciones, memoria episódica, etc.). El schema fuente vive en `prisma/schema.prisma`;
 * no dupliques contratos aquí en comentarios salvo que añadas helpers TypeScript encima del client.
 *
 * @module @theforge/database
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */
export {
  PrismaClient,
  Prisma,
  type Project,
  type ProjectGroup,
  type Session,
  type ChangeLog,
  type Estimation,
  type Stage,
  type EpisodicMemory,
  type ProviderInstance,
  Status,
  StageStatus,
  EpisodicMemoryKind,
  ComplexityLevel,
  ProjectApproach,
} from "./generated/index.js";
