// The Plateforme page's shared shapes (GET /api/platform) and labels.
import type { Subscription, SubscriptionState, Usage } from "@/lib/plans";

export type Company = { id: string; name: string; createdAt: string; ownerEmail: string | null; ownerName: string | null; subscription: Subscription; state: SubscriptionState; usage: Usage };
export type ErrorEntry = { id: number; area: string; message: string; workspaceId: string | null; count: number; firstAt: string; lastAt: string; recent: boolean };

export const phaseLabels: Record<SubscriptionState["phase"], string> = {
  trial: "Essai gratuit", paid: "Actif", grace: "Paiement attendu", "trial-ended": "Essai terminé", expired: "Expiré", canceled: "Suspendu",
};
