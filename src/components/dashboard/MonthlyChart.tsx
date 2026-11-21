"use client";

import { useState } from "react";
import { formatCompact, formatValue, niceScale, type ValueKind } from "./chart-format";

export interface MonthlyPoint {
  key: string;
  label: string;
  count: number;
  totalTripValue: number;
  netValueToPay: number;
  advanceValue: number;
  balanceToPay: number;
  withholding: number;
}

const METRICS: Array<{ key: keyof MonthlyPoint; label: string; kind: ValueKind }> = [
  { key: "totalTripValue", label: "Valor total del viaje", kind: "money" },
  { key: "netValueToPay", label: "Valor neto a pagar", kind: "money" },
  { key: "advanceValue", label: "Anticipos", kind: "money" },
  { key: "balanceToPay", label: "Saldo a pagar", kind: "money" },
  { key: "withholding", label: "Retenciones", kind: "money" },
  { key: "count", label: "Cantidad de manifiestos", kind: "count" },
];

const WIDTH = 760;
const HEIGHT = 260;
const MARGIN = { top: 16, right: 12, bottom: 30, left: 72 };
const BAR = "#2a78d6"; // serie única (slot 1 de la paleta)

/** Barras por mes con selector de métrica (un solo eje) y tooltip al pasar el mouse. */
export function MonthlyChart({ data }: { data: MonthlyPoint[] }) {
  const [metricKey, setMetricKey] = useState<keyof MonthlyPoint>("totalTripValue");
  const [hover, setHover] = useState<number | null>(null);
  const metric = METRICS.find((m) => m.key === metricKey)!;

  const values = data.map((point) => Number(point[metric.key]));
  const { top, ticks } = niceScale(Math.max(0, ...values));
  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = data.length ? plotW / data.length : plotW;
  const barW = Math.max(4, Math.min(44, band - 2 - band * 0.35));
  const y = (value: number) => MARGIN.top + plotH - (value / top) * plotH;
  const maxIndex = values.indexOf(Math.max(...values));
  const labelEvery = Math.ceil(data.length / 12);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Métrica">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={m.key === metricKey}
            onClick={() => setMetricKey(m.key)}
            className={`rounded-full border px-3 py-1 text-xs ${
              m.key === metricKey ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">Sin datos para los filtros seleccionados.</p>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label={`${metric.label} por mes`}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="#e7e5e4" strokeWidth={1} />
                <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="#52514e">
                  {formatCompact(tick, metric.kind)}
                </text>
              </g>
            ))}
            {data.map((point, index) => {
              const value = values[index]!;
              const x = MARGIN.left + index * band + (band - barW) / 2;
              const barTop = y(value);
              const h = MARGIN.top + plotH - barTop;
              const r = Math.min(4, h, barW / 2);
              return (
                <g key={point.key}>
                  {h > 0 && (
                    <path
                      d={`M${x},${barTop + h} V${barTop + r} Q${x},${barTop} ${x + r},${barTop} H${x + barW - r} Q${x + barW},${barTop} ${x + barW},${barTop + r} V${barTop + h} Z`}
                      fill={BAR}
                      opacity={hover === null || hover === index ? 1 : 0.45}
                    />
                  )}
                  {index === maxIndex && value > 0 && (
                    <text x={x + barW / 2} y={barTop - 5} textAnchor="middle" fontSize={11} fill="#0b0b0b">
                      {formatCompact(value, metric.kind)}
                    </text>
                  )}
                  {index % labelEvery === 0 && (
                    <text x={x + barW / 2} y={HEIGHT - 10} textAnchor="middle" fontSize={11} fill="#52514e">
                      {point.label}
                    </text>
                  )}
                  <rect
                    x={MARGIN.left + index * band}
                    y={MARGIN.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(index)}
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              );
            })}
            <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH} stroke="#a8a29e" />
          </svg>

          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute z-10 w-56 rounded-md border border-slate-200 bg-white p-2.5 text-xs shadow-lg"
              style={{
                left: `${((MARGIN.left + hover * band + band / 2) / WIDTH) * 100}%`,
                top: 0,
                transform: hover > data.length / 2 ? "translateX(-105%)" : "translateX(5%)",
              }}
            >
              <div className="mb-1 font-semibold capitalize text-slate-900">{data[hover].label}</div>
              {METRICS.map((m) => (
                <div key={m.key} className={`flex justify-between gap-3 ${m.key === metricKey ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                  <span>{m.label}</span>
                  <span className="tabular-nums">{formatValue(Number(data[hover]![m.key]), m.kind)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
