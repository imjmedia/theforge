import {
  extractBestSection5Body,
  extractSection4Body,
  extractSection5Body,
} from "./mdd-sanitize/section-merge.js";

/** Diagnóstico compacto §4/§5 y paridad de fences antes/después de persist. */
export function logMddPersistFenceDiag(tag: string, draft: string): void {
  const text = draft ?? "";
  const draftLen = text.length;
  const s4Body = extractSection4Body(text);
  const s4Len = s4Body?.length ?? 0;
  const s5Len = extractSection5Body(text)?.length ?? 0;
  const s5best = extractBestSection5Body(text)?.length ?? 0;
  const fenceCount = (text.match(/```/g) ?? []).length;
  const fenceOdd = fenceCount % 2 === 1;
  const s4embedsS5 = !!(s4Body && /##\s*5\.\s*Lógica/i.test(s4Body));
  console.log(
    `[MDD:PersistDiag] ${tag} draftLen=${draftLen} §4=${s4Len} §5=${s5Len} §5best=${s5best} fences=${fenceCount}${fenceOdd ? " IMPAR" : ""} §4embeds§5=${s4embedsS5}`,
  );
}
