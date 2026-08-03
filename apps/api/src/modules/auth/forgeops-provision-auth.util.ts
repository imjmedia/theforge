import { timingSafeEqual } from "node:crypto";
import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const token = authorizationHeader.slice("Bearer ".length).trim();
  return token || null;
}

function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Valida `Authorization: Bearer <FORGEOPS_PROVISION_SECRET>`. */
export function assertForgeOpsProvisionAuthorized(
  authorizationHeader: string | undefined,
  configuredSecret: string | undefined,
): void {
  if (!configuredSecret?.trim()) {
    throw new ServiceUnavailableException(
      "FORGEOPS_PROVISION_SECRET no configurado en esta instancia",
    );
  }
  const token = extractBearerToken(authorizationHeader);
  if (!token || !secretsEqual(token, configuredSecret.trim())) {
    throw new UnauthorizedException("Credenciales ForgeOps inválidas");
  }
}
