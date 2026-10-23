"use client";
// The confirmation line after an action (« Envoyé au client », « Marque enregistrée »), as a Sonner toast:
// it slides in, stacks, and leaves on its own. The screen keeps its `notice` string; this only shows it.
import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { useI18n } from "@/lib/i18n/locale-provider";

export function NoticeToaster({ notice }: { notice: string }) {
  const { dir, t } = useI18n();
  useEffect(() => {
    if (notice) toast(notice, { id: notice, icon: <CheckCircle2 size={17} aria-hidden /> });
  }, [notice]);
  return <Toaster position="bottom-center" dir={dir} containerAriaLabel={t("Notifications")} gap={8} visibleToasts={3} toastOptions={{ className: "notice-toast", duration: 3600 }} />;
}
