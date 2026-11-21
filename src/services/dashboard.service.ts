import { prisma } from "../lib/prisma";
import { ManifestJobStatus } from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";

/** Filtros del dashboard (vienen de la URL). Fechas en formato AAAA-MM-DD sobre la fecha de expedición. */
export interface DashboardFilters {
  from?: string;
  to?: string;
  companyId?: string;
  plate?: string;
  driverId?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDashboardFilters(params: Record<string, string | string[] | undefined>): DashboardFilters {
  const get = (key: string) => {
    const value = params[key];
    const text = (Array.isArray(value) ? value[0] : value)?.trim();
    return text ? text : undefined;
  };
  const from = get("desde");
  const to = get("hasta");
  const companyId = get("empresa");
  const driverId = get("conductor");
  return {
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
    companyId: companyId && /^\d+$/.test(companyId) ? companyId : undefined,
    plate: get("placa")?.toUpperCase(),
    driverId: driverId && /^\d+$/.test(driverId) ? driverId : undefined,
  };
}

export function buildManifestWhere(filters: DashboardFilters): Prisma.ManifestWhereInput {
  const where: Prisma.ManifestWhereInput = {};
  if (filters.from || filters.to) {
    where.issueDate = {
      ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00Z`) } : {}),
      ...(filters.to ? { lte: new Date(`${filters.to}T00:00:00Z`) } : {}),
    };
  }
  if (filters.companyId) where.companyId = BigInt(filters.companyId);
  if (filters.driverId) where.driverId = BigInt(filters.driverId);
  if (filters.plate) where.vehicle = { plate: filters.plate };
  return where;
}

const manifestSelect = {
  id: true,
  manifestNumber: true,
  authorizationNumber: true,
  issueDate: true,
  origin: true,
  destination: true,
  status: true,
  totalTripValue: true,
  withholdingTax: true,
  icaWithholding: true,
  netValueToPay: true,
  advanceValue: true,
  balanceToPay: true,
  company: { select: { id: true, name: true, nit: true } },
  vehicle: { select: { plate: true } },
  driver: { select: { id: true, fullName: true } },
  cargo: { select: { quantity: true, measurementUnit: true, transportedProduct: true } },
} satisfies Prisma.ManifestSelect;

export type DashboardManifest = Prisma.ManifestGetPayload<{ select: typeof manifestSelect }>;

/** Con ~8 manifiestos al mes, agregar en memoria es simple y suficiente. */
const MAX_ROWS = 10_000;

export async function getFilteredManifests(filters: DashboardFilters) {
  return prisma.manifest.findMany({
    where: buildManifestWhere(filters),
    orderBy: [{ issueDate: "asc" }, { id: "asc" }],
    take: MAX_ROWS,
    select: manifestSelect,
  });
}

const num = (value: { toString(): string } | null | undefined) => (value ? Number(value.toString()) : 0);

export interface MoneyTotals {
  count: number;
  totalTripValue: number;
  withholding: number;
  netValueToPay: number;
  advanceValue: number;
  balanceToPay: number;
}

function emptyTotals(): MoneyTotals {
  return { count: 0, totalTripValue: 0, withholding: 0, netValueToPay: 0, advanceValue: 0, balanceToPay: 0 };
}

function addTo(totals: MoneyTotals, manifest: DashboardManifest) {
  totals.count += 1;
  totals.totalTripValue += num(manifest.totalTripValue);
  totals.withholding += num(manifest.withholdingTax) + num(manifest.icaWithholding);
  totals.netValueToPay += num(manifest.netValueToPay);
  totals.advanceValue += num(manifest.advanceValue);
  totals.balanceToPay += num(manifest.balanceToPay);
}

export interface GroupRow extends MoneyTotals {
  key: string;
  label: string;
  detail?: string;
}

function groupBy(
  manifests: DashboardManifest[],
  keyOf: (manifest: DashboardManifest) => { key: string; label: string; detail?: string } | null,
): GroupRow[] {
  const groups = new Map<string, GroupRow>();
  for (const manifest of manifests) {
    const group = keyOf(manifest);
    if (!group) continue;
    let row = groups.get(group.key);
    if (!row) {
      row = { ...group, ...emptyTotals() };
      groups.set(group.key, row);
    }
    addTo(row, manifest);
  }
  return [...groups.values()].sort((a, b) => b.totalTripValue - a.totalTripValue || b.count - a.count);
}

const MONTH_NAMES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/** Todos los meses entre el primero y el último con datos (los vacíos quedan en cero). */
function monthlySeries(manifests: DashboardManifest[]): GroupRow[] {
  if (manifests.length === 0) return [];
  const byMonth = new Map(groupBy(manifests, (m) => ({ key: monthKey(m.issueDate), label: "" })).map((row) => [row.key, row]));
  const first = manifests[0]!.issueDate;
  const last = manifests[manifests.length - 1]!.issueDate;
  const rows: GroupRow[] = [];
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  while (year < last.getUTCFullYear() || (year === last.getUTCFullYear() && month <= last.getUTCMonth())) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    rows.push({ ...(byMonth.get(key) ?? { key, ...emptyTotals() }), key, label: monthLabel(key) });
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return rows;
}

export async function getDashboardData(filters: DashboardFilters) {
  const [manifests, companies, drivers, vehicles, pendingJobs] = await Promise.all([
    getFilteredManifests(filters),
    prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.driver.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    prisma.vehicle.findMany({ orderBy: { plate: "asc" }, select: { plate: true } }),
    prisma.manifestJob.groupBy({
      by: ["status"],
      where: { status: { in: [ManifestJobStatus.REVIEW_REQUIRED, ManifestJobStatus.ERROR] } },
      _count: { _all: true },
    }),
  ]);

  const totals = emptyTotals();
  let quantityKg = 0;
  for (const manifest of manifests) {
    addTo(totals, manifest);
    const unit = manifest.cargo?.measurementUnit?.toUpperCase() ?? "";
    if (unit.startsWith("K")) quantityKg += num(manifest.cargo?.quantity);
  }

  const pending = Object.fromEntries(pendingJobs.map((row) => [row.status, row._count._all])) as Partial<
    Record<ManifestJobStatus, number>
  >;

  return {
    manifests,
    totals,
    quantityKg,
    pendingReview: pending.REVIEW_REQUIRED ?? 0,
    pendingErrors: pending.ERROR ?? 0,
    monthly: monthlySeries(manifests),
    byCompany: groupBy(manifests, (m) => ({ key: m.company.id.toString(), label: m.company.name, detail: `NIT ${m.company.nit}` })),
    byVehicle: groupBy(manifests, (m) => (m.vehicle ? { key: m.vehicle.plate, label: m.vehicle.plate } : null)),
    byDriver: groupBy(manifests, (m) => (m.driver ? { key: m.driver.id.toString(), label: m.driver.fullName } : null)),
    byRoute: groupBy(manifests, (m) => {
      const route = `${m.origin ?? "—"} → ${m.destination ?? "—"}`;
      return { key: route, label: route };
    }),
    options: {
      companies: companies.map((c) => ({ value: c.id.toString(), label: c.name })),
      drivers: drivers.map((d) => ({ value: d.id.toString(), label: d.fullName })),
      plates: vehicles.map((v) => ({ value: v.plate, label: v.plate })),
    },
  };
}
