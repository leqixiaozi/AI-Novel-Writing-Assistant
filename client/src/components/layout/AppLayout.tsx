import { Suspense, useEffect, useMemo, useState } from "react";
import { Link, matchPath, Outlet, useLocation } from "react-router-dom";
import AppRouteFallback from "./AppRouteFallback";
import LLMSelectionBootstrap from "./LLMSelectionBootstrap";
import Navbar from "./Navbar";
import NovelWorkspaceRail from "./NovelWorkspaceRail";
import Sidebar from "./Sidebar";
import LiveExecutionDialog from "@/components/liveExecution/LiveExecutionDialog";
import MobileSiteShell from "./mobile/MobileSiteShell";
import AutoDirectorPauseNotificationWatcher from "@/components/autoDirector/AutoDirectorPauseNotificationWatcher";
import { TaskRecoveryProvider } from "./TaskRecoveryContext";
import TaskRecoveryDialog from "./TaskRecoveryDialog";
import { useIsMobileViewport } from "./mobile/useIsMobileViewport";
import {
  AUTO_DIRECTOR_MOBILE_CLASSES,
  shouldUseAutoDirectorMobileFullWidthContent,
} from "@/mobile/autoDirector";
import { CreationSetupProvider } from "@/components/onboarding/CreationSetupContext";
import { NEW_DESIGN_ADVANCED_NAV, NEW_DESIGN_PRIMARY_NAV, isNewDesignBookWorkspacePath } from "@ai-novel/new-design/client";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "ai-novel.sidebar.collapsed";
const WORKSPACE_RAIL_COLLAPSED_STORAGE_KEY = "ai-novel.workspace-rail.collapsed";
const DEFAULT_APP_MAIN_CLASS_NAME = "h-[calc(100dvh-4rem)] min-w-0 flex-1 overflow-y-auto p-6";

export default function AppLayout() {
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isWorkspaceRailCollapsed, setIsWorkspaceRailCollapsed] = useState(false);
  const [workspaceNavMode, setWorkspaceNavMode] = useState<"workspace" | "project">(() =>
    isNewDesignBookWorkspacePath(location.pathname) ? "workspace" : "project"
  );
  const isMobileViewport = useIsMobileViewport();
  const isNovelPreview = Boolean(matchPath("/novels/:id/preview", location.pathname));

  const workspaceRoute = useMemo(() => {
    const editMatch = matchPath("/novels/:id/edit", location.pathname);
    if (editMatch?.params.id) {
      return {
        novelId: editMatch.params.id,
        chapterId: "",
      };
    }
    const chapterMatch = matchPath("/novels/:id/chapters/:chapterId", location.pathname);
    if (chapterMatch?.params.id) {
      return {
        novelId: chapterMatch.params.id,
        chapterId: chapterMatch.params.chapterId ?? "",
      };
    }
    return null;
  }, [location.pathname]);

  const isNovelWorkspace = Boolean(workspaceRoute?.novelId);
  const isNewDesignBookWorkspace = isNewDesignBookWorkspacePath(location.pathname);
  const hasWorkspaceNavigation = isNovelWorkspace || isNewDesignBookWorkspace;
  const useMobileWorkspaceLayout = isMobileViewport && hasWorkspaceNavigation;
  const useMobileSiteLayout = isMobileViewport && !hasWorkspaceNavigation;
  const useMobileFullWidthContent = useMemo(
    () => shouldUseAutoDirectorMobileFullWidthContent(location.pathname),
    [location.pathname],
  );

  useEffect(() => {
    const storedValue = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    setIsSidebarCollapsed(storedValue === "true");
    const workspaceRailValue = window.localStorage.getItem(WORKSPACE_RAIL_COLLAPSED_STORAGE_KEY);
    setIsWorkspaceRailCollapsed(workspaceRailValue === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_RAIL_COLLAPSED_STORAGE_KEY, String(isWorkspaceRailCollapsed));
  }, [isWorkspaceRailCollapsed]);

  useEffect(() => {
    setWorkspaceNavMode(hasWorkspaceNavigation ? "workspace" : "project");
  }, [hasWorkspaceNavigation, location.pathname]);

  if (isNovelPreview) {
    return (
      <CreationSetupProvider>
        <TaskRecoveryProvider>
          <div className="h-[100dvh] overflow-hidden bg-background text-foreground">
            <AutoDirectorPauseNotificationWatcher />
            <LLMSelectionBootstrap />
            <Suspense fallback={<AppRouteFallback />}>
              <Outlet />
            </Suspense>
            <TaskRecoveryDialog />
          </div>
        </TaskRecoveryProvider>
      </CreationSetupProvider>
    );
  }

  if (useMobileWorkspaceLayout) {
    return (
      <CreationSetupProvider>
      <TaskRecoveryProvider>
        <div data-new-design-nav-mode={isNewDesignBookWorkspace ? workspaceNavMode : undefined} className="min-h-screen bg-background">
          <AutoDirectorPauseNotificationWatcher />
          <LiveExecutionDialog compact className="fixed right-3 top-3 z-50 h-9 w-9 bg-background px-0 shadow-sm" />
          <LLMSelectionBootstrap />
          {isNewDesignBookWorkspace && <header className="border-b bg-background px-4 py-2">
            <button type="button" className="min-h-10 rounded-md border px-3 text-sm" aria-expanded={workspaceNavMode === "project"} aria-controls="new-design-mobile-project-nav" onClick={() => setWorkspaceNavMode(current => current === "workspace" ? "project" : "workspace")}>{workspaceNavMode === "project" ? "创作导航" : "项目导航"}</button>
          </header>}
          {isNewDesignBookWorkspace && <nav id="new-design-mobile-project-nav" aria-label="项目导航" hidden={workspaceNavMode !== "project"} className="max-h-64 overflow-y-auto border-b bg-background px-4 py-3"><div className="grid grid-cols-2 gap-2 text-sm">{[...NEW_DESIGN_PRIMARY_NAV, ...NEW_DESIGN_ADVANCED_NAV].map(item => <Link key={item.key} to={item.href} className="rounded-md border px-3 py-2">{item.label}</Link>)}</div></nav>}
          <Suspense fallback={<AppRouteFallback />}>
            <Outlet />
          </Suspense>
          <TaskRecoveryDialog />
        </div>
      </TaskRecoveryProvider>
      </CreationSetupProvider>
    );
  }

  if (useMobileSiteLayout) {
    return (
      <CreationSetupProvider>
      <TaskRecoveryProvider>
        <MobileSiteShell>
          <AutoDirectorPauseNotificationWatcher />
          <LLMSelectionBootstrap />
          <Suspense fallback={<AppRouteFallback />}>
            <Outlet />
          </Suspense>
          <TaskRecoveryDialog />
        </MobileSiteShell>
      </TaskRecoveryProvider>
      </CreationSetupProvider>
    );
  }

  return (
    <CreationSetupProvider>
    <TaskRecoveryProvider>
      <div className="h-[100dvh] overflow-hidden bg-background">
        <AutoDirectorPauseNotificationWatcher />
        <LLMSelectionBootstrap />
        <Navbar
          workspaceNavMode={hasWorkspaceNavigation ? workspaceNavMode : undefined}
          onWorkspaceNavModeChange={hasWorkspaceNavigation ? setWorkspaceNavMode : undefined}
        />
        <div className="flex h-[calc(100dvh-4rem)] min-h-0">
          <div className={useMobileFullWidthContent || isNewDesignBookWorkspace && workspaceNavMode === "workspace" ? "hidden" : "shrink-0"}>
            {isNovelWorkspace && workspaceNavMode === "workspace" && workspaceRoute ? (
              <NovelWorkspaceRail
                novelId={workspaceRoute.novelId}
                chapterId={workspaceRoute.chapterId}
                collapsed={isWorkspaceRailCollapsed}
                onToggle={() => setIsWorkspaceRailCollapsed((current) => !current)}
                onSwitchToProjectNav={() => setWorkspaceNavMode("project")}
              />
            ) : (
              <Sidebar
                collapsed={isSidebarCollapsed}
                onToggle={() => setIsSidebarCollapsed((current) => !current)}
              />
            )}
          </div>
          <main data-new-design-nav-mode={isNewDesignBookWorkspace ? workspaceNavMode : undefined} className={useMobileFullWidthContent ? AUTO_DIRECTOR_MOBILE_CLASSES.appMain : DEFAULT_APP_MAIN_CLASS_NAME}>
            <Suspense fallback={<AppRouteFallback />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
        <TaskRecoveryDialog />
      </div>
    </TaskRecoveryProvider>
    </CreationSetupProvider>
  );
}
