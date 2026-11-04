"use client";
// « Instagram »: one page for one job (docs/MENU-AUDIT.md §4 A). « Rechercher » finds creators by city
// and theme (ig-search.tsx), « Analyser » reads one account (ig-analyzer.tsx); a found account opens on
// « Analyser ». The tab is in the route, so Back, a bookmark and the old #ig-search links land on it.
import { ChartNoAxesCombined, UserSearch } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { WorkspaceRoute } from "@/lib/navigation";
import IgAnalyzer from "./ig-analyzer";
import IgSearch from "./ig-search";

export default function InstagramPage({ route, title, workspaceId, onError, navigate }: {
  route: WorkspaceRoute;
  title: string;
  workspaceId: string;
  onError: (message: string) => void;
  navigate: (route: WorkspaceRoute) => void;
}) {
  const { t } = useI18n();
  // #ig and #ig/<account> were « Analyse Instagram »: they still open there.
  const tab = route.tab === "search" ? "search" : "analyze";
  return (
    <>
      <div className="page-heading">
        <span className="page-symbol" aria-hidden="true"><ChartNoAxesCombined size={22} /></span>
        <div className="heading-line"><h1>{title}</h1></div>
      </div>
      <Tabs value={tab} onValueChange={(next) => navigate(next === "search" ? { page: "ig", tab: "search" } : { page: "ig" })}>
        <TabsList className="ig-tabs">
          <TabsTrigger value="search"><UserSearch size={15} />{t("Rechercher")}</TabsTrigger>
          <TabsTrigger value="analyze"><ChartNoAxesCombined size={15} />{t("Analyser")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "search"
        ? <IgSearch workspaceId={workspaceId} onError={onError} onAnalyze={(username) => navigate({ page: "ig", id: username })} />
        : <IgAnalyzer key={route.id ?? ""} workspaceId={workspaceId} onError={onError} initial={route.id} />}
    </>
  );
}
