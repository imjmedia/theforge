import {
  Children,
  Component,
  isValidElement,
  memo,
  useMemo,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatDocumentMarkdown, peelDocumentBodyForPersist } from "@theforge/shared-types";
import { extractWorkshopDocumentTimestamps } from "@/utils/workshop-document-content.util";
import {
  isCollapsedDirectoryTreeLine,
  splitCollapsedDirectoryTree,
  looksLikeDirectoryTreeParagraph,
} from "@theforge/shared-types/repair-directory-tree";
import { looksLikeAsciiDiagramLine } from "@theforge/shared-types";
import { parseMarkdownSections } from "../utils/markdownSections";
import { prepareMermaidForRender } from "./mermaid-render-prep.util";
import { isMermaidCodeBlock } from "./mermaid-diagram-type.util";
import {
  MermaidBlockErrorBoundary,
  MermaidDiagramBlock,
  mermaidKey,
  preWrapsMermaidBlock,
} from "./MarkdownMermaid";
import {
  MARKDOWN_KATEX_CLASS,
  markdownMathRehypePlugins,
  markdownMathRemarkPlugins,
} from "./markdown-math";
import { WorkshopDocumentStampBar } from "./WorkshopDocumentStampBar";
import type { WorkshopDocumentTimestamps } from "@/utils/workshop-document-content.util";

/**
 * Quita SOLO fences ```mermaid vacíos (sin nada dentro): no hay diagrama que mostrar ni error útil que
 * dar. Los bloques con contenido nunca se descartan por heurística: el bloque muestra el error real del
 * parser junto al código original.
 */
function removeEmptyMermaidFences(content: string): string {
  return content.replace(/^```mermaid\s*\r?\n\s*```\s*$/gm, "");
}

/** Solo espacios ASCII (0x20). Nunca &nbsp; ni espacios Unicode en bloques de código (SQL, JSON, etc.). */
function normalizeCodeBlockToAsciiSpaces(content: string): string {
  return (content ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/** Theme tokens so preview text stays readable in light mode (avoids zinc-300 on pale backgrounds). */
const MARKDOWN_CLASS =
  "text-sm text-[var(--foreground)] [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-[var(--foreground)] [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--foreground)] [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[var(--foreground)] [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_strong]:font-semibold [&_strong]:text-[var(--foreground)] [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-[var(--border)] [&_pre]:bg-[color-mix(in_oklch,var(--muted)_78%,var(--card))] [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:whitespace-pre [&_pre]:text-[var(--foreground)] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:font-mono [&_pre_code]:text-[var(--foreground)] [&_p_code]:rounded [&_p_code]:bg-[color-mix(in_oklch,var(--muted)_62%,var(--card))] [&_p_code]:px-1 [&_p_code]:py-0.5 [&_p_code]:text-[var(--foreground)] [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[var(--border)] [&_th]:bg-[color-mix(in_oklch,var(--muted)_42%,var(--card))] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[var(--foreground)] [&_td]:border [&_td]:border-[var(--border)] [&_td]:px-3 [&_td]:py-2 [&_td]:text-[var(--foreground)] " +
  MARKDOWN_KATEX_CLASS;

function flattenMarkdownChildren(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement(child) && child.props && typeof child.props === "object") {
        const props = child.props as { children?: ReactNode };
        if (props.children != null) return flattenMarkdownChildren(props.children);
      }
      return "";
    })
    .join("");
}

function paragraphLooksLikeDirectoryTree(text: string): boolean {
  if (looksLikeAsciiDiagramLine(text)) return false;
  return looksLikeDirectoryTreeParagraph(text);
}

const TREE_PRE_CLASS =
  "my-3 overflow-x-auto rounded-md border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_78%,var(--card))] p-3 font-mono text-xs leading-[1.35] whitespace-pre text-[var(--foreground)]";

const FENCED_PRE_CLASS = TREE_PRE_CLASS;

/**
 * Constante de módulo: referencia estable entre renders (una identidad nueva de `components` haría que
 * ReactMarkdown re-monte los bloques Mermaid). No necesita closures: todo lo que usa es de módulo.
 */
const MARKDOWN_COMPONENTS: Components = {
  p({ children, ...props }) {
    const text = flattenMarkdownChildren(children);
    if (paragraphLooksLikeDirectoryTree(text)) {
      const collapsed = text.replace(/\s+/g, " ").trim();
      const lines = isCollapsedDirectoryTreeLine(collapsed)
        ? splitCollapsedDirectoryTree(collapsed).join("\n")
        : text;
      return <pre className={TREE_PRE_CLASS}>{lines}</pre>;
    }
    return <p {...props}>{children}</p>;
  },
  pre({ children }) {
    if (preWrapsMermaidBlock(children)) {
      return <>{children}</>;
    }
    return (
      <pre className={FENCED_PRE_CLASS}>
        {children}
      </pre>
    );
  },
  code({ node, className, children, ...props }) {
    // mdast: node.value; hast: node.children[].value; React children (v10 puede pasar nodos)
    const fromNode =
      node && typeof node === "object" && "value" in node && typeof (node as { value?: string }).value === "string"
        ? (node as { value: string }).value
        : "";
    const fromHast =
      node &&
      typeof node === "object" &&
      "children" in node &&
      Array.isArray((node as { children?: unknown[] }).children)
        ? (node as { children: Array<{ type?: string; value?: string }> }).children
            .filter((c) => c?.type === "text" && typeof c.value === "string")
            .map((c) => c.value)
            .join("")
        : "";
    const fromChildren =
      Array.isArray(children) && children.every((c) => typeof c === "string")
        ? (children as string[]).join("")
        : typeof children === "string"
          ? children
          : String(children ?? "");
    const source = (fromNode || fromHast || fromChildren).replace(/\n$/, "").trim();
    const isTextLang = /\blanguage-text\b/i.test(className ?? "");
    if (isTextLang) {
      return (
        <code className={`${className ?? ""} font-mono text-xs whitespace-pre`} {...props}>
          {normalizeCodeBlockToAsciiSpaces(source)}
        </code>
      );
    }
    const isInlineCode =
      !/\blanguage-[\w-]+\b/i.test(className ?? "") && !source.includes("\n");
    if (isInlineCode) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    const looksLikeMetadataOnly = /^\[\w+\](\s+\[\w+\])*$/.test(source.trim());
    if (looksLikeMetadataOnly) {
      return (
        <span className="text-xs text-[var(--muted-foreground)]" aria-label="Metadata técnica">
          {source}
        </span>
      );
    }
    if (isMermaidCodeBlock(source, className)) {
      // Fuente crudo: solo envoltorios de fence y espacios Unicode. La reparación la decide el bloque
      // con el parser real (original primero), así que aquí no hay heurísticas de sintaxis.
      const prepared = prepareMermaidForRender(source);
      if (!prepared.trim()) {
        return (
          <code className={className} {...props}>
            {normalizeCodeBlockToAsciiSpaces(source)}
          </code>
        );
      }
      const key = mermaidKey(prepared);
      return (
        <MermaidBlockErrorBoundary key={key} content={prepared} blockKey={key}>
          <MermaidDiagramBlock blockKey={key} content={prepared} />
        </MermaidBlockErrorBoundary>
      );
    }
    return (
      <code className={`${className ?? ""} font-mono text-xs whitespace-pre`} {...props}>
        {normalizeCodeBlockToAsciiSpaces(source)}
      </code>
    );
  },
};

const MdSection = memo(function MdSection({ content }: { content: string }) {
  return (
    <div className={MARKDOWN_CLASS}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...markdownMathRemarkPlugins]}
        rehypePlugins={[...markdownMathRehypePlugins]}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

interface MddViewerProps {
  content: string;
  className?: string;
  /** Fechas API (Creado / Última regeneración) — visibles aunque el editor no incluya el stamp. */
  documentTimestamps?: WorkshopDocumentTimestamps | null;
}

class MddViewerErrorBoundary extends Component<
  { content: string; className?: string; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prev: { content: string }) {
    if (prev.content !== this.props.content && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch() {
    // Evita que un diagrama Mermaid roto o cualquier error en el árbol blanquee todo el front.
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={`space-y-4 min-w-0 ${this.props.className ?? ""}`}>
          <p className="text-sm text-[var(--warning)]">
            Error al mostrar el documento. Contenido en modo texto:
          </p>
          <pre className="max-h-[80vh] overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_78%,var(--card))] p-4 text-sm text-[var(--foreground)]">
            {this.props.content}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Visualizador de MDD por secciones: solo re-renderiza las secciones cuyo contenido cambió,
 * evitando parpadeo al hacer streaming o al actualizar el documento.
 */
function MddViewerInner({ content, className = "", documentTimestamps }: MddViewerProps) {
  const timestamps =
    documentTimestamps ?? extractWorkshopDocumentTimestamps(content);
  const body = peelDocumentBodyForPersist(content);
  // `preserve`: los fences ```mermaid llegan al bloque tal cual; el visor no los reescribe.
  const cleaned = useMemo(
    () => removeEmptyMermaidFences(formatDocumentMarkdown(body, { mermaid: "preserve" })),
    [body],
  );
  const sections = useMemo(() => parseMarkdownSections(cleaned), [cleaned]);

  return (
    <div className={`space-y-4 markdown-preview min-w-0 pb-[80px] ${className}`}>
      <WorkshopDocumentStampBar timestamps={timestamps} />
      {sections.map((section) => (
        <MdSection key={section.id} content={section.content} />
      ))}
    </div>
  );
}

export default function MddViewer(props: MddViewerProps) {
  return (
    <MddViewerErrorBoundary content={props.content} className={props.className}>
      <MddViewerInner {...props} />
    </MddViewerErrorBoundary>
  );
}
