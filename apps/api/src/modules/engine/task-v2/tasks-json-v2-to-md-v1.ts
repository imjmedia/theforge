/**
 * Convierte tasks.json v2 (salida del inference engine) a tasks.md v1.
 * Formato v1 = markdown con checkboxes, compatible con parseTasksMarkdown de shared-types.
 */

export function convertTasksJsonV2ToTasksMdV1(tasksJson: unknown): string {
  if (!tasksJson || typeof tasksJson !== "object") return "";
  const root = tasksJson as Record<string, any>;
  const tasks = Array.isArray(root.tasks) ? root.tasks : [];
  if (tasks.length === 0) return "";

  const lines: string[] = [];
  lines.push("# Plan de Implementación");
  lines.push(`> Generado automáticamente desde tasks.json v2 (${root.generatedAt ?? new Date().toISOString()})`);
  lines.push("");

  // Agrupar por sección > checkpoint
  const grouped = new Map<
    string,
    Map<string, any[]>
  >();
  for (const task of tasks) {
    const section = String(task.section ?? "General");
    const checkpoint = String(task.checkpoint ?? "General");
    if (!grouped.has(section)) grouped.set(section, new Map());
    const cpMap = grouped.get(section)!;
    if (!cpMap.has(checkpoint)) cpMap.set(checkpoint, []);
    cpMap.get(checkpoint)!.push(task);
  }

  for (const [section, checkpoints] of grouped) {
    lines.push(`## ${section}`);
    lines.push("");
    for (const [checkpoint, cpTasks] of checkpoints) {
      if (checkpoint !== "General") {
        lines.push(`**Checkpoint**: ${checkpoint}`);
        lines.push("");
      }
      for (const task of cpTasks) {
        const parallel = task.parallel ? "[P] " : "";
        const done = String(task.status ?? "").toLowerCase() === "done";
        lines.push(`- [${done ? "x" : " "}] ${parallel}${task.id}: ${task.title}`);
        if (Array.isArray(task.targetFiles) && task.targetFiles.length) {
          lines.push(`  - **Files:** ${task.targetFiles.map((f: string) => "`" + f + "`").join(", ")}`);
        }
        if (Array.isArray(task.dependencies) && task.dependencies.length) {
          lines.push(`  - **Depends:** ${task.dependencies.join(", ")}`);
        }
        if (Array.isArray(task.inferenceRules) && task.inferenceRules.length) {
          lines.push(`  - **Inference:** ${task.inferenceRules.join(", ")}`);
        }
        if (task.codeExpected) {
          lines.push(`  - **Code snippet:** \`${task.language ?? "ts"}\``);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
