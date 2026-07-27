import type { PrismaService } from "../../../prisma/prisma.service.js";
import {
  appendArchitectureDecisionToScaffold,
  buildArchitectureDecisionFromGap,
  listArchitectureDecisionFiles,
} from "../../documentation-gap/architecture-decision.util.js";

export type SimpleProjectAdr = {
  title: string;
  context: string;
  consequence: string;
  status?: "Accepted" | "Proposed" | "Superseeded";
};

/** Persiste ADRs en agentGovernanceContent (sin FalkorDB). */
export async function persistProjectAdrsToGovernance(
  prisma: PrismaService,
  projectId: string,
  adrs: SimpleProjectAdr[],
): Promise<void> {
  if (!adrs.length) return;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { agentGovernanceContent: true },
  });
  if (!project) return;

  let content = project.agentGovernanceContent;
  for (const adr of adrs) {
    const existingFiles = listArchitectureDecisionFiles(content);
    const record = buildArchitectureDecisionFromGap(
      {
        description: adr.title.trim(),
        affectedArtifacts: [],
        evidence: {
          reference: "docs/sdd/mdd.md",
          snippet: [adr.context.trim(), adr.consequence.trim()].filter(Boolean).join("\n\n"),
        },
      },
      "auto-deterministic",
      { existingFiles },
    );
    const { serialized, appended } = appendArchitectureDecisionToScaffold(content, record);
    if (appended) content = serialized;
  }

  if (content !== project.agentGovernanceContent) {
    await prisma.project.update({
      where: { id: projectId },
      data: { agentGovernanceContent: content },
    });
  }
}

/** ADRs persistidos en agentGovernanceContent (sin FalkorDB). */
export function listProjectAdrsFromGovernance(
  agentGovernanceContent: string | null | undefined,
): Array<{ title: string; context: string; consequence: string; status: string }> {
  return listArchitectureDecisionFiles(agentGovernanceContent).map((file) => {
    const content = file.content ?? "";
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim() ?? file.path.split("/").pop() ?? "ADR";
    const contextMatch = content.match(/##\s+Contexto\s*\n+([\s\S]*?)(?=\n##\s|$)/i);
    const consequenceMatch = content.match(/##\s+Consecuencias?\s*\n+([\s\S]*?)(?=\n##\s|$)/i);
    const statusMatch = content.match(/Estado:\s*(\w+)/i);
    return {
      title,
      context: (contextMatch?.[1] ?? "").trim().slice(0, 2000),
      consequence: (consequenceMatch?.[1] ?? content).trim().slice(0, 2000),
      status: statusMatch?.[1] ?? "Accepted",
    };
  });
}
