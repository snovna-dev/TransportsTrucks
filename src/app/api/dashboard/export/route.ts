import { getFilteredManifests, parseDashboardFilters } from "../../../../services/dashboard.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** GET /api/dashboard/export?desde=&hasta=&empresa=&placa=&conductor= → CSV (separador ; para Excel en español). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = parseDashboardFilters(Object.fromEntries(url.searchParams));
  const manifests = await getFilteredManifests(filters);

  const header = [
    "Manifiesto", "Autorización", "Fecha expedición", "Empresa", "NIT empresa", "Origen", "Destino",
    "Placa", "Conductor", "Producto", "Cantidad", "Unidad", "Valor total", "Retención fuente",
    "Retención ICA", "Neto a pagar", "Anticipo", "Saldo", "Estado",
  ];
  const rows = manifests.map((m) => [
    m.manifestNumber, m.authorizationNumber, m.issueDate, m.company.name, m.company.nit, m.origin, m.destination,
    m.vehicle?.plate, m.driver?.fullName, m.cargo?.transportedProduct, m.cargo?.quantity?.toString(), m.cargo?.measurementUnit,
    m.totalTripValue?.toString(), m.withholdingTax?.toString(), m.icaWithholding?.toString(), m.netValueToPay?.toString(),
    m.advanceValue?.toString(), m.balanceToPay?.toString(), m.status,
  ]);

  const csv = "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="manifiestos-${stamp}.csv"`,
    },
  });
}
