import { ManifestUploadForm } from "../../../components/manifests/ManifestUploadForm";

export default function ManifestUploadPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Cargar documento</h1>
        <p className="mt-2 text-sm text-gray-600">
          Seleccione el PDF digital del manifiesto, la remesa o la orden de cargue. El sistema reconoce el tipo de
          documento y vincula la remesa y la orden de cargue con su manifiesto.
        </p>
      </div>

      <ManifestUploadForm />
    </main>
  );
}
