import { useState, useEffect, useMemo, type ReactNode, type RefObject } from "react";
import { motion, AnimatePresence, type Transition } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type HeadingData = {
  id: string;
  text: string;
  level: number;
  element: HTMLElement;
};

const islandTransition: Transition = {
  type: "tween",
  ease: [0.22, 1, 0.36, 1],
  duration: 0.5,
};

const DEFAULT_SELECTOR =
  ".markdown-preview h1, .markdown-preview h2, .markdown-preview h3, .markdown-preview h4, .markdown-preview [data-toc], article h1, article h2, article h3, article h4, .prose h1, .prose h2, .prose h3, .prose h4, [data-toc]";

function findScrollParentForHeading(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node) {
    const style = getComputedStyle(node);
    const canScrollY = style.overflowY === "auto" || style.overflowY === "scroll";
    if (canScrollY && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

function resolveScrollHost(
  headings: HeadingData[],
  workspaceFallback: HTMLElement | null,
): HTMLElement | null {
  return findScrollParentForHeading(headings[0]?.element ?? null) ?? workspaceFallback;
}

function isScrollWindow(host: HTMLElement | Window): host is Window {
  return host === window;
}

function getHostScrollTop(host: HTMLElement | Window): number {
  return isScrollWindow(host) ? window.scrollY : host.scrollTop;
}

function getHostScrollProgress(host: HTMLElement | Window): number {
  if (isScrollWindow(host)) {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    return total > 0 ? Math.min(100, Math.max(0, (window.scrollY / total) * 100)) : 0;
  }
  const total = host.scrollHeight - host.clientHeight;
  return total > 0 ? Math.min(100, Math.max(0, (host.scrollTop / total) * 100)) : 0;
}

/** Scroll offset of a heading inside its scroll host (stable vs. getBoundingClientRect loops). */
function getHeadingScrollTop(headingEl: HTMLElement, host: HTMLElement | Window): number {
  if (isScrollWindow(host)) {
    return headingEl.getBoundingClientRect().top + window.scrollY;
  }
  return headingEl.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;
}

/**
 * Pick the section whose heading the reader has reached — not the next one peeking at the top.
 * Walk headings from bottom to top: last heading at or above the read marker wins.
 */
function resolveActiveHeadingId(
  headings: HeadingData[],
  host: HTMLElement | Window,
  activationOffset = 160,
): string | null {
  if (headings.length === 0) return null;

  const readMarker = getHostScrollTop(host) + activationOffset;

  for (let i = headings.length - 1; i >= 0; i--) {
    const heading = headings[i];
    if (!heading) continue;
    const headingTop = getHeadingScrollTop(heading.element, host);
    if (headingTop <= readMarker) {
      return heading.id;
    }
  }

  return headings[0]?.id ?? null;
}

/** Matches workshop cards / doc chrome (warm card surface + primary accent). */
const ISLAND_SHELL_CLASS =
  "relative overflow-hidden border border-[color-mix(in_oklch,var(--primary)_24%,var(--border))] bg-[color-mix(in_oklch,var(--card)_92%,var(--background))] text-[var(--foreground)] shadow-[var(--shadow-lg),var(--shadow-gold)]";

function CircleProgress({ percentage }: { percentage: number }) {
  const size = 24;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0" aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--border)"
        strokeWidth={strokeWidth}
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        strokeLinecap="round"
      />
    </svg>
  );
}

export type DynamicIslandTOCProps = {
  children?: ReactNode;
  /** CSS selector to find headings (scoped to scroll root when provided). */
  selector?: string;
  /** Scroll host for workshop panels (defaults to window). */
  scrollContainerRef?: RefObject<HTMLElement | null>;
  /** Re-scan headings when document content or panel changes. */
  contentKey?: string;
  /** Minimum headings before showing the island. */
  minHeadings?: number;
  className?: string;
};

function collectHeadings(root: ParentNode, selector: string): HeadingData[] {
  const elements = Array.from(root.querySelectorAll(selector)) as HTMLElement[];

  const validHeadings = elements
    .filter((el) => !el.hasAttribute("data-toc-ignore"))
    .map((el, index) => {
      if (!el.id) {
        const generatedId =
          el.textContent
            ?.toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^\w-]/g, "") || `toc-heading-${index}`;
        el.id = generatedId;
      }

      const depthAttr = el.getAttribute("data-toc-depth");
      let level = 2;

      if (depthAttr) {
        level = parseInt(depthAttr, 10);
      } else {
        const tagName = el.tagName.toUpperCase();
        if (tagName.startsWith("H") && tagName.length === 2) {
          const levelChar = tagName.charAt(1);
          if (levelChar) level = parseInt(levelChar, 10);
        }
      }

      const text = el.getAttribute("data-toc-title") || el.textContent || "Section";

      return { id: el.id, text, level, element: el };
    });

  validHeadings.sort((a, b) =>
    a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );

  return validHeadings;
}

export function DynamicIslandTOC({
  children,
  selector = DEFAULT_SELECTOR,
  scrollContainerRef,
  contentKey,
  minHeadings = 2,
  className,
}: DynamicIslandTOCProps) {
  const [headings, setHeadings] = useState<HeadingData[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    function scanHeadings() {
      const root = scrollContainerRef?.current ?? document;
      const collected = collectHeadings(root, selector);
      const workspaceEl = scrollContainerRef?.current ?? null;
      const resolvedHost = resolveScrollHost(collected, workspaceEl);
      setScrollHost(resolvedHost);
      setHeadings(collected);
    }

    const initialTimer = globalThis.setTimeout(scanHeadings, 100);

    const root = scrollContainerRef?.current;
    const observer =
      root &&
      new MutationObserver(() => {
        if (debounceTimer !== null) globalThis.clearTimeout(debounceTimer);
        debounceTimer = globalThis.setTimeout(scanHeadings, 150);
      });

    if (observer && root) {
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    }

    return () => {
      globalThis.clearTimeout(initialTimer);
      if (debounceTimer !== null) globalThis.clearTimeout(debounceTimer);
      observer?.disconnect();
    };
  }, [selector, scrollContainerRef, contentKey]);

  useEffect(() => {
    function handleScroll() {
      const host: HTMLElement | Window = scrollHost ?? scrollContainerRef?.current ?? window;
      setActiveId(resolveActiveHeadingId(headings, host));
      setProgress(getHostScrollProgress(host));
    }

    const target: HTMLElement | Window = scrollHost ?? scrollContainerRef?.current ?? window;

    target.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => target.removeEventListener("scroll", handleScroll);
  }, [headings, scrollHost, scrollContainerRef, contentKey]);

  const activeHeading = headings.find((h) => h.id === activeId);

  const minLevel = useMemo(() => {
    if (headings.length === 0) return 1;
    return Math.min(...headings.map((h) => h.level));
  }, [headings]);

  if (headings.length < minHeadings) {
    return children ? <>{children}</> : null;
  }

  function handleHeadingClick(heading: HeadingData) {
    const yOffset = -80;
    const host =
      findScrollParentForHeading(heading.element) ??
      scrollHost ??
      scrollContainerRef?.current ??
      null;

    if (host) {
      const containerTop = host.getBoundingClientRect().top;
      const headingTop = heading.element.getBoundingClientRect().top;
      const y = headingTop - containerTop + host.scrollTop + yOffset;
      host.scrollTo({ top: y, behavior: "smooth" });
    } else {
      const y = heading.element.getBoundingClientRect().top + window.scrollY + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }

    setIsExpanded(false);
  }

  return (
    <>
      {children}

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={islandTransition}
            className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/60 backdrop-blur-sm"
            onClick={() => setIsExpanded(false)}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className={cn(
          "fixed bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center",
          // Collapsed: stay below workshop semáforo flyout (z-35). Expanded: popover layer above backdrop.
          isExpanded ? "z-[var(--z-popover)]" : "z-20",
          className,
        )}
      >
        <motion.div
          onClick={() => {
            if (!isExpanded) setIsExpanded(true);
          }}
          initial={false}
          animate={{
            width: isExpanded ? 340 : 280,
            height: isExpanded ? 400 : 52,
            borderRadius: isExpanded ? 24 : 26,
          }}
          transition={islandTransition}
          style={{ cursor: isExpanded ? "default" : "pointer" }}
          className={ISLAND_SHELL_CLASS}
        >
          <motion.div
            initial={false}
            animate={{
              opacity: isExpanded ? 0 : 1,
              scale: isExpanded ? 0.95 : 1,
              filter: isExpanded ? "blur(4px)" : "blur(0px)",
            }}
            transition={{ ...islandTransition, delay: isExpanded ? 0 : 0.1 }}
            className={cn("absolute inset-0 flex items-center gap-4 px-4 sm:px-5", isExpanded && "pointer-events-none")}
          >
            <div
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--primary)] shadow-[0_0_8px_color-mix(in_oklch,var(--primary)_45%,transparent)]"
              aria-hidden
            />

            <div className="relative flex h-full flex-1 items-center overflow-hidden text-left">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={activeId || "empty"}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-[var(--foreground)]"
                >
                  {activeHeading?.text || "Índice"}
                </motion.span>
              </AnimatePresence>
            </div>

            <CircleProgress percentage={progress} />
          </motion.div>

          <motion.div
            initial={false}
            animate={{
              opacity: isExpanded ? 1 : 0,
              scale: isExpanded ? 1 : 1.05,
            }}
            transition={{ ...islandTransition, delay: isExpanded ? 0.1 : 0 }}
            className={cn("absolute inset-0 flex flex-col", !isExpanded && "pointer-events-none")}
          >
            <div className="flex shrink-0 items-center justify-between px-6 pb-3 pt-5">
              <span className="text-[11px] font-semibold tracking-[0.08em] text-[var(--foreground-subtle)]">
                ÍNDICE DEL DOCUMENTO
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(false);
                }}
                className="text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                aria-label="Cerrar índice"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div
              className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4"
              data-lenis-prevent="true"
            >
              <div className="flex flex-col gap-0.5">
                {headings.map((h) => {
                  const isActive = activeId === h.id;
                  const isHovered = hoveredId === h.id;
                  const indentLevel = Math.max(0, h.level - minLevel);
                  const paddingLeft = indentLevel * 14 + 12;

                  return (
                    <button
                      key={h.id}
                      type="button"
                      onMouseEnter={() => setHoveredId(h.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleHeadingClick(h);
                      }}
                      style={{ paddingLeft: `${paddingLeft}px` }}
                      className={cn(
                        "group flex w-full shrink-0 cursor-pointer items-center rounded-lg border-none py-2 pr-3 text-left text-sm transition-all duration-300 ease-[var(--transition-base)]",
                        isActive &&
                          "bg-[color-mix(in_oklch,var(--primary)_14%,var(--card))] font-medium text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_22%,transparent)]",
                        !isActive &&
                          isHovered &&
                          "bg-[color-mix(in_oklch,var(--muted)_55%,transparent)] text-[var(--foreground)]",
                        !isActive && !isHovered && "bg-transparent text-[var(--foreground-subtle)]",
                      )}
                    >
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap transition-transform duration-300 group-hover:translate-x-1">
                        {h.text}
                      </span>

                      <motion.div
                        initial={false}
                        animate={{ scale: isActive ? 1 : 0, opacity: isActive ? 1 : 0 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        className="ml-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </>
  );
}
