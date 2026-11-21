import Link from "next/link";
import { notFound } from "next/navigation";
import { parseId } from "../../../lib/api";
import { prisma } from "../../../lib/prisma";
import { getFieldLabel } from "../../../lib/manifest-fields";
import { formatDate, formatDateTime, formatJson, formatMoney, formatNumber, formatPercent } from "../../../lib/format";
import { ManifestStatus } from "../../../components/manifests/ManifestStatus";
import { SupportingDocumentList } from "../../../components/manifests/SupportingDocumentList";

export const dynamic = "force-dynamic";

type Row = [label: string, value: React.ReactNode];

function Card({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="rounded-md border">
      <h2 className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold">{title}</h2>
      <dl className="grid grid-cols-[minmax(140px,40%)_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd>{value === null || value === undefined || value === "" ? "—" : value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function ManifestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) notFound();

  const manifest = await prisma.manifest.findUnique({
    where: { id },
    include: {
      company: true,
      driver: true,
      vehicle: true,
      vehicleHolder: true,
      manifestHolder: true,
      cargoOwner: true,
      sender: true,
      recipient: true,
      cargo: true,
      processing: { select: { reviewStatus: true, overallConfidence: true, attempts: true, completedAt: true } },
      jobs: {
        orderBy: { createdAt: "desc" },
        select: { id: true, originalFileName: true, status: true, createdAt: true, reviewedAt: true },
      },
      corrections: { orderBy: { createdAt: "asc" } },
      supportingDocuments: {
        orderBy: [{ documentType: "asc" }, { issueDate: "asc" }],
        select: {
          id: true,
          jobId: true,
          documentType: true,
          documentNumber: true,
          manifestNumber: true,
          manifestId: true,
          linkMethod: true,
          issueDate: true,
          origin: true,
          destination: true,
          vehiclePlate: true,
          job: { select: { originalFileName: true } },
        },
      },
    },
  });
  if (!manifest) notFound();

  const latestJob = manifest.jobs[0];
  const m = manifest;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/manifests" className="text-sm text-blue-700 hover:underline">
          ← Manifiestos
        </Link>
        <h1 className="text-2xl font-semibold">Manifiesto {m.manifestNumber}</h1>
        <ManifestStatus status={m.status} />
        {latestJob && (
          <a
            href={`/api/manifest-jobs/${latestJob.id}/pdf`}
            target="_blank"
            className="ml-auto rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Ver PDF original
          </a>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title="Manifiesto"
          rows={[
            ["Número", m.manifestNumber],
            ["Autorización", m.authorizationNumber ?? "Sin autorización"],
            ["Fecha de expedición", formatDate(m.issueDate)],
            ["Tipo", m.manifestType],
            ["Origen", m.origin],
            ["Ciudad intermedia", m.intermediateCity],
            ["Destino", m.destination],
            ["Tomador de la póliza", m.policyOwnerName],
          ]}
        />
        <Card
          title="Valores y pago"
          rows={[
            ["Valor total del viaje", formatMoney(m.totalTripValue)],
            ["Retención en la fuente", formatMoney(m.withholdingTax)],
            ["Retención ICA", formatMoney(m.icaWithholding)],
            ["Valor neto a pagar", formatMoney(m.netValueToPay)],
            ["Anticipo", formatMoney(m.advanceValue)],
            ["Saldo a pagar", formatMoney(m.balanceToPay)],
            ["Lugar de pago", m.paymentLocation],
            ["Fecha de pago", m.paymentDate ? formatDate(m.paymentDate) : null],
            ["Cargue pagado por", m.loadingPaidBy],
            ["Descargue pagado por", m.unloadingPaidBy],
          ]}
        />
        <Card
          title="Empresa"
          rows={[
            ["NIT", m.company.nit],
            ["Razón social", m.company.name],
            ["Dirección", m.company.address],
            ["Teléfono", m.company.phone],
            ["Ciudad", m.company.city],
          ]}
        />
        <Card
          title="Conductor"
          rows={[
            ["Identificación", m.driver?.identificationNumber],
            ["Nombre", m.driver?.fullName],
            ["Licencia", m.driver?.licenseCategory],
            ["Teléfono", m.driver?.phone],
            ["Ciudad", m.driver?.city],
          ]}
        />
        <Card
          title="Vehículo"
          rows={[
            ["Placa", m.vehicle?.plate],
            ["Marca", m.vehicle?.brand],
            ["Semirremolque", m.vehicle?.semiTrailerPlate],
            ["Configuración", m.vehicle?.configuration],
            ["Peso vacío", m.vehicle?.emptyWeight ? formatNumber(m.vehicle.emptyWeight) : null],
            ["Póliza SOAT", m.vehicle?.soatPolicyNumber],
            ["Aseguradora SOAT", m.vehicle?.soatInsuranceCompany],
            ["Vencimiento SOAT", m.vehicle?.soatExpirationDate ? formatDate(m.vehicle.soatExpirationDate) : null],
          ]}
        />
        <Card
          title="Titulares"
          rows={[
            ["Titular del manifiesto", m.manifestHolder ? `${m.manifestHolder.fullName} (${m.manifestHolder.identificationNumber})` : null],
            ["Tenedor del vehículo", m.vehicleHolder ? `${m.vehicleHolder.fullName} (${m.vehicleHolder.identificationNumber})` : null],
            ["Remitente", m.sender ? `${m.sender.name}${m.sender.identificationNumber ? ` (${m.sender.identificationNumber})` : ""}` : null],
            ["Destinatario", m.recipient ? `${m.recipient.name}${m.recipient.identificationNumber ? ` (${m.recipient.identificationNumber})` : ""}` : null],
            ["Propietario de la carga", m.cargoOwner ? `${m.cargoOwner.name}${m.cargoOwner.identificationNumber ? ` (${m.cargoOwner.identificationNumber})` : ""}` : null],
          ]}
        />
        <Card
          title="Carga"
          rows={[
            ["Remesa", m.cargo?.remittanceNumber],
            ["Producto", m.cargo?.transportedProduct],
            ["Código de producto", m.cargo?.productCode],
            ["Cantidad", m.cargo?.quantity ? `${formatNumber(m.cargo.quantity)} ${m.cargo.measurementUnit ?? ""}` : null],
            ["Naturaleza", m.cargo?.nature],
            ["Empaque", m.cargo?.packaging],
          ]}
        />
        <Card
          title="Procesamiento"
          rows={[
            ["Revisión", m.processing?.reviewStatus],
            ["Confianza", formatPercent(m.processing?.overallConfidence)],
            ["Procesado", formatDateTime(m.processing?.completedAt)],
            ["Archivo", m.pdfFileName],
            ["Recomendaciones", m.recommendations],
          ]}
        />
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Documentos soporte (remesa y orden de cargue)</h2>
          <Link href="/manifests/upload" className="text-sm text-blue-700 hover:underline">
            Cargar documento
          </Link>
        </div>
        <SupportingDocumentList
          rows={m.supportingDocuments}
          emptyText="Este manifiesto no tiene remesa ni orden de cargue cargadas."
        />
      </section>

      {m.corrections.length > 0 && (
        <section className="rounded-md border">
          <h2 className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold">Correcciones manuales</h2>
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Campo</th>
                <th className="px-4 py-2">Original</th>
                <th className="px-4 py-2">Corregido</th>
                <th className="px-4 py-2">Confianza original</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {m.corrections.map((correction) => (
                <tr key={correction.id.toString()}>
                  <td className="px-4 py-1.5 whitespace-nowrap">{formatDateTime(correction.createdAt)}</td>
                  <td className="px-4 py-1.5">{getFieldLabel(correction.fieldPath)}</td>
                  <td className="px-4 py-1.5 text-slate-500">{formatJson(correction.originalValue)}</td>
                  <td className="px-4 py-1.5 font-medium">{formatJson(correction.correctedValue)}</td>
                  <td className="px-4 py-1.5">{formatPercent(correction.originalConfidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {m.jobs.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Cargues de este manifiesto</h2>
          <ul className="space-y-1 text-sm">
            {m.jobs.map((job) => (
              <li key={job.id.toString()} className="flex items-center gap-2">
                <ManifestStatus status={job.status} />
                <a href={`/api/manifest-jobs/${job.id}/pdf`} target="_blank" className="text-blue-700 hover:underline">
                  {job.originalFileName}
                </a>
                <span className="text-slate-500">
                  {formatDateTime(job.createdAt)}
                  {job.reviewedAt ? ` · revisado ${formatDateTime(job.reviewedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
