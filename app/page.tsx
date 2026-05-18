'use client'

import React, { useState, useEffect } from 'react';
import { getUserProfile } from './actions/auth';
import Sidebar from '../components/Dashboard/Sidebar';
import Dashboard from '../components/Dashboard/Dashboard';
import POS from '../components/POS/POS';
import InventoryView from '../components/Inventory/InventoryView';
import ReportsView from '../components/Reports/ReportsView';
import UserManagement from '../components/UI/UserManagement';
import SuppliersView from '../components/Suppliers/SuppliersView';
import '../components/Dashboard/Dashboard.css';

export default function Home() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const p = await getUserProfile();
        if (!p) {
          window.location.href = '/login';
          return;
        }
        setProfile(p);
      } catch (err) {
        console.error("Auth error:", err);
        window.location.href = '/login';
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return (
    <div className="dashboard-layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ color: '#6366f1' }}>Iniciando sistema...</h2>
        <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Verificando credenciales</p>
      </div>
    </div>
  );

  const renderContent = () => {
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
      case 'config':
        return (profile?.role === 'technician') 
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
      />
      <main className={`main-content${activeTab === 'pos' ? ' pos-active' : ''}`}>
        {activeTab === 'dashboard' ? (
          <header style={{
            marginBottom: '32px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#0f172a', textTransform: 'capitalize' }}>
                Dashboard
              </h1>
              <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Bienvenido de nuevo, {profile?.full_name}</p>
            </div>
            <div style={{ background: 'white', padding: '8px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.875rem', color: '#64748b', fontWeight: 500 }}>
              {new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </header>
        ) : (
          activeTab !== 'pos' && <div style={{ paddingTop: '20px' }}></div>
        )}

        {renderContent()}
      </main>
    </div>
  );
}
