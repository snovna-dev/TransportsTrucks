import { ManifestUploadForm } from "../../../components/manifests/ManifestUploadForm";

export default function ManifestUploadPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Cargar manifiesto</h1>
        <p className="mt-2 text-sm text-gray-600">
          Seleccione el PDF digital del manifiesto para iniciar su procesamiento.
        </p>
      </div>

      <ManifestUploadForm />
    </main>
  );
}
