import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Distri Belleza - ERP",
  description: "Sistema de gestión de inventario y punto de venta",
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
