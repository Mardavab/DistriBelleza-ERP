'use client'

import React from 'react';
import { ShoppingCart, MinusCircle } from 'lucide-react';
import { POSMode } from './types';

/**
 * Tabs del sidebar del POS (Ventas / Gastos).
 *
 * Subcomponente del POS. Solo renderiza los tabs y el badge del carrito.
 * El contenido de cada tab se renderiza fuera de este componente.
 */
interface PosSidebarTabsProps {
    activeTab: POSMode;
    cartCount: number;
    onTabChange: (tab: POSMode) => void;
    tabs: { id: POSMode; label: string; icon: React.ReactNode }[];
}

export default function PosSidebarTabs({ activeTab, cartCount, onTabChange, tabs }: PosSidebarTabsProps) {
    return (
        <div className={`sidebar-tabs ${tabs.length === 3 ? 'three-tabs' : ''}`}>
            {tabs.map(tab => (
                <button
                    key={tab.id}
                    className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => onTabChange(tab.id)}
                >
                    {tab.icon}
                    {tab.label}
                    {tab.id === 'cart' && cartCount > 0 && (
                        <span className="tab-badge">{cartCount}</span>
                    )}
                </button>
            ))}
        </div>
    );
}