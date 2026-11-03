// The Plateforme page's shared shapes (GET /api/platform) and labels.
import type { Subscription, SubscriptionState, Usage } from "@/lib/plans";

export type Company = { id: string; name: string; createdAt: string; ownerEmail: string | null; ownerName: string | null; subscription: Subscription; state: SubscriptionState; usage: Usage };
export type ErrorEntry = { id: number; area: string; message: string; workspaceId: string | null; count: number; firstAt: string; lastAt: string; recent: boolean };

/** An agency's « Demander un accès » (lib/access-requests.ts), as GET /api/platform?requests returns it. */
export type AccessRequest = {
  id: number; company: string; name: string; email: string; phone: string; city: string; teamSize: string; studioType: string; message: string;
  status: "pending" | "approved" | "declined"; createdAt: string; decidedAt: string | null; decidedBy: string | null; workspaceId: string | null;
};

export const phaseLabels: Record<SubscriptionState["phase"], string> = {
  trial: "Essai gratuit", paid: "Actif", grace: "Paiement attendu", "trial-ended": "Essai terminé", expired: "Expiré", canceled: "Suspendu",
};
