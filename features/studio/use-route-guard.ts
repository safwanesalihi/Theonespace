"use client";
// Pages a role may not open send the person home (or, for a client, to their portal): applied once the
// workspace (and so the role) has loaded, and on every navigation after.
import { useEffect } from "react";
import type { WorkspaceRoute } from "@/lib/navigation";
import { canSocial, isManager, type WorkspaceContext } from "@/lib/workspace";

export function useRouteGuard(workspace: WorkspaceContext | null, route: WorkspaceRoute, navigate: (route: WorkspaceRoute) => void) {
  // Studio members without management rights have no pilotage, annex or portal preview. Clients live in the portal and keep those routes.
  // Synchronize the externally loaded role with browser navigation.
  useEffect(() => {
    if (!workspace) return;
    const role = workspace.role;
    if (
      role !== "client" &&
      !isManager(role) &&
      ["flow", "annex", "portal", "review"].includes(route.page)
    )
      navigate({ page: "home" });
    if (role !== "owner" && route.page === "activity")
      navigate({ page: "home" });
    if (!canSocial(role) && (route.page === "social" || (route.page === "client" && route.tab === "editorial")))
      navigate({ page: "home" });
    if (!isManager(role) && route.page === "client" && route.tab === "files")
      navigate({ page: "client", id: route.id, tab: "overview" });
    if (role === "client" && !["portal", "review"].includes(route.page))
      navigate({ page: "portal", id: workspace.clientId || "", tab: "home" });
  }, [workspace, route.page, route.tab, navigate]);
}
