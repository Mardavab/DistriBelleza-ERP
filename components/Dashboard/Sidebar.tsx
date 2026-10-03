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
  Globe
} from 'lucide-react';
import { signOut } from '../../app/actions/auth';
import './Dashboard.css';

interface SidebarProps {
  userProfile: any;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  companyName?: string;
}

export default function Sidebar({ userProfile, activeTab, setActiveTab, companyName }: SidebarProps) {
  const role = userProfile?.role || 'manager';
  const displayName = companyName || userProfile?.companies?.trade_name || userProfile?.companies?.legal_name || 'ERP';

  const menuItems = [
    { id: 'dashboard', name: 'Panel de Control', icon: <LayoutDashboard size={20} />, roles: ['owner', 'technician', 'manager'] },
    { id: 'pos', name: 'Punto de Venta', icon: <ShoppingCart size={20} />, roles: ['owner', 'technician', 'manager'] },
    { id: 'inventory', name: 'Inventario', icon: <Package size={20} />, roles: ['owner', 'technician', 'manager'] },
    { id: 'suppliers', name: 'Proveedores', icon: <Truck size={20} />, roles: ['owner', 'technician', 'manager'] },
    { id: 'major-expenses', name: 'Gastos Mayores', icon: <Building2 size={20} />, roles: ['owner'] },
    { id: 'reports', name: 'Reportes', icon: <BarChart3 size={20} />, roles: ['owner', 'technician', 'manager'] },
    { id: 'config', name: 'Configuración', icon: <Settings size={20} />, roles: ['owner'] },
    { id: 'companies', name: 'Empresas', icon: <Globe size={20} />, roles: ['technician'] },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <img src="/logo.svg" alt={`${displayName} Icon`} style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
        <h2 style={{ margin: 0 }}>{displayName}</h2>
      </div>

      <nav className="nav-links">
        {menuItems.map((item) => (
          item.roles.includes(role) && (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`nav-link-btn ${activeTab === item.id ? 'active' : ''}`}
            >
              {item.icon}
              <span>{item.name}</span>
            </button>
          )
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="user-info">
          <div style={{ background: '#334155', padding: '8px', borderRadius: '50%' }}>
            <User size={20} color="#94a3b8" />
          </div>
          <div style={{ overflow: 'hidden' }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {userProfile?.full_name}
            </p>
            <span className="user-role-badge">{role}</span>
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
