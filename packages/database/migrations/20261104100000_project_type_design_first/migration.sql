-- Design-First paso 5A: valor de enum aislado (no comparte transacción con columnas que lo usen).

ALTER TYPE "ProjectType" ADD VALUE IF NOT EXISTS 'DESIGN_FIRST';
