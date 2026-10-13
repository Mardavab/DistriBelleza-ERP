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
  Store,
} from 'lucide-react';
import { signOut } from '../../app/actions/auth';
import CompanySelector from './CompanySelector';
import BranchSelector from './BranchSelector';
import type { CompanyMembership } from '../../lib/supabase/memberships';
import type { BranchMembership } from '../../lib/supabase/branches';
import './Dashboard.css';

/** Forma mínima del perfil que consume el sidebar. Deliberadamente
 *  parcial: el sidebar solo necesita rol, nombre, empresa y membresías. */
export interface SidebarProfile {
  role?: 'owner' | 'manager' | 'technician' | string;
  full_name?: string | null;
  companies?: { trade_name?: string | null; legal_name?: string | null } | null;
  memberships?: CompanyMembership[];
  company_id?: string | null;
  is_platform_admin?: boolean;
  /** FASE 11 (Bloque C): membresías de sucursal. */
  branch_memberships?: BranchMembership[];
  active_branch_id?: string | null;
  branch_role?: string | null;
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
export const BUSINESS_TABS = ['dashboard', 'pos', 'inventory', 'suppliers', 'major-expenses', 'reports', 'branches', 'config'];

export default function Sidebar({ userProfile, activeTab, setActiveTab, companyName }: SidebarProps) {
  const role = userProfile?.role || 'manager';
  const isPlatformAdmin = userProfile?.is_platform_admin === true;

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
    { id: 'branches', name: 'Sucursales', icon: <Store size={20} />, ownerOnly: true },
    { id: 'config', name: 'Configuración', icon: <Settings size={20} />, ownerOnly: true },
  ];

  const menuItems = (isPlatformAdmin ? platformMenu : companyMenu)
    .filter(item => !item.ownerOnly || role === 'owner');

  const roleLabel = isPlatformAdmin ? 'Administrador de plataforma' : role;

  // FASE 10.3: selector de empresa para usuarios con varias membresías.
  const memberships = userProfile?.memberships ?? [];
  const showCompanySelector = !isPlatformAdmin
    && memberships.length > 1
    && !!userProfile?.company_id;

  // FASE 11.4 (Bloque C): selector de sucursal. Se muestra si el usuario
  // tiene al menos una branch_membership (no lo mostramos si memberships=[]:
  // el owner debe usar BranchManagement para asignar primero).
  const branchMemberships = userProfile?.branch_memberships ?? [];
  const showBranchSelector = !isPlatformAdmin && branchMemberships.length > 0;

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

      {showCompanySelector && (
        <CompanySelector
          memberships={memberships}
          activeCompanyId={userProfile!.company_id!}
          currentRole={role}
        />
      )}

      {showBranchSelector && (
        <BranchSelector
          memberships={branchMemberships}
          activeBranchId={userProfile?.active_branch_id ?? null}
          currentRole={userProfile?.branch_role ?? role}
        />
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
