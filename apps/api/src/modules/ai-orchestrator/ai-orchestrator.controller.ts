import { BadRequestException, Body, Controller, Post, Res } from "@nestjs/common";
import type { WorkshopChatScope } from "@theforge/shared-types";
import { AiOrchestratorService } from "./ai-orchestrator.service.js";
import { parseChatImageAttachments } from "../ai/utils/chat-image-attachments.util.js";
import { writeSseFromAsyncGenerator, type SseWritable } from "./sse-stream.util.js";

/** Minimal type for SSE response (avoids express types). */
interface SseResponse extends SseWritable {
  setHeader(name: string, value: string | number): void;
  end(cb?: () => void): void;
  flushHeaders(): void;
}

function parseChatScope(raw: unknown): WorkshopChatScope | undefined {
  return raw === "stage" || raw === "global" ? raw : undefined;
}

@Controller("ai-orchestrator")
export class AiOrchestratorController {
  constructor(private readonly orchestrator: AiOrchestratorService) { }

  @Post("chat")
  chat(
    @Body()
    body: {
      projectId: string;
      sessionId?: string;
      message: string;
      mddContent?: string | null;
      uxUiGuideContent?: string | null;
      dbgaContent?: string | null;
      brdContent?: string | null;
      activeTab?: string;
      stageId?: string;
      chatScope?: WorkshopChatScope;
      images?: unknown;
    },
  ) {
    const {
      projectId,
      sessionId,
      message,
      mddContent,
      uxUiGuideContent,
      dbgaContent,
      brdContent,
      activeTab,
      stageId,
    } = body;
    const images = parseChatImageAttachments(body.images);
    const msg = typeof message === "string" ? message.trim() : "";
    if (!projectId || (!msg && !images.length)) {
      throw new BadRequestException("projectId and message or images are required");
    }
    return this.orchestrator.chat(
      projectId,
      msg,
      sessionId,
      mddContent?.trim() || undefined,
      activeTab?.trim() || undefined,
      uxUiGuideContent?.trim() || undefined,
      dbgaContent?.trim() || undefined,
      brdContent?.trim() || undefined,
      stageId?.trim() || undefined,
      parseChatScope(body.chatScope),
      images,
    );
  }

  @Post("chat/stream")
  async chatStream(
    @Body()
    body: {
      projectId: string;
      sessionId?: string;
      message: string;
      mddContent?: string | null;
      uxUiGuideContent?: string | null;
      dbgaContent?: string | null;
      specContent?: string | null;
      brdContent?: string | null;
      architectureContent?: string | null;
      blueprintContent?: string | null;
      useCasesContent?: string | null;
      userStoriesContent?: string | null;
      apiContractsContent?: string | null;
      logicFlowsContent?: string | null;
      tasksContent?: string | null;
      infraContent?: string | null;
      activeTab?: string;
      stageId?: string;
      chatScope?: WorkshopChatScope;
      images?: unknown;
    },
    @Res({ passthrough: false }) res: SseResponse,
  ) {
    const {
      projectId,
      sessionId,
      message,
      mddContent,
      uxUiGuideContent,
      dbgaContent,
      specContent,
      brdContent,
      activeTab,
      stageId,
      architectureContent,
      blueprintContent,
      useCasesContent,
      userStoriesContent,
      apiContractsContent,
      logicFlowsContent,
      tasksContent,
      infraContent,
    } = body;
    const images = parseChatImageAttachments(body.images);
    const msg = typeof message === "string" ? message.trim() : "";
    if (!projectId || (!msg && !images.length)) {
      throw new BadRequestException("projectId and message or images are required");
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    try {
      const stream = this.orchestrator.chatStream(
        projectId,
        msg,
        sessionId?.trim(),
        mddContent?.trim() || undefined,
        activeTab?.trim() || undefined,
        uxUiGuideContent?.trim() || undefined,
        dbgaContent?.trim() || undefined,
        specContent?.trim() || undefined,
        brdContent?.trim() || undefined,
        stageId?.trim() || undefined,
        {
          architectureContent: architectureContent?.trim() || undefined,
          blueprintContent: blueprintContent?.trim() || undefined,
          useCasesContent: useCasesContent?.trim() || undefined,
          userStoriesContent: userStoriesContent?.trim() || undefined,
          apiContractsContent: apiContractsContent?.trim() || undefined,
          logicFlowsContent: logicFlowsContent?.trim() || undefined,
          tasksContent: tasksContent?.trim() || undefined,
          infraContent: infraContent?.trim() || undefined,
        },
        parseChatScope(body.chatScope),
        images,
      );
      await writeSseFromAsyncGenerator(res, stream);
    } catch (err) {
      const payload = JSON.stringify({
        error: err instanceof Error ? err.message : "Error en el stream",
      });
      res.write(`event: error\ndata: ${payload}\n\n`);
    } finally {
      res.end();
    }
  }

  @Post("welcome")
  welcome(
    @Body()
    body: {
      projectId: string;
      sessionId?: string;
      activeTab?: string;
      stageId?: string;
      chatScope?: WorkshopChatScope;
    },
  ) {
    const { projectId, sessionId, activeTab, stageId } = body ?? {};
    if (!projectId?.trim()) {
      throw new BadRequestException("projectId is required");
    }
    return this.orchestrator.welcome(
      projectId.trim(),
      sessionId?.trim(),
      activeTab?.trim(),
      stageId?.trim(),
      parseChatScope(body.chatScope),
    );
  }

  @Post("clear-chat")
  clearChat(@Body() body: { projectId: string; sessionId?: string }) {
    const { projectId, sessionId } = body ?? {};
    if (!projectId?.trim()) {
      throw new BadRequestException("projectId is required");
    }
    return this.orchestrator.clearChat(projectId.trim(), sessionId?.trim());
  }
}
