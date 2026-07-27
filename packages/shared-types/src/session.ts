import { z } from "zod";

/** Parte de imagen en base64 (sin prefijo `data:`); el API valida MIME y tamaño. */
export const chatImagePartSchema = z.object({
  mimeType: z.string().min(3).max(80),
  base64: z.string().min(1),
});

export type ChatImagePart = z.infer<typeof chatImagePartSchema>;

/** Cabecera del bloque de interpretación de visión persistido en `content` del mensaje user. */
export const VISION_CONTEXT_HEADER =
  "--- Contexto de imagen(es) adjunta(s) (interpretación) ---";

export function contentIncludesVisionBlock(content: string): boolean {
  return content.includes(VISION_CONTEXT_HEADER);
}

const chatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    /** Capturas o diagramas enviados por el usuario (solo rol `user`). */
    images: z.array(chatImagePartSchema).max(6).optional(),
    tab: z.string().optional(),
    /** Etapa del Workshop cuando se envió el mensaje (filtrable con `filterChatByStage`). */
    stageId: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.role === "assistant" && val.images != null && val.images.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "assistant messages cannot include images",
        path: ["images"],
      });
    }
  });

export const contextStepEnum = ["CONTEXT", "DATA", "LOGIC", "SECURITY"] as const;
export type ContextStep = (typeof contextStepEnum)[number];

export const createSessionSchema = z.object({
  projectId: z.string().uuid(),
  contextStep: z.enum(contextStepEnum).default("CONTEXT"),
  chatLog: z.array(chatMessageSchema).default([]),
});

export const appendChatSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    images: z.array(chatImagePartSchema).max(6).optional(),
    tab: z.string().optional(),
    stageId: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.role === "assistant" && val.images != null && val.images.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "assistant messages cannot include images",
        path: ["images"],
      });
    }
  });

export const sessionResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  contextStep: z.enum(contextStepEnum),
  chatLog: z.array(chatMessageSchema),
  updatedAt: z.string().datetime(),
});

export type CreateSessionDto = z.infer<typeof createSessionSchema>;
export type AppendChatDto = z.infer<typeof appendChatSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Tab asociado a un mensaje; mensajes legacy sin tab se consideran "mdd". */
export function getMessageTab(m: ChatMessage): string {
  return m.tab ?? "mdd";
}

/** Filtra el chatLog para mostrar solo mensajes del tab indicado. */
export function filterChatByTab(log: ChatMessage[], tab: string): ChatMessage[] {
  return log.filter((m) => getMessageTab(m) === tab);
}

/** Vista del chat: solo etapa activa o historial completo del tab. */
export type WorkshopChatScope = "stage" | "global";

/** Por defecto filtra por etapa en brownfield (LEGACY) con más de una etapa. */
export function shouldDefaultWorkshopChatScopeByStage(
  projectType: "NEW" | "LEGACY" | undefined,
  stageCount: number,
): boolean {
  return stageCount > 1 && projectType === "LEGACY";
}

/** Resuelve alcance del chat (explícito del usuario o default por tipo de proyecto). */
export function resolveWorkshopChatScope(
  projectType: "NEW" | "LEGACY" | undefined,
  stageCount: number,
  explicit?: WorkshopChatScope | null,
): WorkshopChatScope {
  if (explicit === "stage" || explicit === "global") return explicit;
  return shouldDefaultWorkshopChatScopeByStage(projectType, stageCount) ? "stage" : "global";
}

/** Mensajes de una etapa concreta (excluye sin `stageId` y de otras etapas). */
export function filterChatByStage(log: ChatMessage[], stageId: string | null | undefined): ChatMessage[] {
  const sid = (stageId ?? "").trim();
  if (!sid) return log;
  return log.filter((m) => (m.stageId ?? "").trim() === sid);
}

/** Tab + alcance opcional por etapa (UI y contexto LLM). */
export function filterChatForWorkshopView(
  log: ChatMessage[],
  tab: string,
  options?: { stageId?: string | null; scope?: WorkshopChatScope },
): ChatMessage[] {
  const byTab = filterChatByTab(log, tab);
  if (options?.scope !== "stage") return byTab;
  return filterChatByStage(byTab, options.stageId);
}
