"use client";
// The task list offered to an assistant running in the browser (WebMCP « list_tracker_tasks »): read
// only, active tasks, optionally by status.
import { useEffect } from "react";
import { statuses, type RecordItem, type Status } from "@/lib/model";

export function useTaskListTool(tasks: RecordItem[], tr: (text: string) => string) {
  useEffect(() => {
    const mc = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!mc?.registerTool) return;
    const lifecycle = new AbortController();
    const tool = {
      name: "list_tracker_tasks",
      title: tr("Lister les tâches"),
      description: tr(
        "Lire les tâches actives de l’espace, éventuellement filtrées par statut.",
      ),
      inputSchema: {
        type: "object",
        properties: { status: { type: "string", enum: [...statuses] } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input: unknown) {
        const i = input as { status?: Status };
        if (
          !i ||
          typeof i !== "object" ||
          Object.keys(i).some((k) => k !== "status") ||
          (i.status && !statuses.includes(i.status))
        )
          throw Error(tr("Filtre invalide"));
        return tasks
          .filter((t) => !i.status || t.status === i.status)
          .map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status,
            due: t.due,
          }));
      },
    };
    try {
      Promise.resolve(
        mc.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, [tasks, tr]);
}
