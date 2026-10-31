import { useMemo } from "react";
import { Eye } from "lucide-react";
import type { MddEvalCaseSummaryDto, MddEvalComplexityDto } from "@theforge/shared-types";
import { Badge, Button } from "@/components/ui";
import { complexityLabel, complexityTone } from "@/utils/mddEvalFormat";

const COMPLEXITIES: MddEvalComplexityDto[] = ["LOW", "MEDIUM", "HIGH"];

interface MddEvalCasesTableProps {
  cases: MddEvalCaseSummaryDto[];
  selected: ReadonlySet<string>;
  onSelectionChange: (next: Set<string>) => void;
  onOpenDetail: (caseId: string) => void;
  disabled?: boolean;
}

export function MddEvalCasesTable({
  cases,
  selected,
  onSelectionChange,
  onOpenDetail,
  disabled = false,
}: MddEvalCasesTableProps) {
  const allSelected = cases.length > 0 && cases.every((c) => selected.has(c.id));
  const someSelected = !allSelected && cases.some((c) => selected.has(c.id));

  const countByComplexity = useMemo(() => {
    const counts: Record<MddEvalComplexityDto, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    for (const c of cases) counts[c.complexity] += 1;
    return counts;
  }, [cases]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const selectComplexity = (complexity: MddEvalComplexityDto) => {
    onSelectionChange(new Set(cases.filter((c) => c.complexity === complexity).map((c) => c.id)));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[var(--foreground-muted)]">
          {selected.size} de {cases.length} seleccionados
        </span>
        <span className="text-[var(--foreground-muted)]">·</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onSelectionChange(new Set(cases.map((c) => c.id)))}
        >
          Todos
        </Button>
        {COMPLEXITIES.map((complexity) => (
          <Button
            key={complexity}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || countByComplexity[complexity] === 0}
            onClick={() => selectComplexity(complexity)}
          >
            Solo {complexityLabel(complexity).toLowerCase()} ({countByComplexity[complexity]})
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || selected.size === 0}
          onClick={() => onSelectionChange(new Set())}
        >
          Limpiar
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border border-[var(--border)]">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead className="bg-[var(--muted)]/50 text-left text-xs uppercase tracking-wide text-[var(--foreground-muted)]">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos los casos"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  disabled={disabled}
                  onChange={() => onSelectionChange(allSelected ? new Set() : new Set(cases.map((c) => c.id)))}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
              </th>
              <th className="px-3 py-2">Caso</th>
              <th className="px-3 py-2">Dominio</th>
              <th className="px-3 py-2">Complejidad</th>
              <th className="px-3 py-2">Umbrales</th>
              <th className="px-3 py-2">Insumos</th>
              <th className="w-12 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {cases.map((c) => (
              <tr key={c.id} className="align-top hover:bg-[var(--muted)]/30">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${c.id}`}
                    checked={selected.has(c.id)}
                    disabled={disabled}
                    onChange={() => toggle(c.id)}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-[var(--foreground)]">{c.title}</p>
                  <p className="font-mono text-xs text-[var(--foreground-muted)]">{c.id}</p>
                </td>
                <td className="px-3 py-2 text-[var(--foreground)]">{c.domain}</td>
                <td className="px-3 py-2">
                  <Badge variant={complexityTone(c.complexity)}>{complexityLabel(c.complexity)}</Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--foreground-muted)]">
                  <div>Rúbrica ≥ {c.minRubric}</div>
                  <div>Auditor ≥ {c.minAuditor}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {c.hasDbga ? <Badge variant="outline">DBGA</Badge> : null}
                    {c.hasBrd ? <Badge variant="outline">BRD</Badge> : null}
                    {!c.hasDbga && !c.hasBrd ? <span className="text-[var(--foreground-muted)]">—</span> : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Ver detalle de ${c.id}`}
                    onClick={() => onOpenDetail(c.id)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
