import type { Metadata } from "next";
import { getCurrentCompanySafe } from "../lib/company";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
    const company = await getCurrentCompanySafe();
    const name = company?.trade_name || company?.legal_name || "ERP";
    return {
        title: `${name} - Sistema`,
        description: `Sistema de gestión de inventario y punto de venta - ${name}`,
    };
}

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