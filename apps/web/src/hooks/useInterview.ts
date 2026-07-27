import { useCallback } from "react";
import type { ChatImagePart } from "@theforge/shared-types";
import {
  useWorkshopStore,
  type ChatMessage,
  type Project,
  type Session,
} from "../store/workshopStore";
import { filterWorkshopSessionMessages } from "../store/workshop/helpers/session-message";

export interface UseInterviewReturn {
  messages: ChatMessage[];
  project: Project | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  /** options.regenerateSection: para comandos / (solo tab MDD). options.images: adjuntos visión. */
  sendMessage: (
    message: string,
    options?: { regenerateSection?: number; regenerateSectionGaps?: string[]; images?: ChatImagePart[] },
  ) => Promise<void>;
}

export function useInterview(
  _projectId: string | null,
  activeTab?: string,
): UseInterviewReturn {
  const project = useWorkshopStore((s) => s.project);
  const sessionRaw = useWorkshopStore((s) => s.session);
  const session =
    sessionRaw && project?.id && sessionRaw.projectId !== project.id ? null : sessionRaw;
  const loading = useWorkshopStore((s) => s.loading);
  const error = useWorkshopStore((s) => s.error);
  const sendMessageStore = useWorkshopStore((s) => s.sendMessage);

  const activeTabNorm = activeTab ?? "mdd";
  const streamingUserMessage = useWorkshopStore((s) => s.streamingUserMessage);
  const streamingUserImages = useWorkshopStore((s) => s.streamingUserImages);
  const streamingContent = useWorkshopStore((s) => s.streamingContent);
  const streamingTab = useWorkshopStore((s) => s.streamingTab);
  const activeStageId = useWorkshopStore((s) => s.activeStageId);
  const chatScope = useWorkshopStore((s) => s.chatScope);

  const baseMessages = filterWorkshopSessionMessages(
    session?.chatLog,
    activeTabNorm,
    activeStageId,
    chatScope,
  ) as ChatMessage[];
  const messages =
    streamingUserMessage != null && (streamingTab ?? "mdd") === activeTabNorm
      ? [
          ...baseMessages,
          {
            role: "user" as const,
            content: streamingUserMessage,
            tab: activeTabNorm,
            ...(activeStageId ? { stageId: activeStageId } : {}),
            ...(streamingUserImages?.length ? { images: streamingUserImages } : {}),
          },
          {
            role: "assistant" as const,
            content: streamingContent ?? "",
            tab: activeTabNorm,
            ...(activeStageId ? { stageId: activeStageId } : {}),
          },
        ]
      : baseMessages;

  const send = useCallback(
    (message: string, options?: { regenerateSection?: number; regenerateSectionGaps?: string[]; images?: ChatImagePart[] }) =>
      sendMessageStore(message, activeTab, options),
    [sendMessageStore, activeTab],
  );

  return {
    messages,
    project,
    session,
    loading,
    error,
    sendMessage: send,
  };
}
