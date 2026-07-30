/**
 * @fileoverview Raíz de la SPA The Forge: estado de sesión (JWT), lista de proyectos, login OTP y vista principal
 * **Workshop** (`WorkshopView`). Comunicación HTTP centralizada vía `apiClient`.
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { selectWorkshopAgentsBusy, useWorkshopStore } from "./store/workshopStore";
import {
  AlertTriangle,
  Pin,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Heart,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import LoginView from "./views/LoginView";
import OtpEmailHandoffView from "./views/OtpEmailHandoffView";
import SetupView from "./views/SetupView";
import SettingsView from "./views/SettingsView";
import UsersView from "./views/UsersView";
import { CreateProjectWizardDialog } from "./components/CreateProjectWizardDialog";
import { ProjectMergeDialog } from "./components/ProjectMergeDialog";
import { ProjectSettingsDialog } from "./components/ProjectSettingsDialog";
import { CreateProjectGroupDialog } from "./components/CreateProjectGroupDialog";
import { CloneProjectDialog } from "./components/CloneProjectDialog";
import { ProjectFolderTile } from "./components/ProjectFolderTile";
import { ProjectSelectionToolbar } from "./components/ProjectSelectionToolbar";
import { DashboardSidebar } from "./components/DashboardSidebar";
import { DashboardPanelHeader } from "./components/DashboardPanelHeader";
import { ProjectTutorialDialog } from "./components/ProjectTutorialDialog";
import {
  ProjectPortabilityDialog,
  type ProjectPortabilityMode,
} from "./components/ProjectPortabilityDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  apiFetch,
  clearAccessToken,
  getAccessToken,
  API_BASE,
  getStoredUser,
  refreshStoredUserFromApi,
} from "./utils/apiClient";
import { cn } from "./lib/utils";
import { useDashboardGenerationSummary } from "./hooks/useDashboardGenerationSummary";
import {
  Button,
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  EmptyState,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui";
type Status = "ROJO" | "AMARILLO" | "VERDE";

interface Project {
  id: string;
  name: string;
  userId?: string;
  groupId?: string;
  groupName?: string;
  status: Status;
  precisionScore: number;
  hasUxTeam: boolean;
  projectType?: "NEW" | "LEGACY";
  visibility?: "PRIVATE" | "SHARED";
  theforgeProjectId?: string | null;
  createdAt: string;
  isFavorite?: boolean;
}

interface ProjectGroup {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
}

interface TheForgeProjectRoot {
  id: string;
  name?: string;
  branch?: string;
}

interface TheForgeProject {
  id: string;
  name: string;
  roots?: TheForgeProjectRoot[];
  rootPath?: string;
  branch?: string;
}

interface TheForgeRepository {
  id: string;
  name: string;
  branch?: string;
}

const WorkshopView = lazy(() => import("./views/WorkshopView"));

const SIDEBAR_COLLAPSED_KEY = "theforge-sidebar-collapsed";

function WorkshopViewFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-[var(--background)] text-[var(--foreground-muted)]">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <span className="text-sm">Cargando taller…</span>
    </div>
  );
}

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function isOtpEmailHandoffPath(): boolean {
  const path = window.location.pathname.replace(/\/$/, "");
  return path === "/auth/otp" || path === "/auth/magic-link";
}

export default function App() {
  const [authed, setAuthed] = useState(() => !!getAccessToken());
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectGroups, setProjectGroups] = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [workshopProject, setWorkshopProject] = useState<Project | null>(null);
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState<Project[] | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<Project | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false);
  const [createGroupLoading, setCreateGroupLoading] = useState(false);
  const [createGroupForWizard, setCreateGroupForWizard] = useState(false);
  const [wizardPendingGroupId, setWizardPendingGroupId] = useState<string | null>(null);
  const [groupRenameTarget, setGroupRenameTarget] = useState<ProjectGroup | null>(null);
  const [groupRenameOpen, setGroupRenameOpen] = useState(false);
  const [groupRenameName, setGroupRenameName] = useState("");
  const [groupRenameLoading, setGroupRenameLoading] = useState(false);
  const [groupDeleteTarget, setGroupDeleteTarget] = useState<ProjectGroup | null>(null);
  const [groupDeleteOpen, setGroupDeleteOpen] = useState(false);
  const [groupDeleteLoading, setGroupDeleteLoading] = useState(false);
  const [groupMoveFirstLoadingId, setGroupMoveFirstLoadingId] = useState<string | null>(null);
  const [draggingProject, setDraggingProject] = useState<{
    projectId: string;
    sourceGroupId: string;
  } | null>(null);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
  const [moveProjectLoadingId, setMoveProjectLoadingId] = useState<string | null>(null);
  const [cloneTarget, setCloneTarget] = useState<Project | null>(null);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [cloneLoading, setCloneLoading] = useState(false);
  const [mergeAuditHint, setMergeAuditHint] = useState<{
    type: string;
    threadId?: string;
    question?: string;
    n?: number;
    total?: number;
    message?: string;
  } | null>(null);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [portabilityOpen, setPortabilityOpen] = useState(false);
  const [portabilityMode, setPortabilityMode] = useState<ProjectPortabilityMode>("import");
  const [showTheForgeModal, setShowTheForgeModal] = useState(false);
  const [usersViewOpen, setUsersViewOpen] = useState(false);
  const [settingsViewOpen, setSettingsViewOpen] = useState(false);
  const [showIaCost, setShowIaCost] = useState(() => localStorage.getItem("theforge_show_ia_cost") !== "0");
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [theforgeModalTab, setTheForgeModalTab] = useState<"projects" | "repos">("projects");
  const [theforgeProjects, setTheForgeProjects] = useState<TheForgeProject[]>([]);
  const [theforgeAvailable, setTheForgeAvailable] = useState(false);
  const [theforgeLoading, setTheForgeLoading] = useState(false);
  const [projectTypeFilter, setProjectTypeFilter] = useState<
    "all" | "NEW" | "LEGACY" | "favorites"
  >("all");
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);

  const handleToggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const theforgeRepositories = useMemo((): TheForgeRepository[] => {
    const byId = new Map<string, TheForgeRepository>();
    for (const p of theforgeProjects) {
      if (p.roots?.length) {
        for (const r of p.roots) {
          if (!byId.has(r.id))
            byId.set(r.id, { id: r.id, name: r.name ?? r.id, branch: r.branch });
        }
      } else {
        byId.set(p.id, { id: p.id, name: p.name, branch: p.branch });
      }
    }
    return Array.from(byId.values());
  }, [theforgeProjects]);

  const projectList = useMemo(
    () => (Array.isArray(projects) ? projects : []),
    [projects],
  );

  const favoriteProjectCount = useMemo(
    () => projectList.filter((p) => p.isFavorite).length,
    [projectList],
  );

  const filteredProjects = useMemo(() => {
    if (projectTypeFilter === "all") return projectList;
    if (projectTypeFilter === "favorites") {
      return projectList.filter((p) => p.isFavorite);
    }
    return projectList.filter((p) => (p.projectType ?? "NEW") === projectTypeFilter);
  }, [projectList, projectTypeFilter]);

  const displayedProjects = useMemo(() => {
    const q = projectSearchQuery.trim().toLowerCase();
    if (!q) return filteredProjects;
    return filteredProjects.filter((p) => p.name.toLowerCase().includes(q));
  }, [filteredProjects, projectSearchQuery]);

  const displayedProjectIds = useMemo(() => displayedProjects.map((p) => p.id), [displayedProjects]);
  const generationSummaries = useDashboardGenerationSummary(
    displayedProjectIds,
    authed && !workshopProject && !settingsViewOpen && !usersViewOpen,
  );

  const projectsByGroupId = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of displayedProjects) {
      const gid = p.groupId ?? "";
      const list = map.get(gid) ?? [];
      list.push(p);
      map.set(gid, list);
    }
    return map;
  }, [displayedProjects]);

  const loadProjectGroups = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/project-groups`);
      const raw = await r.text();
      let data: unknown = null;
      if (raw) {
        try {
          data = JSON.parse(raw) as unknown;
        } catch {
          data = null;
        }
      }
      if (!r.ok || !Array.isArray(data)) {
        setProjectGroups([]);
        return;
      }
      setProjectGroups(data as ProjectGroup[]);
    } catch {
      setProjectGroups([]);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`${API_BASE}/projects`);
      const raw = await r.text();
      let data: unknown = null;
      if (raw) {
        try {
          data = JSON.parse(raw) as unknown;
        } catch {
          data = null;
        }
      }
      if (!r.ok || !Array.isArray(data)) {
        setProjects([]);
        return;
      }
      setProjects(data as Project[]);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshDashboard = useCallback(async () => {
    await Promise.all([loadProjects(), loadProjectGroups()]);
  }, [loadProjects, loadProjectGroups]);

  const handleToggleFavorite = useCallback(async (id: string) => {
    try {
      const r = await apiFetch(`${API_BASE}/projects/${id}/favorite`, {
        method: "POST",
      });
      if (!r.ok) return;
      const result = (await r.json()) as { favorited: boolean };
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, isFavorite: result.favorited } : p)),
      );
    } catch {
      // silencioso
    }
  }, []);

  const createProject = useCallback(
    async (name: string, groupId: string) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Nombre vacío");
      setLoading(true);
      try {
        const r = await apiFetch(`${API_BASE}/projects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmed,
            hasUxTeam: false,
            projectType: "NEW",
            groupId,
          }),
        });
        if (!r.ok) throw new Error("Error al crear proyecto");
        const created = (await r.json()) as Project;
        await refreshDashboard();
        setWorkshopProject(created);
      } finally {
        setLoading(false);
      }
    },
    [refreshDashboard],
  );

  async function loadTheForgeProjects() {
    setTheForgeLoading(true);
    try {
      const r = await apiFetch(`${API_BASE}/theforge/projects`);
      const data = (await r.json()) as { projects: TheForgeProject[]; theforgeAvailable: boolean };
      setTheForgeProjects(data.projects ?? []);
      setTheForgeAvailable(data.theforgeAvailable ?? false);
    } finally {
      setTheForgeLoading(false);
    }
  }

  function openTheForgeModal(tab: "projects" | "repos" = "projects") {
    setTheForgeModalTab(tab);
    setShowTheForgeModal(true);
    loadTheForgeProjects();
  }

  async function createLegacyProject(source: { id: string; name: string }) {
    setLoading(true);
    try {
      const r = await apiFetch(`${API_BASE}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: source.name,
          hasUxTeam: false,
          projectType: "LEGACY",
          theforgeProjectId: source.id,
        }),
      });
      if (!r.ok) throw new Error("Error al crear proyecto legacy");
      const created = (await r.json()) as Project;
      setShowTheForgeModal(false);
      await loadProjects();
      setWorkshopProject(created);
    } finally {
      setLoading(false);
    }
  }

  const handleToggleProjectSelect = useCallback((projectId: string) => {
    setSelectedProjectIds((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId],
    );
  }, []);

  const handleClearProjectSelection = useCallback(() => {
    setSelectedProjectIds([]);
  }, []);

  const openMergeDialog = useCallback(() => {
    if (selectedProjectIds.length < 2) return;
    setMergeDialogOpen(true);
  }, [selectedProjectIds.length]);

  const handleMergeCompleted = useCallback(
    async (result: {
      project?: Record<string, unknown>;
      audit?: {
        type: string;
        threadId?: string;
        question?: string;
        n?: number;
        total?: number;
        message?: string;
      } | null;
    }) => {
      setMergeDialogOpen(false);
      setSelectedProjectIds([]);
      setMergeAuditHint(result.audit ?? null);
      await loadProjects();
      const merged = result.project;
      if (merged && typeof merged.id === "string") {
        setWorkshopProject({
          id: merged.id,
          name: typeof merged.name === "string" ? merged.name : "Proyecto fusionado",
          status: (merged.status as Status) ?? "ROJO",
          precisionScore: typeof merged.precisionScore === "number" ? merged.precisionScore : 0,
          hasUxTeam: Boolean(merged.hasUxTeam),
          createdAt: typeof merged.createdAt === "string" ? merged.createdAt : new Date().toISOString(),
        });
      }
    },
    [loadProjects],
  );

  const openBulkDeleteConfirm = useCallback(() => {
    const targets = displayedProjects.filter((p) => selectedProjectIds.includes(p.id));
    if (targets.length === 0) return;
    setBulkDeleteError(null);
    setBulkDeleteTargets(targets);
    setBulkDeleteDialogOpen(true);
  }, [displayedProjects, selectedProjectIds]);

  const confirmBulkDelete = useCallback(async () => {
    if (!bulkDeleteTargets?.length) return;
    setBulkDeleteError(null);
    setLoading(true);
    try {
      for (const p of bulkDeleteTargets) {
        const r = await apiFetch(`${API_BASE}/projects/${p.id}`, {
          method: "DELETE",
        });
        if (!r.ok) {
          const msg =
            r.status === 403
              ? "No tienes permiso para borrar proyectos."
              : r.status === 404
                ? "Proyecto no encontrado."
                : "Error al borrar";
          throw new Error(msg);
        }
      }
      setBulkDeleteDialogOpen(false);
      setBulkDeleteTargets(null);
      setSelectedProjectIds([]);
      await loadProjects();
    } catch (err) {
      setBulkDeleteError(err instanceof Error ? err.message : "Error al borrar");
    } finally {
      setLoading(false);
    }
  }, [bulkDeleteTargets, loadProjects]);

  const currentUserId = getStoredUser()?.id;
  const userRole = getStoredUser()?.role;
  const isAdmin = userRole === "admin" || userRole === "super_admin";

  const canRenameProject = useCallback(
    (project: Project) => !project.userId || project.userId === currentUserId,
    [currentUserId],
  );

  const canOpenProjectSettings = useCallback(
    (project: Project) => canRenameProject(project) || isAdmin,
    [canRenameProject, isAdmin],
  );

  const openSettingsDialog = useCallback((project: Project) => {
    if (!canOpenProjectSettings(project)) return;
    setSettingsTarget(project);
    setSettingsDialogOpen(true);
  }, [canOpenProjectSettings]);

  const patchProject = useCallback(
    async (projectId: string, data: { name?: string; groupId?: string }) => {
      const r = await apiFetch(`${API_BASE}/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { message?: string | string[] };
        const msg = Array.isArray(err.message) ? err.message.join("; ") : err.message;
        throw new Error(
          r.status === 403
            ? "No tienes permiso para cambiar esta configuración"
            : msg ?? "Error al guardar",
        );
      }
      const updated = (await r.json()) as Project;
      const patch = {
        ...(data.name !== undefined ? { name: updated.name ?? data.name } : {}),
        ...(data.groupId !== undefined
          ? { groupId: updated.groupId ?? data.groupId, groupName: updated.groupName }
          : {}),
      };
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, ...patch } : p)));
      setWorkshopProject((prev) => (prev?.id === projectId ? { ...prev, ...patch } : prev));
      const store = useWorkshopStore.getState();
      if (store.project?.id === projectId && data.name !== undefined) {
        store.setProject({ ...store.project, name: patch.name ?? store.project.name });
      }
    },
    [],
  );

  const submitProjectSettings = useCallback(
    async (projectId: string, data: { name?: string; groupId?: string }) => {
      setSettingsLoading(true);
      try {
        await patchProject(projectId, data);
      } finally {
        setSettingsLoading(false);
      }
    },
    [patchProject],
  );

  const moveProjectToGroup = useCallback(
    async (projectId: string, groupId: string) => {
      setMoveProjectLoadingId(projectId);
      try {
        await patchProject(projectId, { groupId });
      } catch (err) {
        console.error(err);
      } finally {
        setMoveProjectLoadingId(null);
      }
    },
    [patchProject],
  );

  const handleProjectDragStart = useCallback(
    (project: Project) => (event: DragEvent<HTMLElement>) => {
      if (!isAdmin || moveProjectLoadingId) return;
      event.dataTransfer.setData("application/x-theforge-project-id", project.id);
      event.dataTransfer.setData("text/plain", project.id);
      event.dataTransfer.effectAllowed = "move";
      setDraggingProject({
        projectId: project.id,
        sourceGroupId: project.groupId ?? "",
      });
    },
    [isAdmin, moveProjectLoadingId],
  );

  const handleProjectDragEnd = useCallback(() => {
    setDraggingProject(null);
    setDropTargetGroupId(null);
  }, []);

  const handleGroupDragOver = useCallback(
    (groupId: string) => (event: DragEvent<HTMLElement>) => {
      if (!isAdmin || !draggingProject) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropTargetGroupId !== groupId) {
        setDropTargetGroupId(groupId);
      }
    },
    [draggingProject, dropTargetGroupId, isAdmin],
  );

  const handleGroupDrop = useCallback(
    (groupId: string) => (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (!isAdmin || !draggingProject) return;
      const { projectId, sourceGroupId } = draggingProject;
      setDraggingProject(null);
      setDropTargetGroupId(null);
      if (groupId === sourceGroupId) return;
      void moveProjectToGroup(projectId, groupId);
    },
    [draggingProject, isAdmin, moveProjectToGroup],
  );

  const submitCreateProjectGroup = useCallback(
    async (name: string) => {
      setCreateGroupLoading(true);
      try {
        const r = await apiFetch(`${API_BASE}/project-groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!r.ok) {
          const err = (await r.json().catch(() => ({}))) as { message?: string | string[] };
          const msg = Array.isArray(err.message) ? err.message.join("; ") : err.message;
          throw new Error(msg ?? "Error al crear grupo");
        }
        const created = (await r.json()) as { id: string };
        await loadProjectGroups();
        if (createGroupForWizard) {
          setWizardPendingGroupId(created.id);
          setCreateGroupForWizard(false);
        }
      } finally {
        setCreateGroupLoading(false);
      }
    },
    [loadProjectGroups, createGroupForWizard],
  );

  const openGroupRenameDialog = useCallback((group: ProjectGroup) => {
    if (group.isDefault) return;
    setGroupRenameTarget(group);
    setGroupRenameName(group.name);
    setGroupRenameOpen(true);
  }, []);

  const submitGroupRename = useCallback(async () => {
    if (!groupRenameTarget) return;
    const trimmed = groupRenameName.trim();
    if (!trimmed || trimmed === groupRenameTarget.name) {
      setGroupRenameOpen(false);
      return;
    }
    setGroupRenameLoading(true);
    try {
      const r = await apiFetch(`${API_BASE}/project-groups/${groupRenameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { message?: string | string[] };
        const msg = Array.isArray(err.message) ? err.message.join("; ") : err.message;
        throw new Error(msg ?? "Error al renombrar grupo");
      }
      await loadProjectGroups();
      setProjects((prev) =>
        prev.map((p) =>
          p.groupId === groupRenameTarget.id ? { ...p, groupName: trimmed } : p,
        ),
      );
      setGroupRenameOpen(false);
      setGroupRenameTarget(null);
    } catch (err) {
      console.error(err);
    } finally {
      setGroupRenameLoading(false);
    }
  }, [groupRenameTarget, groupRenameName, loadProjectGroups]);

  const confirmDeleteGroup = useCallback(async () => {
    if (!groupDeleteTarget) return;
    setGroupDeleteLoading(true);
    try {
      const r = await apiFetch(`${API_BASE}/project-groups/${groupDeleteTarget.id}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { message?: string | string[] };
        const msg = Array.isArray(err.message) ? err.message.join("; ") : err.message;
        throw new Error(msg ?? "Error al eliminar grupo");
      }
      await refreshDashboard();
      setGroupDeleteOpen(false);
      setGroupDeleteTarget(null);
    } catch (err) {
      console.error(err);
    } finally {
      setGroupDeleteLoading(false);
    }
  }, [groupDeleteTarget, refreshDashboard]);

  const moveGroupToFirst = useCallback(
    async (group: ProjectGroup) => {
      if (projectGroups[0]?.id === group.id) return;
      setGroupMoveFirstLoadingId(group.id);
      try {
        const r = await apiFetch(`${API_BASE}/project-groups/${group.id}/move-to-first`, {
          method: "POST",
        });
        if (!r.ok) {
          const err = (await r.json().catch(() => ({}))) as { message?: string | string[] };
          const msg = Array.isArray(err.message) ? err.message.join("; ") : err.message;
          throw new Error(msg ?? "Error al reordenar grupo");
        }
        await loadProjectGroups();
      } catch (err) {
        console.error(err);
      } finally {
        setGroupMoveFirstLoadingId(null);
      }
    },
    [loadProjectGroups, projectGroups],
  );

  const openCloneDialog = useCallback((project: Project) => {
    setCloneTarget(project);
    setCloneDialogOpen(true);
  }, []);

  const submitCloneProject = useCallback(
    async (projectId: string, name: string) => {
      setCloneLoading(true);
      try {
        const r = await apiFetch(`${API_BASE}/projects/${projectId}/clone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!r.ok) {
          const err = (await r.json().catch(() => ({}))) as { message?: string | string[] };
          const msg = Array.isArray(err.message) ? err.message.join("; ") : err.message;
          throw new Error(msg ?? "Error al clonar");
        }
        const created = (await r.json()) as Project;
        setSelectedProjectIds([]);
        await loadProjects();
        setWorkshopProject(created);
      } finally {
        setCloneLoading(false);
      }
    },
    [loadProjects],
  );

  useEffect(() => {
    if (!showCreateWizard) return;
    void loadProjectGroups();
  }, [showCreateWizard, loadProjectGroups]);

  useEffect(() => {
    const allowed = new Set(displayedProjects.map((p) => p.id));
    setSelectedProjectIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [displayedProjects]);

  useEffect(() => {
    if (!authed) return;
    void refreshStoredUserFromApi();
  }, [authed]);

  useEffect(() => {
    if (!authed || workshopProject) return;
    void refreshDashboard();
  }, [authed, workshopProject, refreshDashboard]);

  // Check if first-run setup is needed (no users exist)
  useEffect(() => {
    if (authed) return;
    fetch(`${API_BASE}/auth/has-users`)
      .then((r) => r.json())
      .then((data: { hasUsers?: boolean }) => {
        setNeedsSetup(data.hasUsers === false);
      })
      .catch(() => setNeedsSetup(false));
  }, [authed]);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#\/?/, "").trim();
    if (hash === "settings") {
      setSettingsViewOpen(true);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    function onAuthExpired() {
      setAuthed(false);
      setWorkshopProject(null);
      setUsersViewOpen(false);
      setSettingsViewOpen(false);
    }
    window.addEventListener("theforge:auth-expired", onAuthExpired);
    return () => window.removeEventListener("theforge:auth-expired", onAuthExpired);
  }, []);

  const openSettings = useCallback(() => {
    setUsersViewOpen(false);
    setSettingsViewOpen(true);
  }, []);

  const openUsers = useCallback(() => {
    setSettingsViewOpen(false);
    setUsersViewOpen(true);
  }, []);

  const handleExitWorkshop = useCallback(() => {
    const store = useWorkshopStore.getState();
    if (selectWorkshopAgentsBusy(store)) return;
    store.reset();
    store.setWorkshopActiveDocPanel("mdd");
    setMergeAuditHint(null);
    setWorkshopProject(null);
    setUsersViewOpen(false);
    setSettingsViewOpen(false);
  }, []);

  const closePanelViews = useCallback(() => {
    setUsersViewOpen(false);
    setSettingsViewOpen(false);
  }, []);

  if (!authed) {
    if (needsSetup === null) {
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-[var(--background)] p-6 text-[var(--foreground)]">
          <p className="text-sm text-[var(--foreground-muted)]">Cargando...</p>
        </div>
      );
    }
    if (needsSetup) {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <SetupView onComplete={() => setNeedsSetup(false)} />
        </div>
      );
    }
    if (isOtpEmailHandoffPath()) {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <OtpEmailHandoffView />
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <LoginView onLoggedIn={() => window.location.reload()} />
      </div>
    );
  }

  function logout() {
    clearAccessToken();
    setAuthed(false);
    setWorkshopProject(null);
    setUsersViewOpen(false);
    setSettingsViewOpen(false);
    setProjects([]);
    setProjectSearchQuery("");
  }

  const settingsPanel = settingsViewOpen ? (
    <SettingsView
      showIaCost={showIaCost}
      onToggleIaCost={() => {
        const next = !showIaCost;
        localStorage.setItem("theforge_show_ia_cost", next ? "1" : "0");
        setShowIaCost(next);
      }}
    />
  ) : null;

  return (
    <div className="flex h-[100dvh] min-h-0 max-h-[100dvh] flex-1 flex-col overflow-hidden">
    <ErrorBoundary>
      <CreateProjectWizardDialog
        open={showCreateWizard}
        onOpenChange={setShowCreateWizard}
        loading={loading}
        groups={projectGroups.map((g) => ({ id: g.id, name: g.name, isDefault: g.isDefault }))}
        canCreateGroup={isAdmin}
        pendingSelectedGroupId={wizardPendingGroupId}
        onPendingGroupConsumed={() => setWizardPendingGroupId(null)}
        onCreateGroup={
          isAdmin
            ? () => {
                setCreateGroupForWizard(true);
                setCreateGroupDialogOpen(true);
              }
            : undefined
        }
        onCreateNew={createProject}
        onContinueLegacy={openTheForgeModal}
      />

      <ProjectTutorialDialog open={showTutorial} onClose={() => setShowTutorial(false)} />

      <ProjectMergeDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        sources={projectList
          .filter((p) => selectedProjectIds.includes(p.id))
          .map((p) => ({ id: p.id, name: p.name }))}
        loading={loading}
        onMerged={handleMergeCompleted}
      />

      <ProjectSettingsDialog
        open={settingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
        projectId={settingsTarget?.id ?? null}
        currentName={settingsTarget?.name ?? ""}
        currentGroupId={settingsTarget?.groupId ?? null}
        groups={projectGroups.map((g) => ({ id: g.id, name: g.name, isDefault: g.isDefault }))}
        canEditName={settingsTarget ? canRenameProject(settingsTarget) : false}
        canEditGroup={isAdmin}
        loading={settingsLoading}
        onSubmit={submitProjectSettings}
        onCreateGroup={
          isAdmin
            ? () => {
                setCreateGroupForWizard(false);
                setCreateGroupDialogOpen(true);
              }
            : undefined
        }
        onExportNotion={
          settingsTarget
            ? () => {
                setPortabilityMode("export");
                setPortabilityOpen(true);
              }
            : undefined
        }
      />

      <ProjectPortabilityDialog
        open={portabilityOpen}
        onOpenChange={setPortabilityOpen}
        mode={portabilityMode}
        projectId={portabilityMode === "export" ? settingsTarget?.id : undefined}
        projectName={portabilityMode === "export" ? settingsTarget?.name : undefined}
        onImported={(id, name) => {
          void refreshDashboard();
          setWorkshopProject({ id, name } as Project);
        }}
        onPairImported={() => {
          void refreshDashboard();
        }}
      />

      <CreateProjectGroupDialog
        open={createGroupDialogOpen}
        onOpenChange={(open) => {
          setCreateGroupDialogOpen(open);
          if (!open) setCreateGroupForWizard(false);
        }}
        loading={createGroupLoading}
        onSubmit={submitCreateProjectGroup}
      />

      <Dialog open={groupRenameOpen} onOpenChange={setGroupRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renombrar grupo</DialogTitle>
            <DialogDescription>El grupo por defecto no se puede renombrar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <label htmlFor="rename-group-name" className="text-sm font-medium">
              Nombre
            </label>
            <Input
              id="rename-group-name"
              value={groupRenameName}
              onChange={(e) => setGroupRenameName(e.target.value)}
              disabled={groupRenameLoading}
              maxLength={120}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setGroupRenameOpen(false)} disabled={groupRenameLoading}>
              Cancelar
            </Button>
            <Button onClick={() => void submitGroupRename()} disabled={groupRenameLoading || !groupRenameName.trim()}>
              {groupRenameLoading ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={groupDeleteOpen} onOpenChange={setGroupDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar grupo «{groupDeleteTarget?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Los proyectos de este grupo se moverán al grupo por defecto «Proyectos». Los proyectos no se eliminarán.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={groupDeleteLoading}>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={groupDeleteLoading}
              onClick={() => void confirmDeleteGroup()}
            >
              {groupDeleteLoading ? "Eliminando…" : "Eliminar grupo"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CloneProjectDialog
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        projectId={cloneTarget?.id ?? null}
        sourceName={cloneTarget?.name ?? ""}
        loading={cloneLoading}
        onSubmit={submitCloneProject}
      />

      <AlertDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open && !loading) {
            setBulkDeleteDialogOpen(false);
            setBulkDeleteTargets(null);
            setBulkDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkDeleteTargets && bulkDeleteTargets.length > 1 ? "Borrar proyectos" : "Borrar proyecto"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán sesiones y estimaciones. Esta acción no se puede deshacer.
            </AlertDialogDescription>
            {bulkDeleteError ? (
              <p
                role="alert"
                className="rounded-md border border-[color-mix(in_oklch,var(--destructive)_42%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_12%,var(--card))] px-3 py-2 text-sm text-[var(--destructive)]"
              >
                {bulkDeleteError}
              </p>
            ) : null}
            {bulkDeleteTargets && bulkDeleteTargets.length > 0 ? (
              <ul className="max-h-40 list-inside list-disc overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--muted)]/30 py-2 pl-4 pr-2 text-sm text-[var(--foreground)]">
                {bulkDeleteTargets.slice(0, 12).map((p) => (
                  <li key={p.id} className="truncate">
                    {p.name}
                  </li>
                ))}
                {bulkDeleteTargets.length > 12 ? (
                  <li className="list-none text-[var(--foreground-muted)]">
                    …y {bulkDeleteTargets.length - 12} más
                  </li>
                ) : null}
              </ul>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              type="button"
              disabled={loading}
              onClick={() => {
                setBulkDeleteDialogOpen(false);
                setBulkDeleteTargets(null);
                setBulkDeleteError(null);
              }}
            >
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={loading}
              onClick={() => void confirmBulkDelete()}
            >
              {loading ? "Borrando…" : bulkDeleteTargets && bulkDeleteTargets.length > 1 ? `Borrar (${bulkDeleteTargets.length})` : "Borrar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showTheForgeModal} onOpenChange={setShowTheForgeModal}>
        <DialogContent size="lg" className="max-h-[min(80vh,100dvh-2rem)] w-[calc(100vw-1.5rem)] sm:w-full flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Base de conocimientos (TheForge)</DialogTitle>
            <DialogDescription>
              Elige un proyecto (varios repos) o un repositorio individual como base.
            </DialogDescription>
          </DialogHeader>
          {!theforgeAvailable && !theforgeLoading && (
            <div
              role="alert"
              className="rounded-[var(--radius-md)] border border-[color-mix(in_oklch,var(--destructive)_42%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_14%,var(--card))] p-4 shadow-sm"
            >
              <div className="flex gap-3">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))]"
                  aria-hidden
                />
                <div className="min-w-0 space-y-3 text-sm">
                  <p className="font-semibold leading-snug text-[var(--foreground)]">
                    TheForge no está configurado o no está disponible.
                  </p>
                  <p className="leading-relaxed text-[var(--foreground-muted)]">
                    Configura estas variables en el backend:
                  </p>
                  <ul className="flex flex-col gap-2 font-mono text-xs text-[var(--foreground)]">
                    <li className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_55%,var(--card))] px-3 py-2">
                      THEFORGE_MCP_URL
                    </li>
                    <li className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_55%,var(--card))] px-3 py-2">
                      MCP_AUTH_TOKEN
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}
          {theforgeLoading && (
            <div className="flex items-center gap-2 text-[var(--foreground-muted)] py-6">
              <Loader2 className="w-5 h-5 animate-spin" />
              Cargando proyectos y repositorios…
            </div>
          )}
          {theforgeAvailable && !theforgeLoading && (
            <>
              <div className="flex gap-2 mb-3 border-b border-[var(--border)] pb-2">
                <Button
                  variant={theforgeModalTab === "projects" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheForgeModalTab("projects")}
                >
                  Proyectos
                </Button>
                <Button
                  variant={theforgeModalTab === "repos" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheForgeModalTab("repos")}
                >
                  Repositorios
                </Button>
              </div>
              {theforgeModalTab === "projects" && (
                <>
                  {theforgeProjects.length === 0 ? (
                    <p className="text-sm text-[var(--foreground-muted)]">No hay proyectos indexados en TheForge.</p>
                  ) : (
                    <ul className="space-y-2 overflow-y-auto flex-1 min-h-0">
                      {theforgeProjects.map((rp) => (
                        <li key={rp.id}>
                          <Button
                            variant="outline"
                            className="w-full justify-start h-auto py-3 px-4 flex flex-col gap-1"
                            onClick={() => createLegacyProject(rp)}
                            disabled={loading}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <FolderGit2 className="w-4 h-4 shrink-0 text-[var(--primary)]" />
                              <span className="font-medium truncate">{rp.name}</span>
                              {rp.roots?.length != null && rp.roots.length > 0 && (
                                <Badge variant="secondary" className="shrink-0 text-xs">
                                  {rp.roots.length} repo(s)
                                </Badge>
                              )}
                              {rp.branch != null && rp.branch !== "" && !rp.roots?.length && (
                                <Badge variant="outline" className="shrink-0 text-xs">
                                  rama: {rp.branch}
                                </Badge>
                              )}
                            </div>
                            {rp.rootPath && (
                              <span className="text-xs text-[var(--foreground-muted)] truncate pl-6">{rp.rootPath}</span>
                            )}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {theforgeModalTab === "repos" && (
                <>
                  {theforgeRepositories.length === 0 ? (
                    <p className="text-sm text-[var(--foreground-muted)]">No hay repositorios (derivados de los proyectos indexados).</p>
                  ) : (
                    <ul className="space-y-2 overflow-y-auto flex-1 min-h-0">
                      {theforgeRepositories.map((repo) => (
                        <li key={repo.id}>
                          <Button
                            variant="outline"
                            className="w-full justify-start h-auto py-3 px-4 flex flex-col gap-1"
                            onClick={() => createLegacyProject(repo)}
                            disabled={loading}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <GitBranch className="w-4 h-4 shrink-0 text-[var(--primary)]" />
                              <span className="font-medium truncate">{repo.name}</span>
                              {repo.branch != null && repo.branch !== "" && (
                                <Badge variant="outline" className="shrink-0 text-xs">
                                  rama: {repo.branch}
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-[var(--foreground-muted)] truncate pl-6 font-mono">{repo.id}</span>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {workshopProject ? (
        <div className="flex h-[100dvh] min-h-0 max-h-[100dvh] min-w-0 w-full flex-1 flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)] lg:flex-row lg:items-stretch">
          <DashboardSidebar
            projectSearchQuery={projectSearchQuery}
            onProjectSearchChange={setProjectSearchQuery}
            user={getStoredUser()}
            onLogout={logout}
            onOpenSettings={openSettings}
            onOpenUsers={openUsers}
            canManageUsers={isAdmin}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={handleToggleSidebarCollapsed}
            workshopProject={{ id: workshopProject.id, name: workshopProject.name }}
            onExitWorkshop={handleExitWorkshop}
            onBeforeNavigateToProjects={closePanelViews}
            onBeforeNavigateToWorkshopDoc={closePanelViews}
          />
          <div className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-hidden">
            {settingsViewOpen ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {settingsPanel}
              </div>
            ) : usersViewOpen && isAdmin ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <UsersView />
              </div>
            ) : (
              <Suspense fallback={<WorkshopViewFallback />}>
                <WorkshopView
                  projectId={workshopProject.id}
                  projectName={workshopProject.name}
                  onBack={handleExitWorkshop}
                  onOpenSettings={openSettings}
                  onRenameProject={
                    canOpenProjectSettings(workshopProject)
                      ? () => openSettingsDialog(workshopProject)
                      : undefined
                  }
                  mergeAudit={mergeAuditHint}
                />
              </Suspense>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-[100dvh] min-h-0 max-h-[100dvh] min-w-0 w-full flex-1 flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)] lg:flex-row lg:items-stretch">
          <DashboardSidebar
            projectSearchQuery={projectSearchQuery}
            onProjectSearchChange={setProjectSearchQuery}
            dashboardProjectGroups={projectGroups.map((group) => ({
              id: group.id,
              name: group.name,
              isDefault: group.isDefault,
              projects: (projectsByGroupId.get(group.id) ?? []).map((p) => ({
                id: p.id,
                name: p.name,
                isFavorite: p.isFavorite,
              })),
            }))}
            projectsLoading={loading}
            onOpenProject={(item) => {
              const project = projectList.find((p) => p.id === item.id);
              if (project) {
                closePanelViews();
                setWorkshopProject({ id: project.id, name: project.name } as Project);
              }
            }}
            user={getStoredUser()}
            onLogout={logout}
            onOpenSettings={openSettings}
            onOpenUsers={openUsers}
            canManageUsers={isAdmin}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={handleToggleSidebarCollapsed}
            onBeforeNavigateToProjects={closePanelViews}
          />

          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {settingsViewOpen ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{settingsPanel}</div>
        ) : usersViewOpen && isAdmin ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <UsersView />
          </div>
        ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-6 px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        <DashboardPanelHeader
          loading={loading}
          onCreateProject={() => setShowCreateWizard(true)}
          onRefresh={() => void refreshDashboard()}
          onOpenTutorial={() => setShowTutorial(true)}
          onImportProject={() => {
            setPortabilityMode("import");
            setPortabilityOpen(true);
          }}
          onImportIntegrationPair={() => {
            setPortabilityMode("import-pair");
            setPortabilityOpen(true);
          }}
        />

        <Card id="dashboard-projects-filters">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            {isAdmin ? (
              <div className="flex min-h-9 min-w-0 w-full shrink-0 items-center gap-2 sm:max-w-xl sm:flex-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setCreateGroupDialogOpen(true)}
                  aria-label="Crear grupo de proyectos"
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden />
                  Grupo
                </Button>
              </div>
            ) : null}
            <div
              className="flex w-full shrink-0 items-center gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden"
              role="tablist"
              aria-label="Filtrar proyectos"
            >
              <button
                type="button"
                role="tab"
                aria-selected={projectTypeFilter === "all"}
                onClick={() => setProjectTypeFilter("all")}
                className={`shrink-0 touch-manipulation whitespace-nowrap rounded-full border px-3 py-2 text-xs font-medium transition-colors min-h-[44px] sm:min-h-9 sm:py-1.5 ${
                  projectTypeFilter === "all"
                    ? "border-[var(--primary)] bg-[var(--primary)]/18 text-[var(--primary)]"
                    : "border-[var(--border)] bg-transparent text-[var(--foreground-muted)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                Todos ({projectList.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={projectTypeFilter === "favorites"}
                onClick={() => setProjectTypeFilter("favorites")}
                className={`shrink-0 touch-manipulation whitespace-nowrap rounded-full border px-3 py-2 text-xs font-medium transition-colors min-h-[44px] sm:min-h-9 sm:py-1.5 ${
                  projectTypeFilter === "favorites"
                    ? "border-rose-500 bg-rose-500/20 text-rose-700 dark:text-rose-300"
                    : "border-[var(--border)] bg-transparent text-[var(--foreground-muted)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <Heart
                  className={cn(
                    "mr-1 inline h-3 w-3 align-text-bottom",
                    projectTypeFilter === "favorites" && "fill-current",
                  )}
                  aria-hidden
                />
                Favoritos ({favoriteProjectCount})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={projectTypeFilter === "NEW"}
                onClick={() => setProjectTypeFilter("NEW")}
                className={`shrink-0 touch-manipulation whitespace-nowrap rounded-full border px-3 py-2 text-xs font-medium transition-colors min-h-[44px] sm:min-h-9 sm:py-1.5 ${
                  projectTypeFilter === "NEW"
                    ? "border-emerald-500 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                    : "border-[var(--border)] bg-transparent text-[var(--foreground-muted)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <Sparkles className="mr-1 inline h-3 w-3 align-text-bottom" aria-hidden />
                Nuevos ({projectList.filter((q) => (q.projectType ?? "NEW") === "NEW").length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={projectTypeFilter === "LEGACY"}
                onClick={() => setProjectTypeFilter("LEGACY")}
                className={`shrink-0 touch-manipulation whitespace-nowrap rounded-full border px-3 py-2 text-xs font-medium transition-colors min-h-[44px] sm:min-h-9 sm:py-1.5 ${
                  projectTypeFilter === "LEGACY"
                    ? "border-amber-500 bg-amber-500/20 text-amber-800 dark:text-amber-300"
                    : "border-[var(--border)] bg-transparent text-[var(--foreground-muted)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <GitBranch className="mr-1 inline h-3 w-3 align-text-bottom" aria-hidden />
                Legacy ({projectList.filter((q) => q.projectType === "LEGACY").length})
              </button>
            </div>
          </CardHeader>
        </Card>

        {displayedProjects.length === 0 && !loading && (
          <EmptyState
            title={
              projectList.length === 0
                ? "Aún no hay proyectos"
                : projectSearchQuery.trim()
                  ? "Sin coincidencias"
                  : projectTypeFilter === "favorites"
                    ? "Sin proyectos favoritos"
                    : "No hay proyectos de este tipo"
            }
            description={
              projectList.length === 0
                ? "Usa «Crear nuevo proyecto» para el asistente, o Refrescar si el backend ya tiene datos."
                : projectSearchQuery.trim()
                  ? "Prueba otras palabras o borra el buscador del panel lateral."
                  : projectTypeFilter === "favorites"
                    ? "Marca el corazón en una carpeta para añadirla a favoritos."
                    : "Cambia el filtro o crea un proyecto nuevo desde el encabezado."
            }
            icon={FolderGit2}
            action={projectList.length === 0 ? {
              label: "Crear primer proyecto",
              icon: <Plus className="w-4 h-4" />,
              onClick: () => setShowCreateWizard(true),
            } : undefined}
          />
        )}

        {projectGroups.map((group, groupIndex) => {
          const groupProjects = projectsByGroupId.get(group.id) ?? [];
          const isFirstGroup = groupIndex === 0;
          const isDropTarget =
            isAdmin && !!draggingProject && dropTargetGroupId === group.id;
          const isSourceGroupWhileDragging =
            isAdmin && draggingProject?.sourceGroupId === group.id;
          return (
            <Card
              key={group.id}
              id={group.isDefault ? "dashboard-projects" : undefined}
              className={cn(
                "transition-[box-shadow,background-color,border-color] duration-300 ease-forge-smooth motion-reduce:transition-none",
                isDropTarget &&
                  "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))] shadow-[0_0_0_2px_color-mix(in_oklch,var(--primary)_45%,transparent)]",
                isSourceGroupWhileDragging &&
                  !isDropTarget &&
                  "border-dashed border-[color-mix(in_oklch,var(--primary)_35%,var(--border))]",
              )}
              onDragOver={isAdmin ? handleGroupDragOver(group.id) : undefined}
              onDragEnter={isAdmin ? handleGroupDragOver(group.id) : undefined}
              onDragLeave={
                isAdmin
                  ? (event) => {
                      const related = event.relatedTarget as Node | null;
                      if (!event.currentTarget.contains(related)) {
                        setDropTargetGroupId((prev) => (prev === group.id ? null : prev));
                      }
                    }
                  : undefined
              }
              onDrop={isAdmin ? handleGroupDrop(group.id) : undefined}
            >
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle className="flex min-w-0 flex-1 items-center gap-2 text-base sm:text-lg">
                  <FolderOpen className="h-5 w-5 shrink-0 text-[var(--primary)]" aria-hidden />
                  <span className="truncate">{group.name}</span>
                  {isFirstGroup ? (
                    <Badge variant="outline" className="shrink-0 text-xs font-normal text-[var(--foreground-muted)]">
                      Prioritario
                    </Badge>
                  ) : null}
                  <Badge variant="secondary" className="shrink-0 tabular-nums">
                    {groupProjects.length}
                  </Badge>
                </CardTitle>
                {isAdmin ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <TooltipProvider delayDuration={280}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-8 w-8",
                              isFirstGroup &&
                                "border border-[color-mix(in_oklch,var(--primary)_45%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_12%,var(--card))] text-[var(--primary)]",
                            )}
                            onClick={() => void moveGroupToFirst(group)}
                            disabled={isFirstGroup || groupMoveFirstLoadingId === group.id}
                            aria-pressed={isFirstGroup}
                            aria-label={
                              isFirstGroup
                                ? `${group.name} es el grupo prioritario`
                                : `Priorizar grupo ${group.name}`
                            }
                          >
                            {groupMoveFirstLoadingId === group.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <Pin
                                className="h-4 w-4"
                                fill={isFirstGroup ? "currentColor" : "none"}
                                aria-hidden
                              />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {isFirstGroup ? "Grupo prioritario" : "Priorizar"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    {!group.isDefault ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openGroupRenameDialog(group)}
                          aria-label={`Renombrar grupo ${group.name}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-[var(--destructive)] hover:text-[var(--destructive)]"
                          onClick={() => {
                            setGroupDeleteTarget(group);
                            setGroupDeleteOpen(true);
                          }}
                          aria-label={`Eliminar grupo ${group.name}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </CardHeader>
              <CardContent>
                {groupProjects.length === 0 ? (
                  <div
                    className={cn(
                      "rounded-xl border border-dashed border-transparent px-4 py-8 text-center transition-[border-color,background-color] duration-300 ease-forge-smooth motion-reduce:transition-none",
                      isDropTarget &&
                        "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary)_10%,transparent)]",
                    )}
                  >
                    <p className="text-sm text-[var(--foreground-muted)]">
                      {isDropTarget
                        ? "Suelta la carpeta aquí"
                        : displayedProjects.length === 0 && !loading
                          ? "Sin proyectos con los filtros actuales."
                          : "Ningún proyecto en este grupo con los filtros actuales."}
                    </p>
                  </div>
                ) : (
                  <ul
                    className="grid list-none gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
                    aria-label={`Carpetas de proyectos en ${group.name}`}
                  >
                    {groupProjects.map((p) => (
                      <li key={p.id} className="min-h-0">
                        <ProjectFolderTile
                          id={p.id}
                          name={p.name}
                          status={p.status}
                          precisionScore={p.precisionScore}
                          projectType={p.projectType}
                          visibility={p.visibility}
                          selected={selectedProjectIds.includes(p.id)}
                          selectable
                          isFavorite={p.isFavorite}
                          draggable={isAdmin}
                          isDragging={draggingProject?.projectId === p.id}
                          isMoving={moveProjectLoadingId === p.id}
                          generationBusy={generationSummaries[p.id]?.busy === true}
                          generationLabel={generationSummaries[p.id]?.label ?? null}
                          onDragStart={handleProjectDragStart(p)}
                          onDragEnd={handleProjectDragEnd}
                          onToggleFavorite={handleToggleFavorite}
                          onRename={
                            canOpenProjectSettings(p) ? () => openSettingsDialog(p) : undefined
                          }
                          onOpen={() => setWorkshopProject({ id: p.id, name: p.name } as Project)}
                          onToggleSelect={() => handleToggleProjectSelect(p.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}

        {selectedProjectIds.length > 0 ? (
          <ProjectSelectionToolbar
            selectedCount={selectedProjectIds.length}
            loading={loading}
            isAdmin={isAdmin}
            showMerge={selectedProjectIds.length >= 2}
            showClone={selectedProjectIds.length === 1}
            showSettings={
              selectedProjectIds.length === 1 &&
              !!projectList.find(
                (p) => p.id === selectedProjectIds[0] && canOpenProjectSettings(p),
              )
            }
            showExport={selectedProjectIds.length === 1}
            cloneLoading={cloneLoading}
            settingsLoading={settingsLoading}
            onClearSelection={handleClearProjectSelection}
            onClone={
              selectedProjectIds.length === 1
                ? () => {
                    const single = projectList.find((p) => p.id === selectedProjectIds[0]);
                    if (single) openCloneDialog(single);
                  }
                : undefined
            }
            onSettings={
              selectedProjectIds.length === 1
                ? () => {
                    const single = projectList.find((p) => p.id === selectedProjectIds[0]);
                    if (single && canOpenProjectSettings(single)) openSettingsDialog(single);
                  }
                : undefined
            }
            onExport={
              selectedProjectIds.length === 1
                ? () => {
                    const single = projectList.find((p) => p.id === selectedProjectIds[0]);
                    if (!single) return;
                    setSettingsTarget(single);
                    setPortabilityMode("export");
                    setPortabilityOpen(true);
                  }
                : undefined
            }
            onMerge={openMergeDialog}
            onDelete={isAdmin ? openBulkDeleteConfirm : undefined}
          />
        ) : null}
        </div>
        </div>
        )}
      </main>
        </div>
      )}
      </div>
    </ErrorBoundary>
    </div>
  );
}
