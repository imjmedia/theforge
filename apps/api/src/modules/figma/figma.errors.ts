import {
  BadRequestException,
  HttpException,
  PayloadTooLargeException,
  PreconditionFailedException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";

export function throwFigmaNotConnected(): never {
  throw new PreconditionFailedException({
    code: "ERR_FIGMA_NOT_CONNECTED",
    message: "Conecta tu token personal de Figma en Ajustes antes de importar",
  });
}

export function throwFigmaUrlInvalid(detail?: string): never {
  throw new BadRequestException({
    code: "ERR_FIGMA_URL",
    message: detail ?? "La URL de Figma no es válida o no incluye un fileKey reconocible",
  });
}

export function throwFigmaNoFrames(): never {
  throw new UnprocessableEntityException({
    code: "ERR_FIGMA_NO_FRAMES",
    message: "El archivo de Figma no contiene frames importables",
  });
}

export function throwFigmaTokenInvalid(): never {
  throw new UnauthorizedException({
    code: "ERR_FIGMA_TOKEN_INVALID",
    message: "El token de Figma es inválido o expiró; vuelve a conectar tu cuenta",
  });
}

export function throwFigmaRateLimit(retryAfterSec: number): never {
  throw new ServiceUnavailableException({
    code: "ERR_FIGMA_RATE_LIMIT",
    message: "Figma limitó las peticiones; inténtalo más tarde",
    retryAfterSec,
  });
}

export function throwFigmaTooManyNodes(max: number, count: number): never {
  throw new PayloadTooLargeException({
    code: "ERR_FIGMA_TOO_MANY_NODES",
    message: `El archivo tiene ${count} nodos; el máximo permitido es ${max}`,
    maxNodes: max,
    nodeCount: count,
  });
}

export function isFigmaTokenInvalid(err: unknown): err is HttpException {
  if (!(err instanceof UnauthorizedException)) return false;
  const body = err.getResponse();
  return typeof body === "object" && body != null && (body as { code?: string }).code === "ERR_FIGMA_TOKEN_INVALID";
}
