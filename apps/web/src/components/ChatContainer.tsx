import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
  useCallback,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  LEGACY_CODEBASE_DOC_STEPS,
  LEGACY_MDD_STEPS,
  LEGACY_BRD_SUGGEST_STEPS,
  BRD_FROM_DBGA_STEPS,
  LEGACY_DELIVERABLES_STEPS,
} from "../constants/legacy-workshop-loading-steps";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessageSquare, Send, Loader2, Trash2, Target, Play, Pencil, X, RefreshCw, ImagePlus, Mic, ChevronDown, Rocket } from "lucide-react";
import { apiFetch } from "../utils/apiClient";
import { useInterview } from "../hooks/useInterview";
import { useWorkshopStore } from "../store/workshopStore";
import { cn } from "@/lib/utils";
import type { ChatImagePart } from "@theforge/shared-types";
import { filterChatForWorkshopView } from "@theforge/shared-types";
import { VISION_CONTEXT_HEADER } from "@theforge/shared-types/session";
import { MDD_LONG_PASTE_WARN_CHARS } from "@theforge/shared-types/mdd-pipeline-limits";
import {
  isWorkshopFrozenDeliverableTab,
  workshopFrozenTabUserMessage,
} from "@theforge/shared-types";
import { handleChatComposerEnterKeyDown } from "../utils/chatComposerEnter";
import {
  Button,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui";
import { WorkshopChatToolbarIconButton, WorkshopButtonIcon, WorkshopPanelButton } from "@/components/WorkshopButtons";
import {
  APP_PANEL_FOOTER_CHROME,
  APP_PANEL_FOOTER_H,
  APP_PANEL_FOOTER_PY,
  WORKSHOP_CHAT_INSET_X,
  WORKSHOP_COLUMN_HEADER_ICON,
  WORKSHOP_COLUMN_HEADER_ICON_SLOT,
} from "@/constants/workshopDocToolbar";
import { ChatProviderInfoButton } from "@/components/ChatProviderInfoButton";
import { AiGenerationChatBubble } from "./AiGenerationLoader";
import { WorkshopAgentProgressPanel } from "./WorkshopAgentProgressPanel";
import { PLAN_NODE_LABELS } from "@/utils/planApprovalChat";
import {
  MDD_SECTION_COMMANDS,
  resolveRegenerateSectionFromChatMessage,
} from "../utils/mddSectionRegen";
import {
  FORMAT_DOCUMENT_COMMAND,
  formatDocumentCommandFilter,
  isFormatDocumentChatCommand,
} from "../utils/documentFormatCommand";

export type ActiveTab =
  | "benchmark"
  | "legacy"
  | "mdd-inicial"
  | "spec"
  | "brd"
  | "mdd"
  | "ux-ui-guide"
  | "blueprint"
  | "tasks"
  | "api-contracts"
  | "logic-flows"
  | "architecture"
  | "use-cases"
  | "user-stories"
  | "infra"
  | "handoff-spec"
  | "adrs";

const ACTIVE_TAB_LABELS: Record<ActiveTab, string> = {
  benchmark: "Benchmark & Gap Analysis (Paso 0, opcional)",
  legacy: "Modificación (Legacy)",
  "mdd-inicial": "MDD Inicial (documentación de partida)",
  spec: "Spec",
  brd: "BRD (etapa)",
  mdd: "MDD",
  "ux-ui-guide": "Design System",
  blueprint: "Blueprint",
  tasks: "Tasks",
  "api-contracts": "Contratos de API",
  "logic-flows": "Flujos de lógica",
  architecture: "Arquitectura",
  "use-cases": "Casos de Uso",
  "user-stories": "Historias de Usuario",
  infra: "Infraestructura",
  "handoff-spec": "Handoff Spec",
  adrs: "Decisiones Arquitectónicas (ADRs)",
};

/**
 * Short chat composer placeholders. Full stage names stay in the chat header (`contextLabel`).
 */
const CHAT_COMPOSER_PLACEHOLDER: Record<ActiveTab, string> = {
  benchmark: "Idea, alcance o enlaces…",
  legacy: "Qué cambiar o ampliar…",
  "mdd-inicial": "Indicaciones para la partida…",
  spec: "Mensaje sobre el Spec…",
  brd: "Mensaje sobre el BRD…",
  mdd: "Mensaje o /sección…",
  "ux-ui-guide": "Marca, tokens o componentes…",
  blueprint: "Mensaje sobre el Blueprint…",
  tasks: "Mensaje sobre Tasks…",
  "api-contracts": "Ajustes a contratos API…",
  "logic-flows": "Flujos o reglas…",
  architecture: "Mensaje sobre arquitectura…",
  "use-cases": "Escenarios o actores…",
  "user-stories": "Historias o criterios…",
  infra: "Despliegue o infra…",
  "handoff-spec": "Mensaje sobre el Handoff Spec…",
  adrs: "Decisiones técnicas…",
};

const TABS_WITH_FORMAT_COMMAND: ReadonlySet<ActiveTab> = new Set([
  "benchmark",
  "mdd-inicial",
  "legacy",
  "spec",
  "brd",
  "mdd",
  "ux-ui-guide",
  "blueprint",
  "tasks",
  "api-contracts",
  "logic-flows",
  "architecture",
  "use-cases",
  "user-stories",
  "infra",
  "handoff-spec",
]);

function getChatComposerPlaceholder(isBenchmarkFirstAction: boolean, activeTab: ActiveTab): string {
  if (isBenchmarkFirstAction) return "Dominio, idea y enlaces (opcional)…";
  const base =
    activeTab === "mdd"
      ? "Mensaje, /formatear o /sección…"
      : CHAT_COMPOSER_PLACEHOLDER[activeTab];
  if (TABS_WITH_FORMAT_COMMAND.has(activeTab) && !isBenchmarkFirstAction) {
    return `${base} · /formatear`;
  }
  return base;
}

const ACCEPT_IMG = /^image\/(png|jpeg|jpg|gif|webp)$/i;

function splitUserChatContent(content: string): { text: string; vision?: string } {
  const idx = content.indexOf(VISION_CONTEXT_HEADER);
  if (idx < 0) return { text: content };
  const vision = content.slice(idx + VISION_CONTEXT_HEADER.length).replace(/^\n+/, "").trim();
  const text = content.slice(0, idx).trimEnd();
  return { text, vision: vision || undefined };
}

/** Assistant messages may include literal `<br>` in table cells; normalize to line breaks for GFM. */
function normalizeChatMarkdown(content: string): string {
  return content.replace(/<br\s*\/?>/gi, "\n");
}

const CHAT_MARKDOWN_COMPONENTS = {
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border border-[var(--border)] [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
      <table className="w-full min-w-[18rem] border-collapse text-left text-xs" {...props} />
    </div>
  ),
  th: (props: ComponentPropsWithoutRef<"th">) => (
    <th
      className="border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_42%,var(--card))] px-2 py-1.5 text-left align-top font-medium break-words"
      {...props}
    />
  ),
  td: (props: ComponentPropsWithoutRef<"td">) => (
    <td
      className="border border-[var(--border)] px-2 py-1.5 align-top break-words [overflow-wrap:anywhere]"
      {...props}
    />
  ),
  pre: (props: ComponentPropsWithoutRef<"pre">) => (
    <pre
      className="my-2 max-w-full overflow-x-auto rounded-md border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_78%,var(--card))] p-3 text-xs"
      {...props}
    />
  ),
};

/** Single bordered “AI bar”: attach + textarea + send share one surface (Claude/ChatGPT-style unified chrome). */
/** Máx. altura del textarea antes de scroll interno (solo pegas enormes); el shell crece hacia arriba con el contenido. */
const AI_COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 420;
/** Una línea (min-h 1.75rem + py); evita inflar scrollHeight con input vacío. */
const AI_COMPOSER_TEXTAREA_MIN_HEIGHT_PX = 28;

const AI_COMPOSER_SHELL =
  "flex w-full min-w-0 flex-col gap-1 rounded-[1.25rem] border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_92%,var(--muted))] px-3 py-2.5 shadow-sm transition-[border-color,background-color] focus-within:border-[color-mix(in_oklch,var(--primary)_30%,var(--border))] focus-within:bg-[color-mix(in_oklch,var(--card)_96%,var(--muted))] dark:bg-[color-mix(in_oklch,var(--card)_62%,var(--muted))] dark:focus-within:bg-[color-mix(in_oklch,var(--card)_72%,var(--muted))]";

const AI_COMPOSER_TEXTAREA =
  "min-h-[1.75rem] w-full resize-none border-0 bg-transparent px-0 py-0.5 text-base leading-6 text-[var(--foreground)] shadow-none outline-none ring-0 appearance-none break-words overflow-y-hidden overflow-x-hidden placeholder:text-[var(--muted-foreground)] focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0";

const AI_COMPOSER_TOOLBAR =
  "flex min-h-9 w-full shrink-0 items-center justify-between gap-2";

const AI_COMPOSER_ATTACH_BTN =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--primary)] disabled:pointer-events-none disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-0";

const AI_COMPOSER_SEND_BTN =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-none transition-[opacity,transform] hover:opacity-90 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-0";

/** Matches Phase0InterviewPanel and other workshop panel textareas. */
const WORKSHOP_COMPOSER_TEXTAREA =
  "w-full shrink-0 overflow-x-hidden bg-[color-mix(in_oklch,var(--muted)_50%,var(--card))] border border-[var(--border)] rounded-lg p-3 text-sm leading-relaxed text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent outline-none resize-none";

const BENCHMARK_COMPOSER_TEXTAREA_MIN_HEIGHT_PX = 100;

function ChatComposerSubmit({
  loading,
  disabled,
  onSend,
}: {
  loading: boolean;
  disabled: boolean;
  onSend: () => void;
}) {
  return (
    <button
      type="button"
      className={AI_COMPOSER_SEND_BTN}
      onClick={onSend}
      disabled={disabled}
      title="Enviar"
      aria-label="Enviar mensaje"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
      ) : (
        <Send className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
      )}
    </button>
  );
}

function ChatComposerBar({
  chatInputRef,
  inputValue,
  onInputChange,
  onKeyDown,
  placeholder,
  inputTitle,
  loading,
  isBenchmarkFirstAction,
  showAttachTools,
  textareaDisabled,
  imageInputRef,
  imageAttachDisabled,
  imageAttachTitle,
  imageAttachAriaLabel,
  sttMicDisabled,
  sttMicTitle,
  sttMicAriaLabel,
  recording,
  onMicClick,
  submitDisabled,
  onSend,
  onGenerateBenchmark,
}: {
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  inputValue: string;
  onInputChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  inputTitle?: string;
  loading: boolean;
  isBenchmarkFirstAction: boolean;
  showAttachTools: boolean;
  /** When set, overrides textarea disabled state (send button still uses `loading`). */
  textareaDisabled?: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  imageAttachDisabled: boolean;
  imageAttachTitle: string;
  imageAttachAriaLabel: string;
  sttMicDisabled: boolean;
  sttMicTitle: string;
  sttMicAriaLabel: string;
  recording: boolean;
  onMicClick: () => void;
  submitDisabled: boolean;
  onSend: () => void;
  onGenerateBenchmark: () => void;
}) {
  if (isBenchmarkFirstAction) {
    return (
      <div className="flex flex-col gap-3" role="group" aria-label="Idea para benchmark">
        <textarea
          ref={chatInputRef as RefObject<HTMLTextAreaElement>}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          title={inputTitle}
          rows={3}
          className={WORKSHOP_COMPOSER_TEXTAREA}
          spellCheck={false}
          disabled={textareaDisabled ?? loading}
        />
        <div className="flex shrink-0 gap-2">
          <WorkshopPanelButton
            tone="primary"
            onClick={onGenerateBenchmark}
            disabled={submitDisabled}
            loading={loading}
            title="Generar Benchmark & Gap Analysis"
            aria-label="Generar Benchmark & Gap Analysis"
          >
            {!loading ? <WorkshopButtonIcon icon={Rocket} tone="primary" /> : null}
            Generar
          </WorkshopPanelButton>
        </div>
      </div>
    );
  }

  return (
    <div className={AI_COMPOSER_SHELL} role="group" aria-label="Mensaje al asistente">
      <textarea
        ref={chatInputRef as RefObject<HTMLTextAreaElement>}
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        title={inputTitle}
        rows={1}
        className={cn(AI_COMPOSER_TEXTAREA, "font-sans")}
        spellCheck={false}
        disabled={textareaDisabled ?? loading}
      />
      <div className={AI_COMPOSER_TOOLBAR}>
        <div className="flex min-w-0 items-center gap-0.5">
          {showAttachTools ? (
            <>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={imageAttachDisabled}
                className={AI_COMPOSER_ATTACH_BTN}
                title={imageAttachTitle}
                aria-label={imageAttachAriaLabel}
              >
                <ImagePlus className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden />
              </button>
              <button
                type="button"
                onClick={onMicClick}
                disabled={sttMicDisabled}
                className={cn(
                  AI_COMPOSER_ATTACH_BTN,
                  recording && "text-[var(--destructive)] animate-pulse",
                )}
                title={sttMicTitle}
                aria-label={sttMicAriaLabel}
              >
                <Mic
                  className={cn(
                    "h-[1.125rem] w-[1.125rem] shrink-0",
                    recording && "text-[var(--destructive)]",
                  )}
                  aria-hidden
                />
              </button>
            </>
          ) : null}
        </div>
        <ChatComposerSubmit
          loading={loading}
          disabled={submitDisabled}
          onSend={onSend}
        />
      </div>
    </div>
  );
}

async function readFilesAsChatParts(files: Iterable<File>): Promise<ChatImagePart[]> {
  const list = Array.from(files).slice(0, 6);
  const out: ChatImagePart[] = [];
  for (const file of list) {
    const mimeRaw = file.type || "image/png";
    const mime = mimeRaw.toLowerCase() === "image/jpg" ? "image/jpeg" : mimeRaw.toLowerCase();
    if (!ACCEPT_IMG.test(mime)) continue;
    const b64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result ?? "");
        const i = s.indexOf("base64,");
        resolve(i >= 0 ? s.slice(i + 7) : s);
      };
      r.onerror = () => reject(new Error("read"));
      r.readAsDataURL(file);
    });
    out.push({ mimeType: mime, base64: b64 });
  }
  return out;
}

type PlanStep = { step_id: string; task_description: string; node: string; goal?: string };

function PlanApprovalCard({
  planMessage,
  plan,
  loading,
  onExecute,
  onModify,
}: {
  planMessage: string;
  plan: PlanStep[];
  loading: boolean;
  onExecute: () => void;
  onModify: () => void;
}) {
  return (
    <div className="mx-4 mb-2 p-3 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/30 flex flex-col shrink-0">
      <div className="text-sm text-[var(--foreground)]/90 mb-3 shrink-0 prose prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0">
        <ReactMarkdown>{planMessage}</ReactMarkdown>
      </div>
      <p className="text-xs text-[var(--foreground-muted)] mb-1.5 font-medium shrink-0">Tareas y responsables:</p>
      <div className="mb-3 max-w-full overflow-x-auto [-webkit-overflow-scrolling:touch]">
        <table className="w-full min-w-[16rem] text-sm border-collapse">
          <thead>
            <tr className="text-left text-[var(--foreground-muted)] border-b border-[var(--border)]">
              <th className="py-1.5 pr-2 w-8">#</th>
              <th className="py-1.5 pr-2">Tarea</th>
              <th className="py-1.5">Responsable</th>
            </tr>
          </thead>
          <tbody className="text-[var(--foreground)]">
            {plan.map((step, i) => (
              <tr key={i} className="border-b border-[var(--border)]/50">
                <td className="py-1.5 pr-2 font-medium text-[var(--foreground-muted)]">{step.step_id}</td>
                <td className="py-1.5 pr-2">
                  <span>{step.task_description}</span>
                  {step.goal && (
                    <p className="text-xs text-[var(--foreground-subtle)] mt-0.5 font-normal">{step.goal}</p>
                  )}
                </td>
                <td className="py-1.5">
                  <span className="text-[var(--primary)]">
                    {PLAN_NODE_LABELS[step.node] ?? step.node}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button size="sm" onClick={onExecute} disabled={loading}>
          <Play className="w-3.5 h-3.5" />
          Ejecutar
        </Button>
        <Button variant="secondary" size="sm" onClick={onModify} disabled={loading}>
          <Pencil className="w-3.5 h-3.5" />
          Modificar
        </Button>
      </div>
    </div>
  );
}

interface ChatContainerProps {
  projectId: string | null;
  activeTab?: ActiveTab;
  /** Sin panel lateral: solo mensajes + input (ej. Paso 0 como ventana de chat) */
  embedded?: boolean;
  /** En Paso 0: si no hay benchmark, el CTA es "Generar Benchmark"; si hay, es enviar mensaje */
  benchmarkMode?: {
    hasBenchmark: boolean;
    onGenerateBenchmark: (idea: string) => void;
  };
  /** Re-inferir complejidad (HITL) y abrir entrevista; típico en proyectos existentes */
  onRevaluate?: () => void | Promise<void>;
  /** Evita doble clic mientras corre re-valoración + primer mensaje */
  revaluateBusy?: boolean;
  /** Abre ajustes desde el popover de proveedor activo */
  onOpenSettings?: () => void;
}

export default function ChatContainer({
  projectId,
  activeTab = "mdd",
  embedded = false,
  benchmarkMode,
  onRevaluate,
  revaluateBusy = false,
  onOpenSettings,
}: ChatContainerProps) {
  const { messages, loading, error, sendMessage } = useInterview(projectId, activeTab);
  const contextLabel = ACTIVE_TAB_LABELS[activeTab];
  const frozenDeliverableChat = isWorkshopFrozenDeliverableTab(activeTab);
  const clearChat = useWorkshopStore((s) => s.clearChat);
  const fetchWelcome = useWorkshopStore((s) => s.fetchWelcome);
  const session = useWorkshopStore((s) => s.session);
  const workshopStages = useWorkshopStore((s) => s.project?.stages ?? []);
  const activeStageIdForChat = useWorkshopStore((s) => s.activeStageId);
  const chatScope = useWorkshopStore((s) => s.chatScope);
  const setChatScope = useWorkshopStore((s) => s.setChatScope);
  const projectType = useWorkshopStore((s) => s.project?.projectType);
  const evaluatorCritique = useWorkshopStore((s) => s.evaluatorCritique);
  const clearEvaluatorCritique = useWorkshopStore((s) => s.clearEvaluatorCritique);
  const loadingReason = useWorkshopStore((s) => s.loadingReason);
  const agentProgress = useWorkshopStore((s) => s.agentProgress);
  const pendingPlanApproval = useWorkshopStore((s) => s.pendingPlanApproval);
  const phase0AssistedActive = useWorkshopStore((s) => s.phase0AssistedActive);
  const phase0AssistedTemplateLabel = useWorkshopStore((s) => s.phase0AssistedTemplateLabel);
  const phase0AssistedBootstrapMessage = useWorkshopStore((s) => s.phase0AssistedBootstrapMessage);
  const stopPhase0Assisted = useWorkshopStore((s) => s.stopPhase0Assisted);
  const isBenchmarkStreaming = activeTab === "benchmark" && loading && loadingReason === "benchmark";
  const isMddStreaming =
    loading && (loadingReason === "mdd" || loadingReason === "mdd-section");
  const showAgentProgress =
    isBenchmarkStreaming ||
    isMddStreaming ||
    loadingReason === "deliverables-cascade" ||
    loadingReason === "repair-sdd-gaps" ||
    loadingReason === "legacy-deliverables" ||
    loadingReason === "agent-governance" ||
    loadingReason === "tasks";
  /** Generación larga en segundo plano (mismo criterio que el panel central en WorkshopView). */
  const isLegacyLongRun =
    loading &&
    (loadingReason === "legacy-codebase-doc" ||
      loadingReason === "legacy-mdd" ||
      loadingReason === "legacy-as-is" ||
      loadingReason === "legacy-brd-suggest" ||
      loadingReason === "legacy-deliverables" ||
      loadingReason === "brd-from-dbga");
  /** Cascada BullMQ: el usuario puede redactar mientras corre; solo el envío queda bloqueado. */
  const isDeliverablesCascadeRun =
    loading &&
    (loadingReason === "deliverables-cascade" || loadingReason === "legacy-deliverables");
  const composerTextareaDisabled = loading && !isDeliverablesCascadeRun;
  const legacyRotatingSteps = useMemo(() => {
    if (loadingReason === "legacy-codebase-doc") return LEGACY_CODEBASE_DOC_STEPS;
    if (loadingReason === "legacy-mdd") return LEGACY_MDD_STEPS;
    if (loadingReason === "legacy-brd-suggest") return LEGACY_BRD_SUGGEST_STEPS;
    if (loadingReason === "brd-from-dbga") return BRD_FROM_DBGA_STEPS;
    if (loadingReason === "legacy-deliverables") return LEGACY_DELIVERABLES_STEPS;
    return LEGACY_CODEBASE_DOC_STEPS;
  }, [loadingReason]);
  const [legacyProgressIndex, setLegacyProgressIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const prevStageForBannerRef = useRef<string | null>(null);
  const welcomedTabRef = useRef<string | null>(null);
  const [stageSwitchBannerOpen, setStageSwitchBannerOpen] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const multiStageChat = workshopStages.length > 1;

  /** STT (speech‑to‑text) via mic */
  const [sttModel, setSttModel] = useState<string | null>(null);
  const [visionModel, setVisionModel] = useState<string | null>(null);
  const [mediaConfigLoaded, setMediaConfigLoaded] = useState(false);
  const [sttConfigLoaded, setSttConfigLoaded] = useState(false);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number>(0);

  const stageNameForBadge = useMemo(() => {
    return (stageId: string | undefined) => {
      if (!stageId) return "";
      const st = workshopStages.find((s) => s.id === stageId);
      return st ? String(st.name ?? st.key ?? "").trim() || `§${st.ordinal}` : stageId.slice(0, 8);
    };
  }, [workshopStages]);

  useEffect(() => {
    const tab = activeTab ?? "mdd";
    if (!projectId?.trim()) return;
    if (tab === "mdd") return;
    const welcomeTabs: ActiveTab[] = ["brd", "ux-ui-guide", "benchmark"];
    if (!welcomeTabs.includes(tab)) return;
    if (phase0AssistedActive && tab === "benchmark") return;
    if (!session?.id) {
      if (welcomedTabRef.current === tab) return;
      welcomedTabRef.current = tab;
      const t = window.setTimeout(() => {
        void fetchWelcome(projectId, tab);
      }, 120);
      return () => window.clearTimeout(t);
    }
    const count = filterChatForWorkshopView(session.chatLog ?? [], tab, {
      stageId: activeStageIdForChat,
      scope: chatScope,
    }).length;
    if (count > 0) return;
    // Evitar bucle infinito: si ya intentamos welcome para este tab sin éxito (sin mensaje agregado),
    // no reintentar. Ocurre cuando el backend decide no generar burbuja (ej. benchmark sin contenido).
    if (welcomedTabRef.current === tab) return;
    welcomedTabRef.current = tab;
    const t = window.setTimeout(() => {
      void fetchWelcome(projectId, tab);
    }, 120);
    return () => window.clearTimeout(t);
  }, [projectId, activeTab, session?.id, session?.chatLog, fetchWelcome, phase0AssistedActive, activeStageIdForChat, chatScope]);

  useEffect(() => {
    if (!multiStageChat || !activeStageIdForChat) {
      prevStageForBannerRef.current = activeStageIdForChat ?? null;
      setStageSwitchBannerOpen(false);
      return;
    }
    const prev = prevStageForBannerRef.current;
    if (chatScope === "global" && prev !== null && prev !== activeStageIdForChat) {
      setStageSwitchBannerOpen(true);
    }
    prevStageForBannerRef.current = activeStageIdForChat;
  }, [activeStageIdForChat, multiStageChat, chatScope]);

  useEffect(() => {
    if (!isLegacyLongRun) {
      setLegacyProgressIndex(0);
      return;
    }
    const steps = legacyRotatingSteps;
    const id = setInterval(() => setLegacyProgressIndex((i) => (i + 1) % steps.length), 6000);
    return () => clearInterval(id);
  }, [isLegacyLongRun, legacyRotatingSteps]);

  const isBenchmarkFirstAction =
    activeTab === "benchmark" && !!benchmarkMode && !benchmarkMode.hasBenchmark;

  /** Auto-resize: crece con el texto (el shell en el pie sube = sensación de “crecer hacia arriba”). Scroll solo si supera el techo. */
  useLayoutEffect(() => {
    function syncHeight() {
      const t = chatInputRef.current;
      if (!t) return;

      const isBenchComposer =
        activeTab === "benchmark" && !!benchmarkMode && !benchmarkMode.hasBenchmark;
      const minH = isBenchComposer
        ? BENCHMARK_COMPOSER_TEXTAREA_MIN_HEIGHT_PX
        : AI_COMPOSER_TEXTAREA_MIN_HEIGHT_PX;
      const viewportCap =
        typeof window !== "undefined"
          ? Math.floor(window.innerHeight * 0.45)
          : AI_COMPOSER_TEXTAREA_MAX_HEIGHT_PX;
      const maxH = Math.min(AI_COMPOSER_TEXTAREA_MAX_HEIGHT_PX, Math.max(160, viewportCap));

      if (!isBenchComposer && inputValue.trim().length === 0) {
        t.style.height = "";
        t.style.overflowY = "hidden";
        return;
      }

      t.style.height = "0px";
      const scrollH = t.scrollHeight;
      const next = Math.max(minH, Math.min(scrollH, maxH));
      t.style.height = `${next}px`;
      t.style.overflowY = scrollH > maxH ? "auto" : "hidden";
    }
    syncHeight();
    let resizeRaf = 0;
    const onWindowResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => syncHeight());
    };
    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
      cancelAnimationFrame(resizeRaf);
    };
  }, [inputValue, activeTab, benchmarkMode?.hasBenchmark]);

  /** En Paso 0 vacío: ocultar solo bienvenida del asistente hasta que el usuario escriba. Con DBGA o modo asistido, mostrar siempre el historial. */
  const benchmarkEmpty =
    activeTab === "benchmark" &&
    !phase0AssistedActive &&
    !benchmarkMode?.hasBenchmark &&
    (messages.length === 0 || messages.every((m) => m.role === "assistant"));
  const messagesToShow = useMemo(() => {
    let list = benchmarkEmpty && messages.length > 0 ? [] : messages;
    if (
      list.length === 0 &&
      phase0AssistedActive &&
      activeTab === "benchmark" &&
      phase0AssistedBootstrapMessage?.trim()
    ) {
      list = [
        { role: "user" as const, content: "Activar modo asistido", tab: "benchmark" },
        {
          role: "assistant" as const,
          content: phase0AssistedBootstrapMessage.trim(),
          tab: "benchmark",
        },
      ];
    }
    if (
      activeTab === "mdd" &&
      pendingPlanApproval?.plan.length &&
      pendingPlanApproval.planMessage.trim()
    ) {
      const planMsg = pendingPlanApproval.planMessage.trim();
      while (list.length > 0) {
        const last = list[list.length - 1];
        if (last?.role === "assistant" && (last.content?.trim() ?? "") === planMsg) {
          list = list.slice(0, -1);
        } else {
          break;
        }
      }
    }
    return list;
  }, [
    benchmarkEmpty,
    messages,
    activeTab,
    pendingPlanApproval,
    phase0AssistedActive,
    phase0AssistedBootstrapMessage,
  ]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (isNearBottom || loading || messagesToShow.length === 0) {
      chatEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [
    messagesToShow.length,
    agentProgress.length,
    loading,
    messagesToShow[messagesToShow.length - 1]?.content,
    evaluatorCritique,
    isLegacyLongRun,
    legacyProgressIndex,
  ]);

  /** Scroll to bottom on mount (after messages render). */
  useEffect(() => {
    const t = setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }, 200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const urls = pendingFiles.map((f) => URL.createObjectURL(f));
    setPendingPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [pendingFiles]);

  /** STT y visión desde instancia activa (GET /audio/config). */
  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch(
          `${import.meta.env.VITE_API_URL ?? "/api"}/audio/config`,
        );
        if (r.ok) {
          const data = (await r.json()) as {
            sttModel?: string | null;
            visionModel?: string | null;
          };
          setSttModel(data.sttModel ?? null);
          setVisionModel(data.visionModel ?? null);
        }
      } catch { /* sin media config */ } finally {
        setSttConfigLoaded(true);
        setMediaConfigLoaded(true);
      }
    })();
  }, []);

  const sttMicEnabled = !!sttModel;
  const sttMicDisabled = loading || !sttConfigLoaded || !sttMicEnabled;
  const imageAttachEnabled = !!visionModel?.trim();
  const imageAttachDisabled =
    loading || !mediaConfigLoaded || !imageAttachEnabled || pendingFiles.length >= 6;
  const imageAttachTitle = !mediaConfigLoaded
    ? "Comprobando modelo de visión…"
    : !imageAttachEnabled
      ? "Configura el modelo de visión en Ajustes → Gestionar instancias"
      : "Adjuntar imagen (máx. 6, PNG/JPEG/WebP/GIF)";
  const imageAttachAriaLabel = imageAttachTitle;
  const sttMicTitle = recording
    ? "Detener grabación"
    : !sttConfigLoaded
      ? "Comprobando transcripción de voz…"
      : !sttMicEnabled
        ? "Configura el modelo STT en Ajustes → Proveedores IA"
        : "Grabar voz";
  const sttMicAriaLabel = recording ? "Detener grabación" : sttMicTitle;

  const handleMicClick = async () => {
    if (!sttMicEnabled) return;
    if (recording) {
      // Stop recording
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      audioChunksRef.current = chunks;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const elapsed = Date.now() - recordingStartRef.current;
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 100 || elapsed < 1000) return;

        try {
          const formData = new FormData();
          formData.append("audio", blob, "recording.webm");
          const r = await apiFetch(
            `${import.meta.env.VITE_API_URL ?? "/api"}/audio/transcribe`,
            { method: "POST", body: formData },
          );
          if (r.ok) {
            const data: { text: string } = await r.json();
            if (data.text?.trim()) {
              setInputValue((prev) => {
                const sep = prev.trim() ? " " : "";
                return prev + sep + data.text.trim();
              });
              requestAnimationFrame(() => chatInputRef.current?.focus());
            }
          } else {
            const err = await r.json().catch(() => ({ message: `Error ${r.status}` })) as { message?: string };
            console.warn("[STT]", r.status, err);
            setInputValue((prev) => prev || `⚠️ STT: ${(err as Record<string, unknown>).message ?? r.status}`);
          }
        } catch (e) {
          console.warn("[STT] network error", e);
        }
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };
      recorder.start();
      recordingStartRef.current = Date.now();
      setRecording(true);
    } catch {
      // Permission denied or no mic
    }
  };

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setShowScrollBtn(false);
  };

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const far = el.scrollHeight - el.scrollTop - el.clientHeight > 200;
    setShowScrollBtn(far);
  }, []);

  const handleSend = async () => {
    if (frozenDeliverableChat) return;
    if ((!inputValue.trim() && !pendingFiles.length) || loading) return;
    const msg = inputValue.trim();
    if (activeTab === "mdd" && msg === "/") {
      setInputValue("");
      return;
    }
    if (isFormatDocumentChatCommand(msg) && !pendingFiles.length) {
      setInputValue("");
      await sendMessage(msg);
      return;
    }
    const section = activeTab === "mdd" ? resolveRegenerateSectionFromChatMessage(msg) : null;
    const imageParts = pendingFiles.length ? await readFilesAsChatParts(pendingFiles) : [];
    setPendingFiles([]);
    setInputValue("");
    const imgOpt = imageParts.length ? { images: imageParts } : {};
    if (section != null) {
      await sendMessage(msg, { regenerateSection: section, ...imgOpt });
    } else {
      await sendMessage(msg, { ...imgOpt });
    }
  };

  const slashFilter = inputValue.startsWith("/") ? inputValue.slice(1).toLowerCase() : "";
  const showFormatSlash =
    !frozenDeliverableChat &&
    TABS_WITH_FORMAT_COMMAND.has(activeTab) &&
    !isBenchmarkFirstAction &&
    inputValue.startsWith("/") &&
    !inputValue.includes(" ") &&
    (inputValue === "/" || formatDocumentCommandFilter(inputValue));
  const filteredSlashCommands = slashFilter
    ? MDD_SECTION_COMMANDS.filter((c) => c.slug.startsWith(slashFilter) || String(c.section).startsWith(slashFilter))
    : MDD_SECTION_COMMANDS;
  const showMddSectionSlash =
    !frozenDeliverableChat &&
    activeTab === "mdd" &&
    (inputValue === "/" ||
      (inputValue.startsWith("/") && !inputValue.includes(" ") && filteredSlashCommands.length > 0));
  const showSlashCommands = showFormatSlash || showMddSectionSlash;

  const showLongPasteMddWarn = activeTab === "mdd" && inputValue.length > MDD_LONG_PASTE_WARN_CHARS;

  const handleGenerateBenchmark = () => {
    if (!inputValue.trim() || loading || !benchmarkMode) return;
    const idea = inputValue.trim();
    setInputValue("");
    benchmarkMode.onGenerateBenchmark(idea);
  };

  const handleClearChat = async () => {
    if (!projectId) return;
    setShowClearConfirm(false);
    await clearChat(projectId, activeTab);
  };

  const handlePlanExecute = () => {
    sendMessage("sí");
  };

  const handlePlanModify = () => {
    chatInputRef.current?.focus();
  };

  const handleComposerSubmit = useCallback(() => {
    if (isBenchmarkFirstAction) void handleGenerateBenchmark();
    else void handleSend();
  }, [isBenchmarkFirstAction, handleGenerateBenchmark, handleSend]);

  const handleComposerEnterKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      handleChatComposerEnterKeyDown(e, handleComposerSubmit);
    },
    [handleComposerSubmit],
  );

  const showCenteredEmpty =
    embedded &&
    !phase0AssistedActive &&
    !phase0AssistedBootstrapMessage?.trim() &&
    (activeTab === "benchmark" ? benchmarkEmpty : messages.length === 0) &&
    !loading;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showCenteredEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center min-h-0 p-6">
          <Target className="w-14 h-14 shrink-0 mb-4 text-[color-mix(in_oklch,var(--primary)_75%,var(--muted-foreground))]" />
          <p className="text-center text-lg text-[var(--foreground)] mb-6 max-w-xl">
            ¿Qué quieres construir y cuál es tu referencia (ej. industria o producto similar)?
          </p>
          <div className="w-full max-w-2xl flex flex-col gap-3">
            {showLongPasteMddWarn && (
              <p className="text-xs text-[color-mix(in_oklch,var(--primary)_85%,var(--foreground))] bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))] border border-[color-mix(in_oklch,var(--primary)_28%,var(--border))] rounded-lg px-3 py-2">
                Mensaje muy largo ({inputValue.length} caracteres). Conviene trocear por sección (p. ej.{" "}
                <code className="text-[color-mix(in_oklch,var(--primary)_72%,var(--foreground))]">/contratos-api</code>) o varios mensajes; el envío no se bloquea.
              </p>
            )}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                const f = e.target.files;
                if (!f?.length) return;
                setPendingFiles((p) => [...p, ...Array.from(f)].slice(0, 6));
                e.target.value = "";
              }}
            />
            {!isBenchmarkFirstAction && pendingPreviews.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {pendingPreviews.map((url, i) => (
                  <div key={`${url}-${i}`} className="relative shrink-0">
                    <img
                      src={url}
                      alt=""
                      className="h-16 w-16 object-cover rounded-lg border border-[var(--border)]"
                    />
                    <button
                      type="button"
                      onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 rounded-full bg-[var(--card)] border border-[var(--border)] p-0.5 text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))] hover:text-[var(--foreground)]"
                      aria-label="Quitar imagen"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <ChatComposerBar
              chatInputRef={chatInputRef}
              inputValue={inputValue}
              onInputChange={setInputValue}
              onKeyDown={handleComposerEnterKeyDown}
              placeholder={getChatComposerPlaceholder(isBenchmarkFirstAction, activeTab)}
              inputTitle={
                isBenchmarkFirstAction
                  ? "Puedes incluir URLs públicas; se usarán como referencia para el benchmark."
                  : undefined
              }
              loading={loading}
              isBenchmarkFirstAction={isBenchmarkFirstAction}
              showAttachTools={!isBenchmarkFirstAction}
              textareaDisabled={composerTextareaDisabled}
              imageInputRef={imageInputRef}
              imageAttachDisabled={imageAttachDisabled}
              imageAttachTitle={imageAttachTitle}
              imageAttachAriaLabel={imageAttachAriaLabel}
              sttMicDisabled={sttMicDisabled}
              sttMicTitle={sttMicTitle}
              sttMicAriaLabel={sttMicAriaLabel}
              recording={recording}
              onMicClick={() => void handleMicClick()}
              submitDisabled={
                loading ||
                (isBenchmarkFirstAction ? !inputValue.trim() : !inputValue.trim() && !pendingFiles.length)
              }
              onSend={() => void handleSend()}
              onGenerateBenchmark={() => void handleGenerateBenchmark()}
            />
          </div>
        </div>
      ) : (
        <>
          <header className={cn("shrink-0 border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_45%,var(--background))] py-2.5 sm:py-3 lg:flex lg:h-16 lg:min-h-16 lg:max-h-16 lg:items-center lg:overflow-hidden lg:py-0", WORKSHOP_CHAT_INSET_X)}>
            <div className="flex min-h-0 min-w-0 flex-1 items-start justify-between gap-4 lg:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-2.5 lg:items-center">
                <div className={cn(WORKSHOP_COLUMN_HEADER_ICON_SLOT, "mt-0.5 lg:mt-0")} aria-hidden>
                  <MessageSquare className={WORKSHOP_COLUMN_HEADER_ICON} strokeWidth={2} aria-hidden />
                </div>
                <div className="min-w-0 flex-1 pt-0.5 lg:pt-0">
                  <h2 className="text-sm font-semibold leading-tight tracking-tight text-[var(--foreground)]">
                    {embedded ? "Chat (Paso 0)" : "Conversación"}
                  </h2>
                  {contextLabel && !embedded ? (
                    <p
                      className="mt-1 line-clamp-2 text-left text-xs leading-snug text-[var(--foreground-subtle)] sm:line-clamp-1"
                      title={contextLabel}
                    >
                      {contextLabel}
                    </p>
                  ) : null}
                </div>
              </div>
              <TooltipProvider delayDuration={280}>
                <div className="flex shrink-0 items-center gap-1">
                  <ChatProviderInfoButton onOpenSettings={onOpenSettings} />
                  {onRevaluate && projectId ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <WorkshopChatToolbarIconButton
                            onClick={() => void onRevaluate()}
                            disabled={loading || revaluateBusy}
                            aria-label="Re-Valorar complejidad"
                          >
                          {revaluateBusy ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                          ) : (
                            <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
                          )}
                          </WorkshopChatToolbarIconButton>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="end" className="max-w-[11rem]">
                        Re-infiere complejidad y abre la entrevista.
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <WorkshopChatToolbarIconButton
                            tone="danger"
                            onClick={() => setShowClearConfirm(true)}
                            disabled={loading || messages.length === 0}
                            aria-label="Borrar historial del chat"
                          >
                          <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                          </WorkshopChatToolbarIconButton>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="end" className="max-w-[11rem]">
                      {messages.length === 0
                        ? "Sin mensajes"
                        : "Borrar historial del chat (el MDD no cambia)."}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>
          </header>
          {multiStageChat && (
            <div
              className="shrink-0 mx-3 mt-2 mb-1 px-3 py-2 rounded-lg border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))] text-[color-mix(in_oklch,var(--primary)_55%,var(--foreground))] text-xs leading-snug flex gap-2 items-start"
              role="status"
            >
              <span className="flex-1">
                {chatScope === "stage" ? (
                  <>
                    <strong className="text-[color-mix(in_oklch,var(--primary)_72%,var(--foreground))]">Chat de etapa activa.</strong>{" "}
                    Solo mensajes de esta etapa{projectType === "LEGACY" ? " (recomendado en brownfield)" : ""}.
                    El MDD y el semáforo siguen la etapa seleccionada arriba.
                  </>
                ) : (
                  <>
                    <strong className="text-[color-mix(in_oklch,var(--primary)_72%,var(--foreground))]">Historial global.</strong>{" "}
                    Mensajes de todas las etapas en este tab; pueden mezclar AS-IS y cambios de otras líneas.
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => setChatScope(chatScope === "stage" ? "global" : "stage")}
                className="shrink-0 px-2 py-0.5 rounded bg-[color-mix(in_oklch,var(--muted)_82%,var(--card))] hover:bg-[var(--muted)] text-[var(--foreground)] text-[11px] whitespace-nowrap"
              >
                {chatScope === "stage" ? "Ver global" : "Solo etapa"}
              </button>
            </div>
          )}
          {multiStageChat && chatScope === "global" && stageSwitchBannerOpen && (
            <div
              className="shrink-0 mx-3 mt-0 mb-1 px-3 py-1.5 rounded-lg border border-[color-mix(in_oklch,var(--warning)_35%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_8%,var(--card))] text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))] text-[11px] leading-snug flex gap-2 items-center"
              role="status"
            >
              <span className="flex-1">Cambiaste de etapa; el historial global incluye mensajes de otras etapas.</span>
              <button
                type="button"
                onClick={() => setStageSwitchBannerOpen(false)}
                className="shrink-0 px-2 py-0.5 rounded bg-[color-mix(in_oklch,var(--muted)_82%,var(--card))] hover:bg-[var(--muted)] text-[var(--foreground)] text-[11px]"
              >
                Cerrar
              </button>
            </div>
          )}
          {phase0AssistedActive && activeTab === "benchmark" && (
            <div
              className="shrink-0 mx-3 mt-2 mb-1 px-3 py-2 rounded-lg border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))] text-[color-mix(in_oklch,var(--primary)_55%,var(--foreground))] text-xs leading-snug flex gap-2 items-start"
              role="status"
            >
              <span className="flex-1">
                <strong className="text-[color-mix(in_oklch,var(--primary)_72%,var(--foreground))]">
                  Modo asistido
                </strong>
                {phase0AssistedTemplateLabel ? ` · ${phase0AssistedTemplateLabel}` : ""}
                : una pregunta por turno; el panel de Paso 0 muestra cada cambio.
              </span>
              <button
                type="button"
                onClick={() => void stopPhase0Assisted()}
                className="shrink-0 px-2 py-0.5 rounded bg-[color-mix(in_oklch,var(--muted)_82%,var(--card))] hover:bg-[var(--muted)] text-[var(--foreground)] text-[11px]"
              >
                Apagar
              </button>
            </div>
          )}
          {frozenDeliverableChat && (
            <div
              className="shrink-0 mx-3 mt-2 mb-1 px-3 py-2 rounded-lg border border-[color-mix(in_oklch,var(--warning)_35%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_8%,var(--card))] text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))] text-xs leading-snug prose prose-invert prose-sm max-w-none prose-p:my-0"
              role="status"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {workshopFrozenTabUserMessage(activeTab)}
              </ReactMarkdown>
            </div>
          )}
          <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Borrar historial</AlertDialogTitle>
                <AlertDialogDescription>
                  ¿Borrar historial de la conversación? El contenido del MDD no se modifica y podrás iniciar de nuevo con un mensaje de bienvenida.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setShowClearConfirm(false)}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction onClick={handleClearChat} disabled={loading} className="bg-[var(--destructive)] hover:bg-[var(--destructive)]/90">
                  Borrar historial
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div ref={chatScrollRef} onScroll={handleChatScroll} className={cn("flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pt-4 pb-2 space-y-4", WORKSHOP_CHAT_INSET_X)}>
            {messagesToShow.length ? (
              messagesToShow.map((msg, i) => (
                <div
                  key={i}
                  className={`flex min-w-0 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`min-w-0 max-w-[85%] overflow-hidden rounded-lg px-3 py-2 text-sm ${msg.role === "user"
                      ? "bg-[color-mix(in_oklch,var(--primary)_18%,transparent)] text-[color-mix(in_oklch,var(--primary)_58%,var(--foreground))]"
                      : "bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)]"
                      }`}
                  >
                    {msg.stageId ? (
                      <span
                        className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[color-mix(in_oklch,var(--primary)_80%,var(--foreground))]"
                      >
                        Etapa: {stageNameForBadge(msg.stageId)}
                      </span>
                    ) : null}
                    {msg.role === "assistant" ? (
                      <div className="prose prose-invert prose-sm min-w-0 max-w-full prose-table:text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))] prose-th:border-[var(--border)] prose-td:border-[var(--border)] [&_table]:my-0">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={CHAT_MARKDOWN_COMPONENTS}>
                          {normalizeChatMarkdown(msg.content)}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div>
                        {msg.images != null && msg.images.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 mb-1.5">
                            {msg.images.map((im, j) => (
                              <img
                                key={j}
                                src={`data:${im.mimeType};base64,${im.base64}`}
                                alt=""
                                className="max-h-36 max-w-[min(100%,280px)] rounded-md border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] object-contain bg-[color-mix(in_oklch,var(--background)_50%,var(--card))]"
                              />
                            ))}
                          </div>
                        ) : null}
                        {(() => {
                          const { text, vision } = splitUserChatContent(msg.content);
                          return (
                            <>
                              {text ? (
                                <div className="whitespace-pre-wrap break-words">{text}</div>
                              ) : null}
                              {vision ? (
                                <div className="mt-2 rounded-md border border-[color-mix(in_oklch,var(--primary)_22%,var(--border))] bg-[color-mix(in_oklch,var(--muted)_35%,transparent)] px-2.5 py-2 text-xs text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))]">
                                  <p className="mb-1 font-medium text-[color-mix(in_oklch,var(--primary)_70%,var(--foreground))]">
                                    Referencia visual (visión)
                                  </p>
                                  <div className="whitespace-pre-wrap break-words">{vision}</div>
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : loading && !showAgentProgress && !isLegacyLongRun ? (
              <p className="text-[var(--foreground-subtle)] text-sm text-center py-8">
                Cargando mensaje de bienvenida…
              </p>
            ) : !loading && !showAgentProgress && !isLegacyLongRun ? (
              <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-2 py-10 text-center sm:py-12">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--muted)] text-[var(--primary)] ring-1 ring-[color-mix(in_oklch,var(--border)_65%,transparent)]">
                  <MessageSquare className="h-5 w-5" strokeWidth={2} aria-hidden />
                </div>
                <p className="text-sm leading-relaxed text-[var(--foreground-subtle)]">
                  {phase0AssistedActive && activeTab === "benchmark"
                    ? "Modo asistido: responde la pregunta en la barra inferior. Verás el impacto y los cambios en el panel de Paso 0."
                    : activeTab === "benchmark"
                    ? "Escribe tu idea en la barra inferior y envía. Los agentes generarán el Benchmark & Gap Analysis."
                    : activeTab === "mdd"
                      ? "Usa la barra inferior: pide generar el MDD, revisiones o preguntas. El orquestador asigna el agente adecuado."
                      : "Escribe en la barra inferior. El contexto es el de la pestaña activa (véase arriba)."}
                </p>
              </div>
            ) : null}

            {isLegacyLongRun ? (
              <div
                className="rounded-lg border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_10%,var(--background))] px-3 py-2.5 space-y-1.5"
                role="status"
                aria-live="polite"
              >
                <p className="text-[10px] font-medium uppercase tracking-wide text-[color-mix(in_oklch,var(--primary)_82%,var(--foreground))]">
                  {loadingReason === "legacy-codebase-doc"
                    ? "MDD inicial (partida)"
                    : loadingReason === "legacy-mdd"
                      ? "MDD de cambio"
                      : loadingReason === "legacy-as-is"
                        ? "Manual As-Is"
                        : loadingReason === "legacy-brd-suggest"
                          ? "BRD / To-Be (borradores)"
                          : loadingReason === "brd-from-dbga"
                            ? "BRD / To-Be desde DBGA"
                            : "Entregables legacy"}
                </p>
                <div className="flex items-start gap-2 text-sm text-[color-mix(in_oklch,var(--primary)_55%,var(--foreground))]">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--primary)] shrink-0 mt-0.5" aria-hidden />
                  <span className="leading-snug">
                    {legacyRotatingSteps[legacyProgressIndex % legacyRotatingSteps.length]}
                  </span>
                </div>
              </div>
            ) : null}

            {evaluatorCritique ? (
              <div className="rounded-lg border border-violet-800/50 bg-violet-950/30 px-3 py-2 text-xs text-[var(--foreground)] leading-relaxed">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-medium text-violet-200">Crítica del evaluador</span>
                  <button
                    type="button"
                    onClick={() => clearEvaluatorCritique()}
                    className="shrink-0 text-[var(--foreground-subtle)] hover:text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))] p-0.5 rounded"
                    aria-label="Cerrar crítica"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="whitespace-pre-wrap text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))]">{evaluatorCritique}</p>
              </div>
            ) : null}

            {showAgentProgress && (
              <WorkshopAgentProgressPanel className="mx-0" />
            )}

            {activeTab === "mdd" && pendingPlanApproval && pendingPlanApproval.plan.length > 0 && (
              <PlanApprovalCard
                planMessage={pendingPlanApproval.planMessage}
                plan={pendingPlanApproval.plan}
                loading={loading}
                onExecute={handlePlanExecute}
                onModify={handlePlanModify}
              />
            )}

            {loading && !isLegacyLongRun && !showAgentProgress && (
              <div className="flex justify-start">
                <AiGenerationChatBubble label="Generando…" />
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {showScrollBtn ? (
            <div className="flex justify-center -mt-10 mb-2 pointer-events-none relative z-10">
              <button
                type="button"
                onClick={scrollToBottom}
                className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--card)] border border-[var(--border)] text-[var(--muted-foreground)] shadow-md hover:text-[var(--foreground)] hover:shadow-lg transition-shadow"
                aria-label="Ir al final"
              >
                <ChevronDown className="h-5 w-5" />
              </button>
            </div>
          ) : null}
          {error && (
            <p className={cn("pb-2 text-sm text-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))]", WORKSHOP_CHAT_INSET_X)}>{error}</p>
          )}
          {!frozenDeliverableChat && showSlashCommands && (
            <div className={cn("pt-2 border-t border-[var(--border)]/50 bg-[var(--card)]/30 space-y-2", WORKSHOP_CHAT_INSET_X)}>
              {showFormatSlash && (
                <div>
                  <p className="text-xs text-[var(--foreground-subtle)] mb-2">
                    Formatear documento del panel (fences, tablas, Mermaid — sin IA):
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setInputValue("");
                      void sendMessage(FORMAT_DOCUMENT_COMMAND.label);
                    }}
                    className="px-2.5 py-1.5 rounded-md text-sm bg-[var(--muted)] hover:bg-[color-mix(in_oklch,var(--primary)_18%,transparent)] text-[var(--foreground)] hover:text-[color-mix(in_oklch,var(--primary)_72%,var(--foreground))] border border-[var(--border)] hover:border-[color-mix(in_oklch,var(--primary)_40%,var(--border))]"
                  >
                    {FORMAT_DOCUMENT_COMMAND.label} — {FORMAT_DOCUMENT_COMMAND.description} (DBGA, Spec y Benchmark si existen)
                  </button>
                </div>
              )}
              {showMddSectionSlash && (
                <div>
                  <p className="text-xs text-[var(--foreground-subtle)] mb-2">
                    Regenerar sección del MDD (solo esta sección se reescribirá):
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {filteredSlashCommands.map((cmd) => (
                      <button
                        key={cmd.section}
                        type="button"
                        onClick={() => {
                          setInputValue("");
                          sendMessage(`/${cmd.slug}`, { regenerateSection: cmd.section });
                        }}
                        className="px-2.5 py-1.5 rounded-md text-sm bg-[var(--muted)] hover:bg-[color-mix(in_oklch,var(--primary)_18%,transparent)] text-[var(--foreground)] hover:text-[color-mix(in_oklch,var(--primary)_72%,var(--foreground))] border border-[var(--border)] hover:border-[color-mix(in_oklch,var(--primary)_40%,var(--border))]"
                      >
                        {cmd.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {!frozenDeliverableChat ? (
          <div
            className={cn(
              APP_PANEL_FOOTER_CHROME,
              APP_PANEL_FOOTER_H,
              APP_PANEL_FOOTER_PY,
              "border-[var(--border)]",
              WORKSHOP_CHAT_INSET_X,
            )}
          >
            {showLongPasteMddWarn && (
              <p className="text-xs text-[color-mix(in_oklch,var(--primary)_85%,var(--foreground))] bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))] border border-[color-mix(in_oklch,var(--primary)_28%,var(--border))] rounded-lg px-3 py-2">
                Mensaje muy largo ({inputValue.length} caracteres). Conviene trocear por sección o varios mensajes.
              </p>
            )}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                const f = e.target.files;
                if (!f?.length) return;
                setPendingFiles((p) => [...p, ...Array.from(f)].slice(0, 6));
                e.target.value = "";
              }}
            />
            {pendingPreviews.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {pendingPreviews.map((url, i) => (
                  <div key={`${url}-${i}`} className="relative shrink-0">
                    <img
                      src={url}
                      alt=""
                      className="h-16 w-16 object-cover rounded-lg border border-[var(--border)]"
                    />
                    <button
                      type="button"
                      onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 rounded-full bg-[var(--card)] border border-[var(--border)] p-0.5 text-[color-mix(in_oklch,var(--foreground)_88%,var(--muted-foreground))] hover:text-[var(--foreground)]"
                      aria-label="Quitar imagen"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <ChatComposerBar
              chatInputRef={chatInputRef}
              inputValue={inputValue}
              onInputChange={setInputValue}
              onKeyDown={handleComposerEnterKeyDown}
              placeholder={getChatComposerPlaceholder(isBenchmarkFirstAction, activeTab)}
              inputTitle={
                isBenchmarkFirstAction
                  ? "Puedes incluir URLs públicas; se usarán como referencia para el benchmark."
                  : undefined
              }
              loading={loading}
              isBenchmarkFirstAction={isBenchmarkFirstAction}
              showAttachTools={!isBenchmarkFirstAction}
              textareaDisabled={composerTextareaDisabled}
              imageInputRef={imageInputRef}
              imageAttachDisabled={imageAttachDisabled}
              imageAttachTitle={imageAttachTitle}
              imageAttachAriaLabel={imageAttachAriaLabel}
              sttMicDisabled={sttMicDisabled}
              sttMicTitle={sttMicTitle}
              sttMicAriaLabel={sttMicAriaLabel}
              recording={recording}
              onMicClick={() => void handleMicClick()}
              submitDisabled={
                loading ||
                (isBenchmarkFirstAction ? !inputValue.trim() : !inputValue.trim() && !pendingFiles.length)
              }
              onSend={() => void handleSend()}
              onGenerateBenchmark={() => void handleGenerateBenchmark()}
            />
          </div>
          ) : null}
        </>
      )}
    </div>
  );
}
