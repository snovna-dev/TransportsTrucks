import Link from "next/link";
import { formatDate, formatMoney } from "../../lib/format";
import { ManifestStatus } from "./ManifestStatus";

export interface ManifestRow {
  id: bigint;
  manifestNumber: string;
  authorizationNumber: string | null;
  issueDate: Date;
  origin: string | null;
  destination: string | null;
  status: string;
  totalTripValue: { toString(): string } | null;
  vehicle: { plate: string } | null;
  driver: { fullName: string } | null;
}

export function ManifestTable({ rows }: { rows: ManifestRow[] }) {
  if (rows.length === 0) {
    return <p className="rounded-md border border-dashed p-6 text-center text-sm text-slate-500">No hay manifiestos registrados.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="min-w-full divide-y text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Manifiesto</th>
            <th className="px-3 py-2">Expedición</th>
            <th className="px-3 py-2">Ruta</th>
            <th className="px-3 py-2">Placa</th>
            <th className="px-3 py-2">Conductor</th>
            <th className="px-3 py-2 text-right">Valor viaje</th>
            <th className="px-3 py-2">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id.toString()} className="hover:bg-slate-50">
              <td className="px-3 py-2">
                <Link href={`/manifests/${row.id}`} className="font-medium text-blue-700 hover:underline">
                  {row.manifestNumber}
                </Link>
                <div className="text-xs text-slate-500">Aut. {row.authorizationNumber ?? "sin autorización"}</div>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.issueDate)}</td>
              <td className="px-3 py-2">
                {row.origin ?? "—"} → {row.destination ?? "—"}
              </td>
              <td className="px-3 py-2">{row.vehicle?.plate ?? "—"}</td>
              <td className="px-3 py-2">{row.driver?.fullName ?? "—"}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{formatMoney(row.totalTripValue)}</td>
              <td className="px-3 py-2">
                <ManifestStatus status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
