import {
  BadRequestException,
  ConflictException,
  HttpException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";

export function throwDesignFirstNotAllowed(): never {
  throw new BadRequestException({
    code: "ERR_DESIGN_FIRST_NOT_ALLOWED",
    message: "Este proyecto no está en modo Design-First",
  });
}

export function throwDesignFirstDisabled(): never {
  throw new BadRequestException({
    code: "ERR_DESIGN_FIRST_DISABLED",
    message: "Design-First no está habilitado en este entorno",
  });
}

export function throwDesignFirstWritesDisabled(): never {
  throw new ServiceUnavailableException({
    code: "ERR_DESIGN_FIRST_DISABLED",
    message: "Design-First está deshabilitado; la lectura sigue disponible",
  });
}

export function throwDesignRevisionConflict(currentRevision: number): never {
  throw new ConflictException({
    code: "ERR_DESIGN_REVISION_CONFLICT",
    message: "La revisión del diseño cambió; recarga y vuelve a intentar",
    currentRevision,
  });
}

export function throwDesignPhaseGate(message: string): never {
  throw new ConflictException({
    code: "ERR_DESIGN_PHASE_GATE",
    message,
  });
}

export function throwDesignStale(): never {
  throw new ConflictException({
    code: "ERR_DESIGN_STALE",
    message: "El diseño cambió después de compilar el contrato; vuelve a compilar antes de continuar",
  });
}

export function throwDesignInvariantIssues(
  issues: Array<{ path: string; message: string }>,
): never {
  throw new UnprocessableEntityException({
    code: "ERR_DESIGN_INVARIANT",
    message: "El diseño no cumple las invariantes requeridas",
    issues,
  });
}

export function throwDesignSpecTooLarge(maxBytes: number, actualBytes: number): never {
  throw new PayloadTooLargeException({
    code: "ERR_DESIGN_SPEC_TOO_LARGE",
    message: `El designSpec supera el límite de ${maxBytes} bytes (${actualBytes} bytes)`,
    maxBytes,
    actualBytes,
  });
}

export function throwDesignScreenReferences(
  screenId: string,
  references: string[],
  cascade?: boolean,
): never {
  throw new UnprocessableEntityException({
    code: "ERR_DESIGN_SCREEN_REFERENCED",
    message: cascade
      ? "Confirma cascade=true para eliminar la pantalla y sus referencias"
      : `No se puede eliminar la pantalla «${screenId}» porque está referenciada`,
    screenId,
    references,
  });
}

export function throwOpenApiInvalid(
  issues: Array<{ path: string; message: string }>,
): never {
  throw new UnprocessableEntityException({
    code: "ERR_OPENAPI_INVALID",
    message: "El OpenAPI generado no es válido",
    issues,
  });
}

export function throwPagCompileInvalid(
  issues: Array<{ path: string; message: string }>,
): never {
  throw new UnprocessableEntityException({
    code: "ERR_PAG_INVALID",
    message: "El PAG compilado no es válido",
    issues,
  });
}

export function throwDesignFirstScreensOwned(): never {
  throw new ConflictException({
    code: "ERR_DESIGN_FIRST_SCREENS_OWNED",
    message:
      "Las pantallas de este proyecto se gestionan desde Design-First; no uses la sincronización UI MCP",
  });
}

export function isDesignRevisionConflict(err: unknown): err is HttpException {
  if (!(err instanceof ConflictException)) return false;
  const body = err.getResponse();
  return typeof body === "object" && body != null && (body as { code?: string }).code === "ERR_DESIGN_REVISION_CONFLICT";
}
