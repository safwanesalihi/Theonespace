// The studio's own numbers (lib/process.ts DashboardSettings): up to six, picked from a library — the
// One Flow's six, the work delivered, the hours spent — or the total of one of its own number or amount
// fields (an ad budget, a fee…). Each one against the studio's target: « good » when it holds, « watch »
// when it doesn't, nothing when the period has nothing to measure.
import { computeMetrics, countsInMetrics, dayIn, flow, type Period } from '@/lib/flow';
import type { RecordItem } from '@/lib/model';
import { oneCoreProcess, type DashboardMetric, type Process } from '@/lib/process';
import { workReport } from '@/lib/reports';

export type MetricKind = 'share' | 'hours' | 'count' | 'number' | 'money';
type Builtin = { label: string; kind: MetricKind; atMost?: boolean };
/** The library. Shares are fractions (0.95 is 95 %), hours are hours. */
export const builtinMetrics = {
  onTime: { label: 'Publiés à l’heure', kind: 'share' },
  approvalHours: { label: 'Délai médian de validation', kind: 'hours', atMost: true },
  silence: { label: 'Validés par silence', kind: 'share', atMost: true },
  rounds: { label: 'Tours de retours par contenu', kind: 'number', atMost: true },
  deliveredVsSold: { label: 'Livré vs vendu', kind: 'share' },
  evergreen: { label: 'Réserve evergreen', kind: 'number' },
  delivered: { label: 'Contenus publiés', kind: 'count' },
  hours: { label: 'Heures passées', kind: 'hours' },
} satisfies Record<string, Builtin>;

/** The six numbers of The One Flow, with its targets: what a studio that picks nothing sees. */
export const defaultDashboard: DashboardMetric[] = [
  { id: 'onTime', target: flow.targets.onTimeRate },
  { id: 'approvalHours', target: flow.targets.medianValidationHours },
  { id: 'silence', target: flow.targets.silenceShare },
  { id: 'rounds', target: flow.targets.roundsPerItem },
  { id: 'deliveredVsSold', target: flow.targets.deliveredVsSold[0] },
  { id: 'evergreen', target: flow.targets.evergreen },
];
export const dashboardOf = (process: Pick<Process, 'dashboard'>) => process.dashboard?.metrics ?? defaultDashboard;

export type MetricValue = { id: string; label: string; kind: MetricKind; unit?: string; value: number | null; target?: number; atMost: boolean; state: 'good' | 'watch' | null };

/** The studio's numbers over a period. A field's total counts the work dated in the period (its due day, else its creation). */
export function computeDashboard(records: RecordItem[], period: Period, process: Process = oneCoreProcess, now = Date.now()): MetricValue[] {
  const chosen = dashboardOf(process);
  const m = computeMetrics(records, period, process);
  const hours = chosen.some((c) => c.id === 'hours') ? workReport(records, period, now, process).loggedMs / 3_600_000 : null;
  const tasks = records.filter((r) => r.kind === 'task' && countsInMetrics(r));
  const builtinValue: Record<keyof typeof builtinMetrics, number | null> = {
    onTime: m.onTimeRate, approvalHours: m.medianValidationHours, silence: m.silenceShare, rounds: m.roundsPerItem,
    deliveredVsSold: m.deliveredVsSold, evergreen: m.evergreenPerClient, delivered: m.published, hours,
  };
  return chosen.flatMap((c): MetricValue[] => {
    let base: Builtin & { unit?: string }, value: number | null;
    if (c.id in builtinMetrics) {
      const id = c.id as keyof typeof builtinMetrics;
      base = builtinMetrics[id]; value = builtinValue[id];
    } else {
      const def = process.fields?.find((f) => `field:${f.id}` === c.id && (f.type === 'number' || f.type === 'money'));
      if (!def) return [];
      const dated = tasks.filter((t) => { const d = t.due || (t.createdAt ? dayIn(new Date(t.createdAt)) : ''); return d >= period.from && d <= period.to; });
      const values = dated.map((t) => t.fields?.[def.id]).filter((v): v is number => typeof v === 'number');
      base = { label: def.label, kind: def.type === 'money' ? 'money' : 'number', unit: def.unit };
      value = values.length ? values.reduce((a, b) => a + b, 0) : null;
    }
    const atMost = c.atMost ?? !!base.atMost;
    const state = value === null || c.target === undefined ? null : (atMost ? value <= c.target : value >= c.target) ? 'good' : 'watch';
    return [{ id: c.id, label: base.label, kind: base.kind, unit: base.unit, value, target: c.target, atMost, state }];
  });
}
