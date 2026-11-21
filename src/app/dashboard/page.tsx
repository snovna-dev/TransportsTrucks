import Link from "next/link";
import { Suspense } from "react";
import { getDashboardData, parseDashboardFilters, type GroupRow } from "../../services/dashboard.service";
import { formatDate, formatMoney } from "../../lib/format";
import { DashboardFilters } from "../../components/dashboard/DashboardFilters";
import { MonthlyChart } from "../../components/dashboard/MonthlyChart";
import { RankedBars, type RankedRow } from "../../components/dashboard/RankedBars";
import { StatTile } from "../../components/dashboard/StatTile";
import { formatValue } from "../../components/dashboard/chart-format";
import { ManifestStatus } from "../../components/manifests/ManifestStatus";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function Card({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const data = await getDashboardData(filters);
  const { totals } = data;

  // Conserva los filtros actuales al hacer clic en una empresa/placa/conductor.
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => (typeof value === "string" && value ? [[key, value]] : [])),
  );
  const withParam = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    next.set(key, value);
    return `/dashboard?${next.toString()}`;
  };
  const toRanked = (rows: GroupRow[], param?: string): RankedRow[] =>
    rows.map((row) => ({ ...row, href: param ? withParam(param, row.key) : undefined }));

  const average = totals.count ? totals.totalTripValue / totals.count : 0;
  const recent = [...data.manifests].reverse().slice(0, 10);
  const periodText =
    filters.from || filters.to
      ? `${filters.from ? formatDate(new Date(`${filters.from}T00:00:00Z`)) : "inicio"} – ${filters.to ? formatDate(new Date(`${filters.to}T00:00:00Z`)) : "hoy"}`
      : "Todo el historial";

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {periodText} · por fecha de expedición del manifiesto
          </p>
        </div>
        <a
          href={`/api/dashboard/export?${query.toString()}`}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Exportar CSV
        </a>
      </div>

      <Suspense>
        <DashboardFilters {...data.options} />
      </Suspense>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Manifiestos" value={formatValue(totals.count, "count")} hint={`Promedio ${formatMoney(average)} por viaje`} />
        <StatTile label="Valor total de viajes" value={formatMoney(totals.totalTripValue)} />
        <StatTile label="Valor neto a pagar" value={formatMoney(totals.netValueToPay)} hint={`Retenciones ${formatMoney(totals.withholding)}`} />
        <StatTile label="Saldo a pagar" value={formatMoney(totals.balanceToPay)} hint={`Anticipos ${formatMoney(totals.advanceValue)}`} />
        <StatTile label="Carga transportada" value={formatValue(data.quantityKg, "kg")} hint="Solo remesas en kilogramos" />
        <StatTile label="Empresas" value={formatValue(data.byCompany.length, "count")} />
        <StatTile label="Vehículos / conductores" value={`${data.byVehicle.length} / ${data.byDriver.length}`} />
        <Link href="/manifests/review" className="block">
          <StatTile
            label="Pendientes de revisión"
            value={formatValue(data.pendingReview, "count")}
            hint={data.pendingErrors ? `${data.pendingErrors} con error · ver →` : "Ver revisión →"}
          />
        </Link>
      </div>

      <Card title="Valores mensuales" subtitle="Pase el mouse sobre un mes para ver el detalle">
        <MonthlyChart data={data.monthly} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Manifiestos por empresa" subtitle="Valor total del viaje · clic para filtrar">
          <RankedBars rows={toRanked(data.byCompany, "empresa")} />
        </Card>
        <Card title="Rutas más frecuentes" subtitle="Origen → destino, por valor total">
          <RankedBars rows={toRanked(data.byRoute)} />
        </Card>
        <Card title="Por vehículo" subtitle="Placa · clic para filtrar">
          <RankedBars rows={toRanked(data.byVehicle, "placa")} />
        </Card>
        <Card title="Por conductor" subtitle="Clic para filtrar">
          <RankedBars rows={toRanked(data.byDriver, "conductor")} />
        </Card>
      </div>

      <Card title="Detalle mensual">
        {data.monthly.length === 0 ? (
          <p className="text-sm text-slate-500">Sin datos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Mes</th>
                  <th className="py-2 pr-4 text-right">Manifiestos</th>
                  <th className="py-2 pr-4 text-right">Valor total</th>
                  <th className="py-2 pr-4 text-right">Retenciones</th>
                  <th className="py-2 pr-4 text-right">Neto a pagar</th>
                  <th className="py-2 pr-4 text-right">Anticipos</th>
                  <th className="py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {[...data.monthly].reverse().filter((row) => row.count > 0).map((row) => (
                  <tr key={row.key}>
                    <td className="py-1.5 pr-4 capitalize">{row.label}</td>
                    <td className="py-1.5 pr-4 text-right">{row.count}</td>
                    <td className="py-1.5 pr-4 text-right">{formatMoney(row.totalTripValue)}</td>
                    <td className="py-1.5 pr-4 text-right">{formatMoney(row.withholding)}</td>
                    <td className="py-1.5 pr-4 text-right">{formatMoney(row.netValueToPay)}</td>
                    <td className="py-1.5 pr-4 text-right">{formatMoney(row.advanceValue)}</td>
                    <td className="py-1.5 text-right">{formatMoney(row.balanceToPay)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 pr-4">Total</td>
                  <td className="py-2 pr-4 text-right">{totals.count}</td>
                  <td className="py-2 pr-4 text-right">{formatMoney(totals.totalTripValue)}</td>
                  <td className="py-2 pr-4 text-right">{formatMoney(totals.withholding)}</td>
                  <td className="py-2 pr-4 text-right">{formatMoney(totals.netValueToPay)}</td>
                  <td className="py-2 pr-4 text-right">{formatMoney(totals.advanceValue)}</td>
                  <td className="py-2 text-right">{formatMoney(totals.balanceToPay)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Últimos manifiestos"
        action={
          <Link href="/manifests" className="text-sm text-blue-700 hover:underline">
            Ver todos
          </Link>
        }
      >
        {recent.length === 0 ? (
          <p className="text-sm text-slate-500">Sin manifiestos para estos filtros.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Manifiesto</th>
                  <th className="py-2 pr-4">Expedición</th>
                  <th className="py-2 pr-4">Empresa</th>
                  <th className="py-2 pr-4">Ruta</th>
                  <th className="py-2 pr-4">Placa</th>
                  <th className="py-2 pr-4 text-right">Valor</th>
                  <th className="py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((m) => (
                  <tr key={m.id.toString()}>
                    <td className="py-1.5 pr-4">
                      <Link href={`/manifests/${m.id}`} className="text-blue-700 hover:underline">
                        {m.manifestNumber}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-4 whitespace-nowrap">{formatDate(m.issueDate)}</td>
                    <td className="py-1.5 pr-4">{m.company.name}</td>
                    <td className="py-1.5 pr-4">
                      {m.origin ?? "—"} → {m.destination ?? "—"}
                    </td>
                    <td className="py-1.5 pr-4">{m.vehicle?.plate ?? "—"}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{formatMoney(m.totalTripValue)}</td>
                    <td className="py-1.5">
                      <ManifestStatus status={m.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
