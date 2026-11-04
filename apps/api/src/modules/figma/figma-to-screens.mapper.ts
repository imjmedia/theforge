import {
  designSpecScreenIdRegex,
  type DesignSpecNavigation,
  type DesignSpecScreen,
} from "@theforge/shared-types";

export type FigmaFileNode = {
  id: string;
  name: string;
  type: string;
  transitionNodeID?: string | null;
  children?: FigmaFileNode[];
};

export type FigmaFileDocument = {
  document?: FigmaFileNode;
};

export type MapFigmaToScreensInput = {
  fileKey: string;
  file: FigmaFileDocument;
  /** Limit import to these node ids (Figma format `1:2`). */
  nodeIds?: string[];
};

export type MapFigmaToScreensResult = {
  screens: DesignSpecScreen[];
  navigation: DesignSpecNavigation[];
  issues: string[];
};

function slugifyScreenId(name: string, index: number): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  const candidate = base.length >= 2 ? base : `screen-${index + 1}`;
  return designSpecScreenIdRegex.test(candidate) ? candidate : `screen-${index + 1}`;
}

function routeForScreenId(id: string): string {
  return id === "home" ? "/" : `/${id}`;
}

function collectFrames(root: FigmaFileNode | undefined, filter?: Set<string>): FigmaFileNode[] {
  if (!root) return [];
  const frames: FigmaFileNode[] = [];
  const walk = (node: FigmaFileNode) => {
    if (node.type === "FRAME") {
      if (!filter || filter.has(node.id)) frames.push(node);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return frames;
}

function mapTextComponents(frame: FigmaFileNode, screenId: string): DesignSpecScreen["components"] {
  const components: DesignSpecScreen["components"] = [];
  let textIndex = 0;
  const walk = (node: FigmaFileNode) => {
    if (node.type === "TEXT") {
      textIndex += 1;
      const label = node.name?.trim() || `Texto ${textIndex}`;
      components.push({
        id: `${screenId}-text-${textIndex}`,
        component: "Text",
        label,
        props: { content: label },
      });
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const child of frame.children ?? []) walk(child);
  if (components.length === 0) {
    components.push({
      id: `${screenId}-frame`,
      component: "Frame",
      label: frame.name,
    });
  }
  return components;
}

export function mapFigmaFileToScreens(input: MapFigmaToScreensInput): MapFigmaToScreensResult {
  const filter = input.nodeIds?.length ? new Set(input.nodeIds.map((id) => id.trim())) : undefined;
  const frames = collectFrames(input.file.document, filter);
  const issues: string[] = [];
  const nodeIdToScreenId = new Map<string, string>();
  const screens: DesignSpecScreen[] = [];

  frames.forEach((frame, index) => {
    const id = slugifyScreenId(frame.name, index);
    nodeIdToScreenId.set(frame.id, id);
    screens.push({
      id,
      name: frame.name.trim() || id,
      route: routeForScreenId(id),
      roles: [],
      states: [],
      origin: {
        kind: "figma",
        fileKey: input.fileKey,
        nodeId: frame.id,
        ref: frame.name,
      },
      components: mapTextComponents(frame, id),
    });
  });

  const navigation: DesignSpecNavigation[] = [];
  for (const frame of frames) {
    const fromId = nodeIdToScreenId.get(frame.id);
    if (!fromId) continue;
    const dest = frame.transitionNodeID?.trim();
    if (!dest) continue;
    const toId = nodeIdToScreenId.get(dest);
    if (!toId) {
      issues.push(
        `Transición desde «${frame.name}» (${frame.id}) apunta a un nodo no importado (${dest})`,
      );
      continue;
    }
    navigation.push({
      id: `${fromId}-to-${toId}`,
      from: fromId,
      to: toId,
      trigger: { event: "prototypeNavigate" },
    });
  }

  return { screens, navigation, issues };
}
