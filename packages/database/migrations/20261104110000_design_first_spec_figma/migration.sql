-- Design-First paso 5B+C: columnas de diseño y tabla `UserFigmaCredential` (idempotente).

ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "designSpec" JSONB;
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "designSpecRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "UserFigmaCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "tokenKeyVersion" INTEGER NOT NULL,
    "figmaHandle" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFigmaCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserFigmaCredential_userId_key" ON "UserFigmaCredential"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserFigmaCredential_userId_fkey'
  ) THEN
    ALTER TABLE "UserFigmaCredential"
      ADD CONSTRAINT "UserFigmaCredential_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
