"use client";

import Link from "next/link";
import { useState } from "react";
import { formatValue } from "./chart-format";

export interface RankedRow {
  key: string;
  label: string;
  detail?: string;
  count: number;
  totalTripValue: number;
  netValueToPay: number;
  balanceToPay: number;
  /** Enlace para filtrar el dashboard por este elemento. */
  href?: string;
}

const BAR = "#2a78d6";

/** Barras horizontales ordenadas por valor total, con el conteo de manifiestos y tooltip. */
export function RankedBars({ rows, limit = 8, emptyText }: { rows: RankedRow[]; limit?: number; emptyText?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">{emptyText ?? "Sin datos."}</p>;
  }

  const visible = rows.slice(0, limit);
  const rest = rows.slice(limit);
  if (rest.length > 0) {
    visible.push({
      key: "__otros",
      label: `Otros (${rest.length})`,
      count: rest.reduce((s, r) => s + r.count, 0),
      totalTripValue: rest.reduce((s, r) => s + r.totalTripValue, 0),
      netValueToPay: rest.reduce((s, r) => s + r.netValueToPay, 0),
      balanceToPay: rest.reduce((s, r) => s + r.balanceToPay, 0),
    });
  }
  const max = Math.max(...visible.map((r) => r.totalTripValue), 1);

  return (
    <ul className="space-y-2.5">
      {visible.map((row) => (
        <li
          key={row.key}
          className="relative"
          onMouseEnter={() => setHover(row.key)}
          onMouseLeave={() => setHover(null)}
        >
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-800" title={row.label}>
              {row.href ? (
                <Link href={row.href} className="hover:underline">
                  {row.label}
                </Link>
              ) : (
                row.label
              )}
            </span>
            <span className="shrink-0 tabular-nums text-slate-900">{formatValue(row.totalTripValue, "money")}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2.5 flex-1 rounded-sm bg-slate-100">
              <div
                className="h-2.5 rounded-r-[4px]"
                style={{ width: `${(row.totalTripValue / max) * 100}%`, background: BAR, opacity: hover === null || hover === row.key ? 1 : 0.45 }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-xs text-slate-500">
              {row.count} {row.count === 1 ? "manifiesto" : "manifiestos"}
            </span>
          </div>
          {hover === row.key && (
            <div className="pointer-events-none absolute right-0 top-full z-10 mt-1 w-60 rounded-md border border-slate-200 bg-white p-2.5 text-xs shadow-lg">
              <div className="mb-1 font-semibold text-slate-900">{row.label}</div>
              {row.detail && <div className="mb-1 text-slate-500">{row.detail}</div>}
              <Line label="Manifiestos" value={formatValue(row.count, "count")} />
              <Line label="Valor total" value={formatValue(row.totalTripValue, "money")} />
              <Line label="Neto a pagar" value={formatValue(row.netValueToPay, "money")} />
              <Line label="Saldo a pagar" value={formatValue(row.balanceToPay, "money")} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-slate-600">
      <span>{label}</span>
      <span className="tabular-nums text-slate-900">{value}</span>
    </div>
  );
}
