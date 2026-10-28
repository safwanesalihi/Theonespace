"use client";
// The task list offered to an assistant running in the browser (WebMCP « list_tracker_tasks »): read
// only, active tasks, optionally by status.
import { useEffect } from "react";
import type { RecordItem } from "@/lib/model";
import { oneCoreProcess, statusByName, statusLabel, type Process } from "@/lib/process";

export function useTaskListTool(tasks: RecordItem[], tr: (text: string) => string, process: Process = oneCoreProcess) {
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
        properties: { status: { type: "string", enum: process.statuses.map((s) => s.label) } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input: unknown) {
        const i = input as { status?: string };
        const wanted = statusByName(process, i?.status);
        if (
          !i ||
          typeof i !== "object" ||
          Object.keys(i).some((k) => k !== "status") ||
          (i.status && !wanted)
        )
          throw Error(tr("Filtre invalide"));
        return tasks
          .filter((t) => !wanted || t.status === wanted)
          .map((t) => ({
            id: t.id,
            name: t.name,
            status: statusLabel(t.status, process),
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
  }, [tasks, tr, process]);
}
