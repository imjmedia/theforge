import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createMddChatEventHandler,
  isMddStreamingLoading,
  isMddStreamResultDiscarded,
  MDD_LEASE_RELOADED_NOTICE,
  MDD_LOCK_UNAVAILABLE_NOTICE,
  MDD_LOCK_UNAVAILABLE_USER_EDIT_NOTICE,
  mddLeaseLostUserEditNotice,
  mddStreamDiscardedNotice,
  mddStreamDiscardedUserEditNotice,
  type WorkshopGet,
  type WorkshopSet,
} from "./mdd-chat-event.js";
import type { WorkshopState } from "../workshop-state.types.js";

const PROJECT_ID = "proj-1";
const SAVED_MDD = `# MDD guardado\n\n${"Contenido persistido del documento. ".repeat(40)}`;
const SHRUNK_DRAFT_A = `# MDD encogido\n\n${"Borrador parcial A con texto suficiente para el editor. ".repeat(3)}`;
const SHRUNK_DRAFT_B = `# MDD encogido\n\n${"Borrador parcial B con texto suficiente para el editor. ".repeat(3)}`;
const USER_EDIT = `# Edición del usuario\n\n${"Texto tecleado en el editor durante el stream. ".repeat(4)}`;
/** Versión que el servidor devuelve al recargar el proyecto (la guardó otro turno). */
const SERVER_MDD = `# MDD recargado del servidor\n\n${"Versión guardada por otro turno del chat. ".repeat(4)}`;
/** Edición sin guardar que el usuario ya tenía al enviar el mensaje (snapshot ≠ baseline). */
const PRIOR_EDIT = `${SAVED_MDD}\n\n## Cambio sin guardar\n\nTexto añadido por el usuario antes de enviar el mensaje.`;

function createHarness(initial?: Partial<WorkshopState>, options?: { snapshot?: string }) {
  const fetchCalls: Array<{ projectId: string; options: unknown; editorAtCall: string }> = [];
  /** Simula `fetchProject`: registra la llamada (y el editor en ese momento) y deja la versión guardada en el servidor. */
  const fetchProject = async (projectId: string, fetchOptions?: unknown): Promise<{ id: string }> => {
    fetchCalls.push({ projectId, options: fetchOptions, editorAtCall: state.mddContent ?? "" });
    state = { ...state, mddContent: SERVER_MDD, mddPersistedBaseline: SERVER_MDD, synced: true };
    return { id: projectId };
  };
  let state = {
    projectId: PROJECT_ID,
    project: { id: PROJECT_ID },
    mddContent: SAVED_MDD,
    mddPersistedBaseline: SAVED_MDD,
    synced: true,
    error: null,
    notice: null,
    deliveryGate: null,
    loading: true,
    loadingReason: "mdd",
    managerThreadId: "thread-1",
    pendingPlanApproval: null,
    agentProgress: [],
    fetchProject,
    ...initial,
  } as unknown as WorkshopState;
  const set = ((partial: unknown) => {
    const patch = typeof partial === "function" ? (partial as (s: WorkshopState) => unknown)(state) : partial;
    state = { ...state, ...(patch as Partial<WorkshopState>) };
  }) as WorkshopSet;
  const get: WorkshopGet = () => state;
  const handler = createMddChatEventHandler({
    set,
    get,
    requestProjectId: PROJECT_ID,
    sessionId: "session-1",
    mddSnapshotBeforeStream: options?.snapshot ?? SAVED_MDD.trim(),
  });
  /** Simula que el usuario tecleó en el textarea mientras el stream sigue activo. */
  const editEditor = (content: string) => {
    state = { ...state, mddContent: content };
  };
  return { handler, get, editEditor, fetchCalls };
}

describe("isMddStreamResultDiscarded", () => {
  it("reconoce los códigos de resultado descartado por tipo de evento", () => {
    assert.equal(isMddStreamResultDiscarded({ type: "blocked", code: "MDD_PERSIST_FLOOR" }), true);
    assert.equal(isMddStreamResultDiscarded({ type: "blocked", code: "MDD_PERSIST_TOO_SHORT" }), true);
    assert.equal(isMddStreamResultDiscarded({ type: "error", code: "LEASE_LOST" }), true);
    assert.equal(isMddStreamResultDiscarded({ type: "error", code: "LOCK_UNAVAILABLE" }), true);
    assert.equal(isMddStreamResultDiscarded({ type: "blocked", code: "LEASE_LOST" }), false);
    assert.equal(isMddStreamResultDiscarded({ type: "error", code: "MDD_PERSIST_FLOOR" }), false);
    assert.equal(isMddStreamResultDiscarded({ type: "blocked" }), false);
  });
});

describe("mddStreamDiscardedUserEditNotice", () => {
  it("indica que la edición se conservó y no está guardada, con el motivo del servidor", () => {
    const notice = mddStreamDiscardedUserEditNotice("El turno perdió el lock de escritura.");
    assert.match(notice, /^Tu edición se conservó, pero no está guardada/);
    assert.match(notice, /\(El turno perdió el lock de escritura\.\)$/);
    assert.match(mddStreamDiscardedUserEditNotice(undefined), /sin detalle del servidor/);
  });
});

describe("createMddChatEventHandler: resultado descartado por el servidor", () => {
  it("blocked MDD_PERSIST_FLOOR tras dos draft restaura el snapshot y no marca synced como guardado", async () => {
    const { handler, get } = createHarness();

    assert.equal(await handler({ type: "draft", markdown: SHRUNK_DRAFT_A }), "continue");
    assert.equal(await handler({ type: "draft", markdown: SHRUNK_DRAFT_B }), "continue");
    assert.notEqual(get().mddContent.trim(), SAVED_MDD.trim(), "los draft deben haber entrado al editor");

    const outcome = await handler({
      type: "blocked",
      code: "MDD_PERSIST_FLOOR",
      message: "El resultado era menos de la mitad del documento guardado.",
    });

    assert.equal(outcome, "terminal");
    assert.equal(get().mddContent.trim(), SAVED_MDD.trim());
    assert.equal(get().synced, true, "synced no cambia: nada se guardó con el borrador");
    assert.equal(get().mddPersistedBaseline, SAVED_MDD, "el baseline persistido no cambia");
    assert.equal(get().error, null, "es un aviso, no un error de red");
    assert.match(get().notice ?? "", /menos de la mitad del documento guardado/);
    assert.match(get().notice ?? "", /conservó el documento guardado/);
    assert.match(get().notice ?? "", /vista previa/);
    assert.equal(get().loading, false);
    assert.equal(get().managerThreadId, null);
  });

  it("blocked MDD_PERSIST_TOO_SHORT sin message usa el aviso por defecto", async () => {
    const { handler, get } = createHarness();
    await handler({ type: "draft", markdown: SHRUNK_DRAFT_A });

    const outcome = await handler({ type: "blocked", code: "MDD_PERSIST_TOO_SHORT" });

    assert.equal(outcome, "terminal");
    assert.equal(get().mddContent.trim(), SAVED_MDD.trim());
    assert.equal(get().notice, mddStreamDiscardedNotice(undefined));
  });

  it("error LEASE_LOST sin edición vuelve al baseline, recarga lo guardado en el servidor y no restaura el snapshot", async () => {
    const { handler, get, fetchCalls } = createHarness();
    await handler({ type: "draft", markdown: SHRUNK_DRAFT_A });

    const outcome = await handler({ type: "error", code: "LEASE_LOST", message: "El turno perdió el lock de escritura." });

    assert.equal(outcome, "terminal");
    assert.deepEqual(
      fetchCalls.map(({ projectId, options }) => ({ projectId, options })),
      [{ projectId: PROJECT_ID, options: { preferServerMdd: true } }],
    );
    assert.equal(fetchCalls[0]?.editorAtCall.trim(), SAVED_MDD.trim(), "el editor vuelve al baseline antes de recargar");
    assert.equal(get().mddContent.trim(), SERVER_MDD.trim(), "el editor muestra la versión del servidor");
    assert.equal(get().synced, true);
    assert.equal(get().error, null, "sin error genérico");
    assert.equal(get().notice, MDD_LEASE_RELOADED_NOTICE);
    assert.equal(get().loading, false);
    assert.equal(get().managerThreadId, null);
  });

  it("error LOCK_UNAVAILABLE sin edición restaura el snapshot, no recarga y avisa del bloqueo (no de otro turno)", async () => {
    const { handler, get, fetchCalls } = createHarness();
    await handler({ type: "draft", markdown: SHRUNK_DRAFT_A });

    const outcome = await handler({ type: "error", code: "LOCK_UNAVAILABLE", message: "Redis no responde." });

    assert.equal(outcome, "terminal");
    assert.deepEqual(fetchCalls, [], "no recarga: ningún otro turno guardó nada");
    assert.equal(get().mddContent.trim(), SAVED_MDD.trim(), "restaura el estado previo al turno");
    assert.equal(get().synced, true, "el documento sigue igual que lo guardado");
    assert.equal(get().mddPersistedBaseline, SAVED_MDD, "el baseline persistido no cambia");
    assert.equal(get().error, null, "es un aviso, no un error genérico");
    assert.equal(get().notice, MDD_LOCK_UNAVAILABLE_NOTICE);
    assert.doesNotMatch(get().notice ?? "", /Otro turno/);
    assert.equal(get().loading, false);
    assert.equal(get().managerThreadId, null);
  });

  it("LEASE_LOST con edición previa al turno restaura esa edición, no recarga y avisa de la versión más nueva", async () => {
    const { handler, get, fetchCalls } = createHarness({ mddContent: PRIOR_EDIT } as Partial<WorkshopState>, {
      snapshot: PRIOR_EDIT.trim(),
    });
    await handler({ type: "draft", markdown: SHRUNK_DRAFT_A });
    assert.notEqual(get().mddContent.trim(), PRIOR_EDIT.trim(), "el draft debe haber entrado al editor");

    const outcome = await handler({ type: "error", code: "LEASE_LOST", message: "El turno perdió el lock de escritura." });

    assert.equal(outcome, "terminal");
    assert.deepEqual(fetchCalls, [], "no recarga: pisaría la edición previa del usuario");
    assert.equal(get().mddContent.trim(), PRIOR_EDIT.trim(), "la edición previa se conserva en el editor");
    assert.equal(get().synced, false, "la edición no está guardada");
    assert.equal(get().error, null);
    assert.match(get().notice ?? "", /^Tu edición se conservó, pero no está guardada/);
    assert.match(get().notice ?? "", /versión más nueva guardada en el servidor/);
    assert.equal(get().loading, false);
  });

  it("LOCK_UNAVAILABLE con edición previa al turno conserva la edición, no recarga y avisa del bloqueo", async () => {
    const { handler, get, fetchCalls } = createHarness({ mddContent: PRIOR_EDIT } as Partial<WorkshopState>, {
      snapshot: PRIOR_EDIT.trim(),
    });
    await handler({ type: "draft", markdown: SHRUNK_DRAFT_A });

    const outcome = await handler({ type: "error", code: "LOCK_UNAVAILABLE", message: "Redis no responde." });

    assert.equal(outcome, "terminal");
    assert.deepEqual(fetchCalls, []);
    assert.equal(get().mddContent.trim(), PRIOR_EDIT.trim(), "la edición previa se conserva en el editor");
    assert.equal(get().synced, false);
    assert.equal(get().error, null);
    assert.equal(get().notice, MDD_LOCK_UNAVAILABLE_USER_EDIT_NOTICE);
    assert.match(get().notice ?? "", /Redis no disponible/);
    assert.doesNotMatch(get().notice ?? "", /versión más nueva/);
  });

  it("LOCK_UNAVAILABLE con edición del usuario durante el stream conserva su texto, no recarga y avisa del bloqueo", async () => {
    const { handler, get, editEditor, fetchCalls } = createHarness();
    await handler({ type: "draft", markdown: SHRUNK_DRAFT_A });
    editEditor(USER_EDIT);

    const outcome = await handler({ type: "error", code: "LOCK_UNAVAILABLE", message: "Redis no responde." });

    assert.equal(outcome, "terminal");
    assert.deepEqual(fetchCalls, []);
    assert.equal(get().mddContent, USER_EDIT);
    assert.equal(get().synced, false);
    assert.equal(get().notice, MDD_LOCK_UNAVAILABLE_USER_EDIT_NOTICE);
  });

  it("si el usuario editó tras los draft, conserva su edición, deja synced en false y avisa", async () => {
    const { handler, get, editEditor } = createHarness();
    await handler({ type: "draft", markdown: SHRUNK_DRAFT_A });
    await handler({ type: "draft", markdown: SHRUNK_DRAFT_B });
    editEditor(USER_EDIT);

    const outcome = await handler({
      type: "blocked",
      code: "MDD_PERSIST_FLOOR",
      message: "El resultado era menos de la mitad del documento guardado.",
    });

    assert.equal(outcome, "terminal");
    assert.equal(get().mddContent, USER_EDIT, "la edición del usuario no se borra");
    assert.equal(get().synced, false, "la edición no está guardada");
    assert.equal(get().mddPersistedBaseline, SAVED_MDD, "el baseline persistido no cambia");
    assert.equal(get().error, null);
    assert.match(get().notice ?? "", /^Tu edición se conservó, pero no está guardada/);
    assert.match(get().notice ?? "", /menos de la mitad del documento guardado/);
    assert.equal(get().loading, false);
    assert.equal(get().managerThreadId, null);
  });

  it("error LEASE_LOST con edición del usuario conserva el editor, no recarga y avisa de la versión más nueva", async () => {
    const { handler, get, editEditor, fetchCalls } = createHarness();
    await handler({ type: "draft", markdown: SHRUNK_DRAFT_A });
    editEditor(USER_EDIT);

    const outcome = await handler({ type: "error", code: "LEASE_LOST", message: "El turno perdió el lock de escritura." });

    assert.equal(outcome, "terminal");
    assert.equal(get().mddContent, USER_EDIT);
    assert.equal(get().synced, false);
    assert.equal(get().error, null, "sin error genérico");
    assert.deepEqual(fetchCalls, [], "no recarga: reemplazaría la edición del usuario");
    assert.match(get().notice ?? "", /^Tu edición se conservó, pero no está guardada/);
    assert.match(get().notice ?? "", /versión más nueva guardada en el servidor/);
    assert.equal(get().loading, false);
  });

  it("sin draft aplicado, una edición del usuario tampoco se restaura al snapshot", async () => {
    const { handler, get, editEditor } = createHarness();
    editEditor(USER_EDIT);

    await handler({ type: "blocked", code: "MDD_PERSIST_TOO_SHORT", message: "Descartado." });

    assert.equal(get().mddContent, USER_EDIT);
    assert.equal(get().synced, false);
    assert.match(get().notice ?? "", /Tu edición se conservó/);
  });

  it("restaura el semáforo de entrega previo al turno", async () => {
    const previousGate = { ok: false, blockers: ["previo"], warnings: [] };
    const { handler, get } = createHarness({ deliveryGate: previousGate } as unknown as Partial<WorkshopState>);
    await handler({
      type: "draft",
      markdown: SHRUNK_DRAFT_A,
      deliveryGate: { ok: true, blockers: [], warnings: [] },
    } as never);
    await handler({ type: "blocked", code: "MDD_PERSIST_FLOOR", message: "Descartado." });
    assert.deepEqual(get().deliveryGate, previousGate);
  });

  it("un blocked sin código de persistencia conserva el comportamiento anterior (error, sin restaurar)", async () => {
    const { handler, get } = createHarness();
    await handler({ type: "draft", markdown: SHRUNK_DRAFT_A });

    const outcome = await handler({ type: "blocked", message: "Bloqueado por otra razón." });

    assert.equal(outcome, "terminal");
    assert.equal(get().error, "Bloqueado por otra razón.");
    assert.equal(get().notice, null);
    assert.notEqual(get().mddContent.trim(), SAVED_MDD.trim());
  });

  it("no toca el editor si el proyecto activo cambió durante el stream", async () => {
    const { handler, get } = createHarness({
      projectId: "otro-proyecto",
      project: { id: "otro-proyecto" },
      mddContent: "# Otro proyecto",
    } as unknown as Partial<WorkshopState>);

    const outcome = await handler({ type: "blocked", code: "MDD_PERSIST_FLOOR", message: "Descartado." });

    assert.equal(outcome, "terminal");
    assert.equal(get().mddContent, "# Otro proyecto");
    assert.equal(get().notice, null);
    assert.equal(get().loading, false);
  });
});

describe("mddLeaseLostUserEditNotice", () => {
  it("indica que la edición se conservó y que el servidor tiene una versión más nueva", () => {
    const notice = mddLeaseLostUserEditNotice("El turno perdió el lock de escritura.");
    assert.match(notice, /^Tu edición se conservó, pero no está guardada: hay una versión más nueva guardada en el servidor/);
    assert.match(notice, /\(El turno perdió el lock de escritura\.\)$/);
    assert.match(mddLeaseLostUserEditNotice(undefined), /sin detalle del servidor/);
  });
});

describe("isMddStreamingLoading", () => {
  it("solo cuenta como stream MDD con loading activo y un motivo de documento", () => {
    assert.equal(isMddStreamingLoading({ loading: true, loadingReason: "mdd" }), true);
    assert.equal(isMddStreamingLoading({ loading: true, loadingReason: "mdd-section" }), true);
    assert.equal(isMddStreamingLoading({ loading: true, loadingReason: "legacy-mdd" }), true);
    assert.equal(isMddStreamingLoading({ loading: true, loadingReason: "legacy-codebase-doc" }), false);
    assert.equal(isMddStreamingLoading({ loading: true, loadingReason: null }), false);
    assert.equal(isMddStreamingLoading({ loading: false, loadingReason: "mdd" }), false);
  });
});
