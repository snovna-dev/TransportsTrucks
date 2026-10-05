import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TransportsTrucks",
  description:
    "Gestión y procesamiento de manifiestos electrónicos de carga.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}