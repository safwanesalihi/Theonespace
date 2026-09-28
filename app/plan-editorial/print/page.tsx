import type { Metadata } from "next";
import PlanPrint from "./plan-print";

export const metadata: Metadata = { title: "Plan éditorial — The One Space", robots: { index: false } };

export default function PlanPrintPage() {
  return <PlanPrint />;
}
