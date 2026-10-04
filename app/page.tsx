'use client'

import React, { useState, useEffect } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { getUserProfile } from './actions/auth';
import { getCurrentCompanyAction } from './actions/company';
import Sidebar, { BUSINESS_TABS } from '../components/Dashboard/Sidebar';
import Dashboard from '../components/Dashboard/Dashboard';
import POS from '../components/POS/POS';
import InventoryView from '../components/Inventory/InventoryView';
import ReportsView from '../components/Reports/ReportsView';
import UserManagement from '../components/UI/UserManagement';
import CompaniesPanel from '../components/Platform/CompaniesPanel';
import PlatformDashboard from '../components/Platform/PlatformDashboard';
import SystemHealth from '../components/Platform/SystemHealth';
import SuppliersView from '../components/Suppliers/SuppliersView';
import MajorExpensesView from '../components/MajorExpenses/MajorExpensesView';
import '../components/Dashboard/Dashboard.css';

export default function Home() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [profile, setProfile] = useState<any>(null);
  const [companyName, setCompanyName] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const role = profile?.role || null;
  const isPlatformAdmin = role === 'technician';

  useEffect(() => {
    async function load() {
      try {
        const p = await getUserProfile();
        if (!p) {
          window.location.href = '/login';
          return;
        }
        setProfile(p);

        // Una cuenta de plataforma no tiene empresa: se salta la consulta.
        if (p.role === 'technician') {
          setActiveTab('platform');
          return;
        }

        const company = await getCurrentCompanyAction();
        if (company) {
          setCompanyName(company.trade_name || company.legal_name);
        }
      } catch (err) {
        console.error("Auth error:", err);
        window.location.href = '/login';
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Defensa en profundidad: si el rol cambia o se manipula el estado,
  // se cae al tab por defecto del rol en vez de renderizar datos de empresa.
  useEffect(() => {
    if (!role) return;
    if (isPlatformAdmin && BUSINESS_TABS.includes(activeTab)) {
      setActiveTab('platform');
      return;
    }
    if (!isPlatformAdmin && ['platform', 'health'].includes(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [role, activeTab, isPlatformAdmin]);

  if (loading) return (
    <div className="dashboard-layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ color: 'var(--color-primary)' }}>Iniciando sistema...</h2>
        <p style={{ color: 'var(--color-text-mute)', fontSize: 'var(--font-base)' }}>Verificando credenciales</p>
      </div>
    </div>
  );

  const renderContent = () => {
    // Consola de plataforma: sin acceso a módulos de negocio.
    if (isPlatformAdmin) {
      switch (activeTab) {
        case 'companies':
          return <CompaniesPanel />;
        case 'health':
          return <SystemHealth />;
        case 'platform':
        default:
          return <PlatformDashboard />;
      }
    }

    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'pos':
        return <POS />;
      case 'inventory':
        return <InventoryView />;
      case 'suppliers':
        return <SuppliersView />;
      case 'reports':
        return <ReportsView userProfile={profile} />;
      case 'major-expenses':
        return <MajorExpensesView />;
      case 'config':
        return (profile?.role === 'owner')
          ? <UserManagement currentUserRole={profile?.role} />
          : <div className="p-8 text-slate-500">No tienes permiso para acceder a esta sección.</div>;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="dashboard-layout">
      <Sidebar
        userProfile={profile}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        companyName={companyName}
      />
      <main className={`main-content${activeTab === 'pos' ? ' pos-active' : ''}`}>
        {!isPlatformAdmin && activeTab === 'dashboard' ? (
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
        ) : null}

        {renderContent()}
      </main>
    </div>
  );
}
