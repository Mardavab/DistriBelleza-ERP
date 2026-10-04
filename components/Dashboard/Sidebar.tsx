'use client'

import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  Settings,
  LogOut,
  User,
  Truck,
  Building2,
  Globe,
  Activity,
  HeartPulse,
  ShieldCheck,
} from 'lucide-react';
import { signOut } from '../../app/actions/auth';
import './Dashboard.css';

/** Forma mínima del perfil que consume el sidebar. Deliberadamente
 *  parcial: el sidebar solo necesita rol, nombre y empresa. */
export interface SidebarProfile {
  role?: 'owner' | 'manager' | 'technician' | string;
  full_name?: string | null;
  companies?: { trade_name?: string | null; legal_name?: string | null } | null;
}

interface SidebarProps {
  userProfile?: SidebarProfile | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  companyName?: string;
}

interface MenuItem {
  id: string;
  name: string;
  icon: React.ReactNode;
  /** Solo visible para el owner de la empresa. */
  ownerOnly?: boolean;
}

/**
 * Tabs de negocio: no tienen sentido para una cuenta de plataforma, cuyo
 * alcance es la consola de plataforma y no los datos de un tenant.
 * `app/page.tsx` lo usa para impedir que un técnico renderice un módulo de
 * empresa aunque manipule el estado del tab.
 */
export const BUSINESS_TABS = ['dashboard', 'pos', 'inventory', 'suppliers', 'major-expenses', 'reports', 'config'];

export default function Sidebar({ userProfile, activeTab, setActiveTab, companyName }: SidebarProps) {
  const role = userProfile?.role || 'manager';
  const isPlatformAdmin = role === 'technician';

  // Las cuentas de plataforma no tienen empresa: muestran el nombre de la plataforma.
  const displayName = isPlatformAdmin
    ? 'DistriBelleza'
    : (companyName || userProfile?.companies?.trade_name || userProfile?.companies?.legal_name || 'ERP');

  // Consola de plataforma: salud del sistema y gestión de tenants.
  // No incluye POS, Inventario, Proveedores ni Reportes porque son datos
  // privados de cada empresa.
  const platformMenu: MenuItem[] = [
    { id: 'platform', name: 'Consola de Plataforma', icon: <Activity size={20} /> },
    { id: 'health', name: 'Salud del Sistema', icon: <HeartPulse size={20} /> },
    { id: 'companies', name: 'Empresas', icon: <Globe size={20} /> },
  ];

  const companyMenu: MenuItem[] = [
    { id: 'dashboard', name: 'Panel de Control', icon: <LayoutDashboard size={20} /> },
    { id: 'pos', name: 'Punto de Venta', icon: <ShoppingCart size={20} /> },
    { id: 'inventory', name: 'Inventario', icon: <Package size={20} /> },
    { id: 'suppliers', name: 'Proveedores', icon: <Truck size={20} /> },
    { id: 'major-expenses', name: 'Gastos Mayores', icon: <Building2 size={20} />, ownerOnly: true },
    { id: 'reports', name: 'Reportes', icon: <BarChart3 size={20} /> },
    { id: 'config', name: 'Configuración', icon: <Settings size={20} />, ownerOnly: true },
  ];

  const menuItems = (isPlatformAdmin ? platformMenu : companyMenu)
    .filter(item => !item.ownerOnly || role === 'owner');

  const roleLabel = isPlatformAdmin ? 'Administrador de plataforma' : role;

  return (
    <aside className="sidebar">
      <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <img src="/logo.svg" alt={`${displayName} Icon`} style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
        <h2 style={{ margin: 0 }}>{displayName}</h2>
      </div>

      {isPlatformAdmin && (
        <div className="sidebar-platform-badge">
          <ShieldCheck size={14} />
          <span>Consola de plataforma</span>
        </div>
      )}

      <nav className="nav-links">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`nav-link-btn ${activeTab === item.id ? 'active' : ''}`}
          >
            {item.icon}
            <span>{item.name}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="user-info">
          <div style={{ background: 'var(--color-text-soft)', padding: '8px', borderRadius: '50%' }}>
            <User size={20} color="var(--color-text-light)" />
          </div>
          <div style={{ overflow: 'hidden' }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {userProfile?.full_name}
            </p>
            <span className="user-role-badge">{roleLabel}</span>
          </div>
        </div>
        <button className="btn-logout" onClick={() => signOut()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <LogOut size={16} />
            <span>Cerrar Sesión</span>
          </div>
        </button>
      </div>
    </aside>
  );
}

