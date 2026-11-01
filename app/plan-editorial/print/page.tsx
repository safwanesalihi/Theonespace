import type { Metadata } from "next";
import PlanPrint from "./plan-print";
import '@/app/styles.css'; // the app's stylesheet (app/layout.tsx carries only app/base.css)

export const metadata: Metadata = { title: "Plan éditorial — The One Space", robots: { index: false } };

export default function PlanPrintPage() {
  return <PlanPrint />;
}
