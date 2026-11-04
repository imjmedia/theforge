-- Rollback manual Design-First (paso 5): convierte proyectos DESIGN_FIRST → NEW.
-- NO ejecutar en deploy normal. Requiere ventana de mantenimiento y backup previo.

CREATE TABLE IF NOT EXISTS "_design_first_rollback_audit" (
  "projectId" TEXT NOT NULL,
  "previousType" TEXT NOT NULL,
  "newType" TEXT NOT NULL,
  "rolledBackAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "_design_first_rollback_audit" ("projectId", "previousType", "newType")
SELECT "id", "projectType"::text, 'NEW'
FROM "Project"
WHERE "projectType" = 'DESIGN_FIRST';

UPDATE "Project"
SET "projectType" = 'NEW'
WHERE "projectType" = 'DESIGN_FIRST';

-- Nota: no elimina columnas designSpec ni UserFigmaCredential; release N+1 puede hacerlo tras validar.
