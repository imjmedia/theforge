import { api } from "@/utils/apiClient";
import {
  parseApiErrorPayload,
  parseErrorMessageFromResponse,
} from "@/utils/httpError";
import type {
  ChatImagePart,
  CompileDesignContractBody,
  DesignReadResponse,
  DesignSpec,
  DesignSpecDataNeedsEntry,
  DesignSpecEntity,
  DesignSpecNavigation,
  DesignSpecScreen,
  PutDesignDataNeedsBody,
  PutDesignScreensBody,
} from "@theforge/shared-types";

const figmaBase = "/api/me/integrations/figma";

export type DesignProposalDiff = {
  add: { screens: DesignSpecScreen[]; navigation: DesignSpecNavigation[] };
  update: { screens: DesignSpecScreen[]; navigation: DesignSpecNavigation[] };
  remove: { screenIds: string[]; navigationIds: string[] };
  dataNeeds?: DesignSpecDataNeedsEntry[];
};

export type DesignProposalResponse = {
  proposalId: string;
  baseRevision: number;
  expiresAt: string;
  diff: DesignProposalDiff;
  issues: string[];
};

export type FigmaCredentialStatus = {
  connected: boolean;
  figmaHandle: string | null;
  lastValidatedAt: string | null;
};

export class DesignFirstApiError extends Error {
  readonly code?: string;
  readonly issues?: Array<{ path: string; message: string }>;
  readonly httpStatus?: number;

  constructor(
    message: string,
    opts?: { code?: string; issues?: Array<{ path: string; message: string }>; httpStatus?: number },
  ) {
    super(message);
    this.name = "DesignFirstApiError";
    this.code = opts?.code;
    this.issues = opts?.issues;
    this.httpStatus = opts?.httpStatus;
  }
}

async function ensureDesignOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text();
  const payload = parseApiErrorPayload(text, fallback, res.status);
  let issues: Array<{ path: string; message: string }> | undefined;
  try {
    const data = JSON.parse(text) as {
      message?: { issues?: Array<{ path: string; message: string }> };
    };
    if (Array.isArray(data.message?.issues)) {
      issues = data.message.issues;
    }
  } catch {
    /* ignore */
  }
  throw new DesignFirstApiError(payload.message, {
    code: payload.code,
    httpStatus: res.status,
    issues,
  });
}

function projectDesignBase(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/design`;
}

export async function fetchDesignState(projectId: string): Promise<DesignReadResponse> {
  const res = await api.get(projectDesignBase(projectId));
  await ensureDesignOk(res, "No se pudo cargar el diseño");
  return res.json() as Promise<DesignReadResponse>;
}

export async function putDesignScreens(
  projectId: string,
  body: PutDesignScreensBody,
): Promise<DesignReadResponse> {
  const res = await api.put(`${projectDesignBase(projectId)}/screens`, body);
  await ensureDesignOk(res, "No se pudieron guardar las pantallas");
  return res.json() as Promise<DesignReadResponse>;
}

export async function putDesignDataNeeds(
  projectId: string,
  body: PutDesignDataNeedsBody,
): Promise<DesignReadResponse> {
  const res = await api.put(`${projectDesignBase(projectId)}/data-needs`, body);
  await ensureDesignOk(res, "No se pudieron guardar las necesidades de datos");
  return res.json() as Promise<DesignReadResponse>;
}

export async function compileDesignContract(
  projectId: string,
  body: CompileDesignContractBody,
): Promise<DesignReadResponse> {
  const res = await api.post(`${projectDesignBase(projectId)}/compile-contract`, body);
  await ensureDesignOk(res, "No se pudo compilar el contrato");
  return res.json() as Promise<DesignReadResponse>;
}

export async function proposeDesignDataNeeds(projectId: string): Promise<DesignProposalResponse> {
  const res = await api.post(`${projectDesignBase(projectId)}/data-needs/propose`);
  await ensureDesignOk(res, "No se pudo proponer necesidades de datos");
  return res.json() as Promise<DesignProposalResponse>;
}

export async function importDesignImages(
  projectId: string,
  body: { images: ChatImagePart[]; hint?: string },
): Promise<DesignProposalResponse> {
  const res = await api.post(`${projectDesignBase(projectId)}/import/images`, body);
  await ensureDesignOk(res, "No se pudieron importar las imágenes");
  return res.json() as Promise<DesignProposalResponse>;
}

export async function importDesignFigma(
  projectId: string,
  body: { fileUrl: string; nodeIds?: string[] },
): Promise<DesignProposalResponse> {
  const res = await api.post(`${projectDesignBase(projectId)}/import/figma`, body);
  await ensureDesignOk(res, "No se pudo importar desde Figma");
  return res.json() as Promise<DesignProposalResponse>;
}

export async function acceptDesignProposal(
  projectId: string,
  proposalId: string,
  revision: number,
): Promise<DesignReadResponse> {
  const res = await api.post(`${projectDesignBase(projectId)}/proposals/${encodeURIComponent(proposalId)}/accept`, {
    revision,
  });
  await ensureDesignOk(res, "No se pudo aceptar la propuesta");
  return res.json() as Promise<DesignReadResponse>;
}

export async function rejectDesignProposal(
  projectId: string,
  proposalId: string,
): Promise<{ ok: true }> {
  const res = await api.post(`${projectDesignBase(projectId)}/proposals/${encodeURIComponent(proposalId)}/reject`);
  await ensureDesignOk(res, "No se pudo rechazar la propuesta");
  return res.json() as Promise<{ ok: true }>;
}

export async function fetchFigmaIntegrationStatus(): Promise<FigmaCredentialStatus> {
  const res = await api.get(figmaBase);
  if (!res.ok) {
    throw new Error(await parseErrorMessageFromResponse(res, "No se pudo consultar Figma"));
  }
  return res.json() as Promise<FigmaCredentialStatus>;
}

export async function upsertFigmaIntegrationToken(token: string): Promise<FigmaCredentialStatus> {
  const res = await api.put(figmaBase, { token });
  if (!res.ok) {
    throw new Error(await parseErrorMessageFromResponse(res, "No se pudo guardar el token de Figma"));
  }
  return res.json() as Promise<FigmaCredentialStatus>;
}

export async function deleteFigmaIntegration(): Promise<{ ok: true }> {
  const res = await api.delete(figmaBase);
  if (!res.ok) {
    throw new Error(await parseErrorMessageFromResponse(res, "No se pudo desconectar Figma"));
  }
  return res.json() as Promise<{ ok: true }>;
}

export type { DesignSpec, DesignSpecEntity, PutDesignScreensBody, PutDesignDataNeedsBody };
