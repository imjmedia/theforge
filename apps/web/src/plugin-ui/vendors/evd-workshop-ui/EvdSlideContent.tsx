import type { EvdSlideBase } from "./evd-deck.types";

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1.5 text-sm leading-relaxed">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function NamedItems({
  items,
  render,
}: {
  items: Array<Record<string, unknown>>;
  render: (item: Record<string, unknown>, index: number) => string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2 text-sm leading-relaxed">
      {items.map((item, i) => (
        <li key={i}>{render(item, i)}</li>
      ))}
    </ul>
  );
}

export function EvdSlideContent({ slide }: { slide: EvdSlideBase }) {
  switch (slide.type) {
    case "title":
      return slide.subtitle ? (
        <p className="mt-2 text-lg opacity-90">{String(slide.subtitle)}</p>
      ) : null;

    case "problem_statement":
      return (
        <>
          <BulletList items={(slide.painPoints as string[] | undefined) ?? []} />
          {slide.impact ? <p className="mt-3 text-sm opacity-90">{String(slide.impact)}</p> : null}
          {slide.urgency ? (
            <p className="mt-2 text-xs font-medium uppercase tracking-wide opacity-75">
              {String(slide.urgency)}
            </p>
          ) : null}
        </>
      );

    case "solution_vision":
      return (
        <>
          {slide.description ? <p className="mt-2 text-sm opacity-90">{String(slide.description)}</p> : null}
          <BulletList items={(slide.keyOutcomes as string[] | undefined) ?? []} />
        </>
      );

    case "current_vs_new":
      return (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
              {String(slide.currentLabel ?? "Actual")}
            </p>
            <BulletList items={(slide.currentSteps as string[] | undefined) ?? []} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
              {String(slide.newLabel ?? "Nuevo")}
            </p>
            <BulletList items={(slide.newSteps as string[] | undefined) ?? []} />
          </div>
          {slide.improvementSummary ? (
            <p className="sm:col-span-2 text-sm opacity-90">{String(slide.improvementSummary)}</p>
          ) : null}
        </div>
      );

    case "process_flow":
      return (
        <NamedItems
          items={(slide.steps as Array<Record<string, unknown>> | undefined) ?? []}
          render={(step) => {
            const label = String(step.label ?? "");
            const desc = step.description ? ` — ${String(step.description)}` : "";
            const auto = step.automated ? " (automático)" : "";
            return `${label}${desc}${auto}`;
          }}
        />
      );

    case "automations":
      return (
        <NamedItems
          items={(slide.automations as Array<Record<string, unknown>> | undefined) ?? []}
          render={(a) => {
            const name = String(a.name ?? "");
            const desc = a.description ? `: ${String(a.description)}` : "";
            const saved = a.timeSaved ? ` · ${String(a.timeSaved)}` : "";
            return `${name}${desc}${saved}`;
          }}
        />
      );

    case "key_features":
      return (
        <NamedItems
          items={(slide.features as Array<Record<string, unknown>> | undefined) ?? []}
          render={(f) => {
            const name = String(f.name ?? "");
            const desc = f.description ? `: ${String(f.description)}` : "";
            return `${name}${desc}`;
          }}
        />
      );

    case "integrations":
      return (
        <NamedItems
          items={(slide.integrations as Array<Record<string, unknown>> | undefined) ?? []}
          render={(i) => {
            const name = String(i.name ?? "");
            const purpose = i.purpose ? ` — ${String(i.purpose)}` : "";
            return `${name}${purpose}`;
          }}
        />
      );

    case "rollout_plan":
      return (
        <NamedItems
          items={(slide.phases as Array<Record<string, unknown>> | undefined) ?? []}
          render={(p) => {
            const label = String(p.label ?? "");
            const duration = p.duration ? ` (${String(p.duration)})` : "";
            const desc = p.description ? `: ${String(p.description)}` : "";
            return `${label}${duration}${desc}`;
          }}
        />
      );

    case "timeline":
      return (
        <NamedItems
          items={(slide.milestones as Array<Record<string, unknown>> | undefined) ?? []}
          render={(m) => {
            const label = String(m.label ?? "");
            const date = m.date ? ` · ${String(m.date)}` : "";
            return `${label}${date}`;
          }}
        />
      );

    case "cta":
      return (
        <>
          {slide.description ? <p className="mt-2 text-sm opacity-90">{String(slide.description)}</p> : null}
          {slide.contactInfo ? (
            <p className="mt-3 text-sm font-medium">{String(slide.contactInfo)}</p>
          ) : null}
        </>
      );

    default:
      return null;
  }
}
