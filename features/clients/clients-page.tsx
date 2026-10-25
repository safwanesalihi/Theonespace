"use client";
// Every client of the studio as a card (tasks, approvals, completed work), searchable, with the archive.
import { behaviourOf, isDone } from "@/lib/process";
import { useProcess } from "@/features/workspace/process-context";
import { Blank } from "@/components/empty-state";
import { Heading } from "@/components/page-heading";
import Avatar from "@/components/profile-avatar";
import { Surface } from "@/components/ui/surface";
import ClientMark from "@/features/clients/client-mark";
import { useI18n } from "@/lib/i18n/locale-provider";
import { Search, Plus, ChevronRight, ArrowUpRight, Archive } from "lucide-react";
import type { ScreenProps } from "@/features/workspace/screen-props";
import type { TaskListView } from "@/features/tasks/use-task-list-view";

export function ClientsPage({ data, roles, lookups, actions, listView }: ScreenProps & { listView: Pick<TaskListView, "query" | "setQuery" | "showArchived" | "setShowArchived"> }) {
  const { t: tr } = useI18n();
  const process = useProcess();
  const { clients, tasks } = data;
  const { owner } = roles;
  const { avatarOf, dateLabel } = lookups;
  const { navigate, open } = actions;
  const { query, setQuery, showArchived, setShowArchived } = listView;
  const list = clients.filter(
    (c) =>
      !!c.archived === showArchived &&
      c.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Heading
        emoji="🗂️"
        title={tr("Clients")}
        subtitle={tr(
          "{n} clients actifs — chaque relation, au même endroit.",
          { n: clients.filter((c) => !c.archived).length },
        )}
      />
      <div className="client-toolbar">
        <label className="search-input">
          <Search size={16} />
          <input
            placeholder={tr("Rechercher un client…")}
            aria-label={tr("Rechercher un client")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="grow" />
        {owner && (
          <button className="btn primary" onClick={() => open("client")}>
            <Plus size={16} />
            {tr("Nouveau client")}
          </button>
        )}
      </div>
      <div className="clients-grid">
        {list.map((c) => {
          const ts = tasks.filter((t) => t.clientId === c.id);
          return (
            <Surface asChild tone="default" key={c.id}><button
              className="client-card"
              onClick={() => navigate({ page: "client", id: c.id })}
            >
              <header>
                <ClientMark name={c.name} logo={c.logo} size="lg" />
                <ArrowUpRight size={18} />
              </header>
              <h2>{c.name}</h2>
              <p>
                {c.sector || tr("Secteur à renseigner")} ·{" "}
                {c.city || tr("Ville à renseigner")}
              </p>
              <div className="client-counts">
                <span>
                  <strong>{ts.length}</strong>
                  {tr("Tâches")}
                </span>
                <span>
                  <strong>
                    {ts.filter((t) => behaviourOf(t.status, process) === "client").length}
                  </strong>
                  {tr("À valider")}
                </span>
                <span>
                  <strong>
                    {ts.filter((t) => isDone(t.status, process)).length}
                  </strong>
                  {tr("Validées")}
                </span>
              </div>
              <footer>
                <Avatar
                  name={ts[0]?.assignee || "Studio"}
                  avatar={avatarOf(ts[0]?.assignee)}
                />
                <small>
                  {tr("Créé le {date}", {
                    date: dateLabel(c.createdAt.slice(0, 10)),
                  })}
                </small>
              </footer>
            </button></Surface>
          );
        })}
      </div>
      {!list.length && (
        <Blank
          title={
            showArchived ? tr("Aucun client archivé") : tr("Aucun client")
          }
          text={tr(
            owner
              ? "Ajoutez votre premier client pour organiser son travail."
              : "Seul le propriétaire peut ajouter des clients.",
          )}
        />
      )}
      <button
        className="add-row"
        onClick={() => setShowArchived(!showArchived)}
      >
        <Archive size={16} />
        {showArchived
          ? tr("Afficher les clients actifs")
          : tr("Archivés ({n})", {
              n: clients.filter((c) => c.archived).length,
            })}
        <ChevronRight size={14} />
      </button>
    </>
  );
}
