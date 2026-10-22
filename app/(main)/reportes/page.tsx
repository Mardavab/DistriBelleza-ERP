'use client'

import ReportsView from '../../../components/Reports/ReportsView';
import { useAppProfile } from '../../../components/Dashboard/AppShell';

export default function ReportesPage() {
    const profile = useAppProfile();

    // El middleware.ts ya redirige a un manager fuera de /reportes; este
    // chequeo es la doble defensa por si el middleware se desconfigura.
    // El manager ve su reporte de sucursal desde el Panel de Control
    // (getDashboardStats → getFinancialReport('current')), no desde aquí.
    if (profile && profile.role !== 'owner') {
        return (
            <div className="p-8 text-slate-500">
                No tienes permiso para acceder a esta sección.
            </div>
        );
    }
    return <ReportsView userProfile={profile} />;
}
