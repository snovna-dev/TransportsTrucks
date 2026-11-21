"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface Option {
  value: string;
  label: string;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Fila única de filtros: rango de fechas (con atajos), empresa, placa y conductor. Se aplican al cambiar. */
export function DashboardFilters({
  companies,
  plates,
  drivers,
}: {
  companies: Option[];
  plates: Option[];
  drivers: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  function quickRange(kind: "mes" | "3m" | "12m" | "anio" | "todo") {
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const ranges = {
      mes: [new Date(Date.UTC(y, m, 1)), today],
      "3m": [new Date(Date.UTC(y, m - 2, 1)), today],
      "12m": [new Date(Date.UTC(y, m - 11, 1)), today],
      anio: [new Date(Date.UTC(y, 0, 1)), today],
      todo: [null, null],
    } as const;
    const [from, to] = ranges[kind];
    update({ desde: from ? isoDate(from) : null, hasta: to ? isoDate(to) : null });
  }

  const select = (name: string, label: string, options: Option[]) => (
    <label className="flex flex-col text-xs text-slate-600">
      {label}
      <select
        value={params.get(name) ?? ""}
        onChange={(event) => update({ [name]: event.target.value || null })}
        className="mt-1 h-9 min-w-40 max-w-56 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
      >
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  const hasFilters = ["desde", "hasta", "empresa", "placa", "conductor"].some((key) => params.get(key));

  return (
    <div className={`flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 ${pending ? "opacity-70" : ""}`}>
      <label className="flex flex-col text-xs text-slate-600">
        Desde
        <input
          type="date"
          value={params.get("desde") ?? ""}
          onChange={(event) => update({ desde: event.target.value || null })}
          className="mt-1 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
        />
      </label>
      <label className="flex flex-col text-xs text-slate-600">
        Hasta
        <input
          type="date"
          value={params.get("hasta") ?? ""}
          onChange={(event) => update({ hasta: event.target.value || null })}
          className="mt-1 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
        />
      </label>
      <div className="flex flex-col text-xs text-slate-600">
        Periodo
        <div className="mt-1 flex h-9 overflow-hidden rounded-md border border-slate-300 bg-white text-sm">
          {(
            [
              ["mes", "Este mes"],
              ["3m", "3 meses"],
              ["12m", "12 meses"],
              ["anio", "Este año"],
              ["todo", "Todo"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => quickRange(kind)}
              className="border-r border-slate-200 px-2.5 text-slate-700 last:border-r-0 hover:bg-slate-100"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {select("empresa", "Empresa", companies)}
      {select("placa", "Placa", plates)}
      {select("conductor", "Conductor", drivers)}
      {hasFilters && (
        <button
          type="button"
          onClick={() => startTransition(() => router.push(pathname))}
          className="h-9 rounded-md px-3 text-sm text-blue-700 hover:underline"
        >
          Limpiar filtros
        </button>
      )}
      {pending && <span className="h-9 text-xs leading-9 text-slate-500">Actualizando…</span>}
    </div>
  );
}
