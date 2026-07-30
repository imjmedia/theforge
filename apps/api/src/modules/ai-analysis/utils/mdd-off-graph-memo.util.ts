/**
 * @fileoverview Memo TTL para evaluaciones costosas fuera del grafo MDD (F5).
 * Clave: `mddGraphFingerprint` + contexto de dominio; evita ~500 re-evals por run.
 */

import { createHash } from "node:crypto";
import type { MddDeliveryGateResult } from "@theforge/shared-types";
import { mddGraphFingerprint } from "@theforge/shared-types";
import type { SddGraphSyncStatus } from "@theforge/shared-types";
import type { ValidateMddForDeliveryOptions } from "./mdd-delivery-gate.util.js";
import { validateMddForDelivery } from "./mdd-delivery-gate.util.js";

const DEFAULT_TTL_MS = 45_000;
const MAX_ENTRIES = 96;

type CacheEntry<T> = { value: T; expiresAt: number };

class TtlMemo<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: () => number,
    private readonly maxEntries: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    while (this.store.size >= this.maxEntries) {
      const first = this.store.keys().next().value;
      if (first === undefined) break;
      this.store.delete(first);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs() });
  }

  clear(): void {
    this.store.clear();
  }
}

export function mddOffGraphMemoTtlMs(): number {
  const raw = process.env.MDD_OFF_GRAPH_MEMO_TTL_MS?.trim();
  const parsed = raw ? parseInt(raw, 10) : DEFAULT_TTL_MS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS;
}

const deliveryGateMemo = new TtlMemo<MddDeliveryGateResult>(mddOffGraphMemoTtlMs, MAX_ENTRIES);
const coherenceMemo = new TtlMemo<SddGraphSyncStatus>(mddOffGraphMemoTtlMs, MAX_ENTRIES);

function domainContextDigest(options?: ValidateMddForDeliveryOptions): string {
  if (!options) return "";
  const payload = [
    (options.brdMarkdown ?? "").trim().slice(0, 8_000),
    (options.dbgaMarkdown ?? "").trim().slice(0, 8_000),
    (options.specMarkdown ?? "").trim().slice(0, 4_000),
    options.mddComplexity ?? "",
    options.skipDeterministicRepair ? "skipRepair" : "",
  ].join("\0");
  if (!payload.replace(/\0/g, "").trim()) return "";
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/** Clave estable para memo del delivery gate. */
export function deliveryGateMemoKey(
  markdown: string,
  options?: ValidateMddForDeliveryOptions,
): string {
  return `gate:${mddGraphFingerprint(markdown)}:${domainContextDigest(options)}`;
}

/** Clave estable para memo de coherencia §3/§4. */
export function coherenceMemoKey(
  mddMarkdown: string,
  contextFingerprint?: string | null,
): string {
  const ctx = (contextFingerprint ?? "").trim();
  return `coh:${mddGraphFingerprint(mddMarkdown)}:${ctx}`;
}

/**
 * `validateMddForDelivery` con memo por huella MDD + dominio (TTL corto).
 * Usar en `prepareMddForOutput` y paths de streaming en vivo.
 */
export function validateMddForDeliveryMemo(
  draft: string,
  options?: ValidateMddForDeliveryOptions,
): MddDeliveryGateResult {
  const key = deliveryGateMemoKey(draft, options);
  const hit = deliveryGateMemo.get(key);
  if (hit) return hit;
  const result = validateMddForDelivery(draft, options);
  deliveryGateMemo.set(key, result);
  return result;
}

/** Memo para `MddCoherenceService.evaluateFromMdd`. */
export function getMemoizedCoherenceStatus(key: string): SddGraphSyncStatus | undefined {
  return coherenceMemo.get(key);
}

export function setMemoizedCoherenceStatus(key: string, status: SddGraphSyncStatus): void {
  coherenceMemo.set(key, status);
}

/** Solo tests: vacía caches. */
export function clearMddOffGraphMemoForTests(): void {
  deliveryGateMemo.clear();
  coherenceMemo.clear();
}
