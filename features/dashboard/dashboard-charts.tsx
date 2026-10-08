'use client';
// Small, opinionated recharts wrappers shared by the studio dashboard, the client portal and
// the home screen — a donut with a legend, a filled trend line, and a two-series bar compare.
import { useId, useSyncExternalStore } from 'react';
import { watchMediaQuery } from '@/lib/media-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const motionQuery = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (onChange: () => void) => {
  const query = window.matchMedia(motionQuery);
  return watchMediaQuery(query, onChange);
};
const getReducedMotion = () => window.matchMedia(motionQuery).matches;
const getServerMotion = () => true;
const useReducedMotion = () => useSyncExternalStore(subscribeMotion, getReducedMotion, getServerMotion);

type TooltipEntry = { name?: string; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };
type TooltipRenderProps = { active?: boolean; label?: string | number; payload?: TooltipEntry[] };

function fmt(value: number | string | undefined) {
  return typeof value === 'number' ? value.toLocaleString() : (value ?? '');
}

function SliceTooltip({ active, payload }: TooltipRenderProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return <div className="chart-tooltip"><strong>{p.name}</strong><span><i style={{ background: p.color }} />{fmt(p.value)}</span></div>;
}

function TrendTooltip({ active, payload, label }: TooltipRenderProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const text = (p.payload?.label as string | undefined) ?? label;
  return <div className="chart-tooltip"><strong>{text}</strong><span><i style={{ background: p.color }} />{fmt(p.value)}</span></div>;
}

function GroupTooltip({ active, payload, label }: TooltipRenderProps) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((p) => <span key={String(p.dataKey)}><i style={{ background: p.color }} />{p.name} : {fmt(p.value)}</span>)}</div>;
}

export type Slice = { key: string; label: string; value: number; color: string };

/** A donut chart with a centered total and a legend list — the status/court breakdown pattern. */
export function DonutStat({ data, centerLabel, size = 156, onSelect, selectedKey }: { data: Slice[]; centerLabel: string; size?: number; onSelect?: (key: string) => void; selectedKey?: string }) {
  const reducedMotion = useReducedMotion();
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const chartData = total > 0 ? data.filter((d) => d.value > 0) : [{ key: 'empty', label: centerLabel, value: 1, color: 'var(--t-line)' }];
  return (
    <div className="donut-stat">
      <div className="donut-chart" role="img" aria-label={`${centerLabel}: ${total}`} style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: size, height: size }}>
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="label" innerRadius="70%" outerRadius="100%" strokeWidth={0} paddingAngle={chartData.length > 1 ? 2 : 0} isAnimationActive={total > 0 && !reducedMotion} animationDuration={400}>
              {chartData.map((d) => <Cell key={d.key} fill={d.color} opacity={selectedKey && selectedKey !== d.key ? 0.35 : 1} onClick={onSelect && d.key !== 'empty' ? () => onSelect(d.key) : undefined} style={{ cursor: onSelect && d.key !== 'empty' ? 'pointer' : undefined }} />)}
            </Pie>
            {total > 0 && <Tooltip content={<SliceTooltip />} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center"><strong>{total}</strong><small>{centerLabel}</small></div>
      </div>
      <ul className="donut-legend">{data.map((d) => <li key={d.key}>{onSelect ? <button type="button" aria-pressed={selectedKey === d.key} onClick={() => onSelect(d.key)}><span className="donut-dot" style={{ background: d.color }} /><span>{d.label}</span><b>{d.value}</b></button> : <><span className="donut-dot" style={{ background: d.color }} />{d.label}<b>{d.value}</b></>}</li>)}</ul>
    </div>
  );
}

export type TrendPoint = { x: string; y: number; label?: string };

/** A filled trend line for a numeric series over time. */
export function TrendArea({ data, color = 'var(--t-brand)', height = 176, xTickFormatter }: { data: TrendPoint[]; color?: string; height?: number; xTickFormatter?: (x: string) => string }) {
  const reducedMotion = useReducedMotion();
  const gradId = `trend-${useId().replace(/[:_]/g, '')}`;
  const flat = !data.some((d) => d.y > 0);
  return (
    <div className="trend-chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height }}>
        <AreaChart accessibilityLayer data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs><linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={color} stopOpacity={0.32} /><stop offset="95%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="var(--t-line)" />
          <XAxis dataKey="x" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} stroke="var(--t-text-muted)" minTickGap={28} tickFormatter={xTickFormatter} />
          <YAxis hide allowDecimals={false} domain={flat ? [0, 1] : ['auto', 'auto']} />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--t-line-strong)', strokeWidth: 1 }} />
          <Area type="monotone" dataKey="y" stroke={color} strokeWidth={2} fill={`url(#${gradId})`} activeDot={{ r: 5, strokeWidth: 2 }} isAnimationActive={!reducedMotion} animationDuration={400} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export type BarGroup = { key: string; label: string; a: number; b: number };

/** A two-series bar comparison, e.g. sold vs. delivered per client. */
export function BarCompare({ data, aLabel, bLabel, aColor = 'var(--t-text-muted)', bColor = 'var(--t-brand)', height = 220 }: { data: BarGroup[]; aLabel: string; bLabel: string; aColor?: string; bColor?: string; height?: number }) {
  const reducedMotion = useReducedMotion();
  return (
    <div className="bar-compare" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height }}>
        <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barGap={4}>
          <CartesianGrid vertical={false} stroke="var(--t-line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} stroke="var(--t-text-muted)" interval="preserveStartEnd" minTickGap={20} tickFormatter={(label: string) => label.length > 14 ? `${label.slice(0, 13)}…` : label} height={28} />
          <YAxis hide allowDecimals={false} />
          <Tooltip content={<GroupTooltip />} cursor={{ fill: 'var(--t-surface-sunken)' }} />
          <Bar dataKey="a" name={aLabel} fill={aColor} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={!reducedMotion} animationDuration={400} />
          <Bar dataKey="b" name={bLabel} fill={bColor} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={!reducedMotion} animationDuration={400} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
