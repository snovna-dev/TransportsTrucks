import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "TransportsTrucks",
  description: "Gestión y procesamiento de manifiestos electrónicos de carga.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <header className="border-b bg-slate-900 text-white">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3 text-sm">
            <Link href="/manifests" className="font-semibold">
              TransportsTrucks
            </Link>
            <Link href="/manifests" className="text-slate-300 hover:text-white">
              Manifiestos
            </Link>
            <Link href="/manifests/review" className="text-slate-300 hover:text-white">
              Revisión
            </Link>
            <Link href="/manifests/upload" className="ml-auto rounded bg-blue-600 px-3 py-1.5 hover:bg-blue-500">
              Cargar PDF
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
