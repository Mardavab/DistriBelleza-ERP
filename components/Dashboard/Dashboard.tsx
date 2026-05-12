'use client'

import React, { useEffect, useState } from 'react';
import { TrendingUp, CreditCard, Wallet, Target, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { getDashboardStats } from '../../app/actions/reports';
import './Dashboard.css';

const SkeletonCard = () => (
  <div className="kpi-card skeleton-card">
    <div className="kpi-icon skeleton-box h-12 w-12" style={{ borderRadius: '12px' }}></div>
    <div className="kpi-info" style={{ flex: 1 }}>
      <div className="skeleton-box h-4 w-24 mb-2"></div>
      <div className="skeleton-box h-8 w-32"></div>
    </div>
  </div>
);

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await getDashboardStats();
        setStats(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return (
    <div className="dashboard-content">
      <div className="kpi-grid">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="goal-section skeleton-effect" style={{ height: '200px', border: 'none' }}>
        <div className="skeleton-box h-6 w-48 mb-6"></div>
        <div className="skeleton-box h-12 w-full mb-6" style={{ borderRadius: '8px' }}></div>
        <div className="skeleton-box h-4 w-64"></div>
      </div>
    </div>
  );

  if (!stats) return <div className="p-8">No hay datos disponibles para hoy. Abra caja para comenzar.</div>;

  return (
    <div className="dashboard-content">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon sales"><TrendingUp size={24} /></div>
          <div className="kpi-info">
            <p>Ventas Totales (Hoy)</p>
            <h3>${stats.totalSales.toLocaleString()}</h3>
          </div>
          <div className="kpi-trend up"><ArrowUpRight size={16} /> 12%</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon expenses"><CreditCard size={24} /></div>
          <div className="kpi-info">
            <p>Egresos (Hoy)</p>
            <h3>${stats.totalExpenses.toLocaleString()}</h3>
          </div>
          <div className="kpi-trend down"><ArrowDownRight size={16} /> 5%</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon cash"><Wallet size={24} /></div>
          <div className="kpi-info">
            <p>Efectivo Neto en Caja</p>
            <h3>${stats.netCash.toLocaleString()}</h3>
          </div>
        </div>
      </div>

      <div className="goal-section">
        <div className="goal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Target size={24} color="#6366f1" />
            <h2>Meta de Ventas Diaria</h2>
          </div>
          <span className="goal-amount">${stats.totalSales.toLocaleString()} / ${stats.goal.toLocaleString()}</span>
        </div>
        <div className="progress-container">
          <div className="progress-bar" style={{ width: `${Math.min(stats.progress, 100)}%` }}></div>
        </div>
        <p className="goal-desc">
          {stats.progress >= 100 
            ? '¡Meta cumplida! Comisión del 1.2% aplicada.' 
            : `Faltan $${(stats.goal - stats.totalSales).toLocaleString()} para alcanzar la meta y ganar comisión.`}
        </p>
      </div>
    </div>
  );
}
