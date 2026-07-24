import { extractMddSection } from "@theforge/shared-types";

export type MddCanonicalSectionId = "1" | "2" | "3" | "4" | "5" | "6" | "7";

export type MddSectionLens = Partial<
  Record<MddCanonicalSectionId, { before: number; after: number }>
>;

export type MddSectionDiffResult = {
  sectionsTouched: MddCanonicalSectionId[];
  sectionLens: MddSectionLens;
  beforeLen: number;
  afterLen: number;
};

const SECTION_IDS: readonly MddCanonicalSectionId[] = ["1", "2", "3", "4", "5", "6", "7"];

function normalizeSectionBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/** Compares canonical §1–§7 bodies between two MDD drafts. */
export function diffMddSectionTouches(beforeDraft: string, afterDraft: string): MddSectionDiffResult {
  const before = (beforeDraft ?? "").trim();
  const after = (afterDraft ?? "").trim();
  const sectionsTouched: MddCanonicalSectionId[] = [];
  const sectionLens: MddSectionLens = {};

  for (const id of SECTION_IDS) {
    const num = Number(id);
    const beforeBody = normalizeSectionBody(extractMddSection(before, num));
    const afterBody = normalizeSectionBody(extractMddSection(after, num));
    if (beforeBody !== afterBody) {
      sectionsTouched.push(id);
      sectionLens[id] = { before: beforeBody.length, after: afterBody.length };
    }
  }

  return {
    sectionsTouched,
    sectionLens,
    beforeLen: before.length,
    afterLen: after.length,
  };
}
