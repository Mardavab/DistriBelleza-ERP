'use client'

import React, { useEffect, useState } from 'react';
import { Building2, Zap, User, RefreshCcw, ShieldCheck, DollarSign, MinusCircle, Trash2, Plus, X } from 'lucide-react';
import { getMajorExpenses, addMajorExpense, deleteMajorExpense } from '../../app/actions/major_expenses';
import CustomSelect from '../UI/CustomSelect';

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  RENT: { label: 'Arriendo', icon: <Building2 size={16} />, color: '#ef4444', bg: '#fee2e2' },
  UTILITIES: { label: 'Servicios Públicos', icon: <Zap size={16} />, color: '#2563eb', bg: '#dbeafe' },
  PAYROLL: { label: 'Nómina', icon: <User size={16} />, color: '#9333ea', bg: '#f3e8ff' },
  MAINTENANCE: { label: 'Mantenimiento', icon: <RefreshCcw size={16} />, color: '#ea580c', bg: '#ffedd5' },
  INSURANCE: { label: 'Seguros', icon: <ShieldCheck size={16} />, color: '#059669', bg: '#d1fae5' },
  TAXES: { label: 'Impuestos', icon: <DollarSign size={16} />, color: '#d97706', bg: '#fef3c7' },
  OTHER: { label: 'Otros', icon: <MinusCircle size={16} />, color: '#64748b', bg: '#f1f5f9' },
};

export default function MajorExpensesView() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState('RENT');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

  const loadExpenses = async () => {
    setLoading(true);
    const res = await getMajorExpenses();
    if (res.success) setExpenses(res.data || []);
    setLoading(false);
  };

  useEffect(() => { loadExpenses(); }, []);

  const handleAdd = async () => {
    if (!description || !amount || saving) return;
    setSaving(true);
    const numericAmount = Number(amount.replace(/\D/g, ''));
    const res = await addMajorExpense(category, description, numericAmount, expenseDate, notes || null);
    if (res.success) {
      setDescription('');
      setAmount('');
      setNotes('');
      setShowForm(false);
      await loadExpenses();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const res = await deleteMajorExpense(id);
    if (res.success) await loadExpenses();
  };

  const filteredExpenses = filterCategory === 'ALL' 
    ? expenses 
    : expenses.filter(e => e.category === filterCategory);

  const totalByCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + Number(e.amount);
    return acc;
  }, {} as Record<string, number>);

  const totalAll = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div className="major-expenses-view">
      <style jsx>{`
        .major-expenses-view { padding: 0 24px 24px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
        .header h1 { font-size: 1.5rem; font-weight: 600; color: #0f172a; margin: 0; }
        .btn-add { display: flex; align-items: center; gap: 8px; padding: 10px 20px; background: #6366f1; color: white; border: none; border-radius: 10px; font-weight: 600; font-size: 0.9rem; cursor: pointer; transition: all 0.2s; }
        .btn-add:hover { background: #4f46e5; transform: translateY(-1px); }

        .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
        .stat-card { padding: 14px; border-radius: 12px; border: 1px solid #e2e8f0; background: white; }
        .stat-card .label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
        .stat-card .value { font-size: 1.1rem; font-weight: 800; }
        .stat-card.total { background: #f8fafc; border: 2px solid #e2e8f0; }
        .stat-card.total .value { color: #1e293b; font-size: 1.3rem; }

        .filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
        .filter-btn { padding: 6px 12px; border-radius: 8px; border: 1px solid #e2e8f0; background: white; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
        .filter-btn:hover { border-color: #6366f1; color: #6366f1; }
        .filter-btn.active { background: #6366f1; color: white; border-color: #6366f1; }

        .expenses-list { display: flex; flex-direction: column; gap: 8px; }
        .expense-card { display: flex; align-items: center; gap: 16px; padding: 16px; background: white; border-radius: 12px; border: 1px solid #e2e8f0; transition: all 0.15s; }
        .expense-card:hover { border-color: #c7d2fe; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
        .expense-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .expense-info { flex: 1; min-width: 0; }
        .expense-desc { font-size: 0.9rem; font-weight: 600; color: #1e293b; margin: 0; }
        .expense-meta { font-size: 0.75rem; color: #64748b; margin: 2px 0 0; }
        .expense-amount { font-size: 1.1rem; font-weight: 800; color: #ef4444; white-space: nowrap; }
        .expense-date { font-size: 0.75rem; color: #94a3b8; white-space: nowrap; }
        .btn-delete { padding: 6px; color: #94a3b8; background: none; border: none; cursor: pointer; border-radius: 6px; transition: all 0.15s; }
        .btn-delete:hover { color: #ef4444; background: #fee2e2; }

        .form-panel { background: white; border-radius: 16px; border: 1px solid #e2e8f0; padding: 24px; margin-bottom: 24px; }
        .form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .form-header h3 { margin: 0; font-size: 1.1rem; color: #1e293b; }
        .btn-close { padding: 6px; background: #f1f5f9; border: none; border-radius: 8px; cursor: pointer; color: #64748b; }
        .btn-close:hover { background: #e2e8f0; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group.full { grid-column: 1 / -1; }
        .form-group label { font-size: 0.75rem; font-weight: 700; color: #64748b; text-transform: uppercase; }
        .form-group input, .form-group select { padding: 10px 12px; border-radius: 10px; border: 1px solid #e2e8f0; outline: none; font-size: 0.9rem; background: white; }
        .form-group input:focus { border-color: #6366f1; }
        .input-with-currency { position: relative; display: flex; align-items: center; }
        .input-with-currency span { position: absolute; left: 12px; color: #94a3b8; font-weight: 700; }
        .input-with-currency input { width: 100%; padding-left: 28px !important; }
        .form-actions { display: flex; gap: 12px; margin-top: 20px; }
        .btn-save { flex: 1; padding: 12px; background: #10b981; color: white; border: none; border-radius: 10px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
        .btn-save:hover:not(:disabled) { background: #059669; }
        .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-cancel { padding: 12px 24px; background: #f1f5f9; color: #475569; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; }
        .btn-cancel:hover { background: #e2e8f0; }

        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px; color: #94a3b8; }
        .empty-state p { margin: 8px 0 0; }
      `}</style>

      <div className="header">
        <h1>Gastos Mayores</h1>
        <button className="btn-add" onClick={() => setShowForm(!showForm)}>
          {showForm ? <><X size={18} /> Cancelar</> : <><Plus size={18} /> Nuevo Gasto</>}
        </button>
      </div>

      {showForm && (
        <div className="form-panel">
          <div className="form-header">
            <h3>Registrar Gasto Mayor</h3>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>Categoría</label>
              <CustomSelect
                value={category}
                onChange={(val: any) => setCategory(val)}
                options={Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => ({
                  value: key,
                  label: cfg.label,
                  icon: cfg.icon
                }))}
              />
            </div>
            <div className="form-group">
              <label>Fecha</label>
              <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
            <div className="form-group full">
              <label>Descripción</label>
              <input
                type="text"
                placeholder="Ej: Arriendo local comercial, Servicio de energía..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Valor (COP)</label>
              <div className="input-with-currency">
                <span>$</span>
                <input
                  type="text"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, '');
                    setAmount(raw ? parseInt(raw).toLocaleString('es-CO') : '');
                  }}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Notas (opcional)</label>
              <input
                type="text"
                placeholder="Referencia adicional..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn-cancel" onClick={() => setShowForm(false)}>Cancelar</button>
            <button
              className="btn-save"
              disabled={!description || !amount || saving}
              onClick={handleAdd}
            >
              {saving ? 'Guardando...' : 'GUARDAR GASTO'}
            </button>
          </div>
        </div>
      )}

      <div className="stats-grid">
        {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
          totalByCategory[key] ? (
            <div key={key} className="stat-card">
              <div className="label">{cfg.label}</div>
              <div className="value" style={{ color: cfg.color }}>${totalByCategory[key].toLocaleString()}</div>
            </div>
          ) : null
        ))}
        <div className="stat-card total">
          <div className="label">Total General</div>
          <div className="value">${totalAll.toLocaleString()}</div>
        </div>
      </div>

      <div className="filter-bar">
        <button className={`filter-btn ${filterCategory === 'ALL' ? 'active' : ''}`} onClick={() => setFilterCategory('ALL')}>Todos</button>
        {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
          totalByCategory[key] ? (
            <button key={key} className={`filter-btn ${filterCategory === key ? 'active' : ''}`} onClick={() => setFilterCategory(key)}>
              {cfg.label}
            </button>
          ) : null
        ))}
      </div>

      <div className="expenses-list">
        {loading ? (
          <div className="empty-state"><p>Cargando...</p></div>
        ) : filteredExpenses.length === 0 ? (
          <div className="empty-state">
            <Building2 size={48} />
            <p>No hay gastos mayores registrados</p>
          </div>
        ) : (
          filteredExpenses.map((expense) => {
            const cfg = CATEGORY_CONFIG[expense.category] || CATEGORY_CONFIG.OTHER;
            return (
              <div key={expense.id} className="expense-card">
                <div className="expense-icon" style={{ background: cfg.bg, color: cfg.color }}>
                  {cfg.icon}
                </div>
                <div className="expense-info">
                  <p className="expense-desc">{expense.description}</p>
                  <p className="expense-meta">{cfg.label}{expense.notes ? ` · ${expense.notes}` : ''}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="expense-amount">${Number(expense.amount).toLocaleString()}</div>
                  <div className="expense-date">{new Date(expense.expense_date).toLocaleDateString('es-CO')}</div>
                </div>
                <button className="btn-delete" onClick={() => handleDelete(expense.id)} title="Eliminar">
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
