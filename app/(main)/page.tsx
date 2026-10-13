'use client'

import { LayoutDashboard } from 'lucide-react';
import Dashboard from '../../components/Dashboard/Dashboard';
import { useAppProfile } from '../../components/Dashboard/AppShell';

export default function DashboardPage() {
    const profile = useAppProfile();

    return (
        <>
            <header className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
                <div className="page-header-group">
                    <div className="page-title-icon">
                        <LayoutDashboard size={28} />
                    </div>
                    <div className="page-title-block">
                        <h1 style={{ textTransform: 'capitalize' }}>Dashboard</h1>
                        <p>Bienvenido de nuevo, {profile?.full_name}</p>
                    </div>
                </div>
                <div className="page-date-chip">
                    {new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
            </header>
            <Dashboard />
        </>
    );
}
