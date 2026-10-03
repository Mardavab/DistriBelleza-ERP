'use client'

import React, { useEffect, useState } from 'react';
import { Building2, Trash2, Plus } from 'lucide-react';
import { getMajorExpenses, deleteMajorExpense } from '../../app/actions/major_expenses';
import { formatCurrency } from '../../lib/format';
import MajorExpenseFormModal from './MajorExpenseFormModal';
import { CATEGORY_CONFIG, CATEGORY_ENTRIES, getCategory, type MajorExpenseCategory } from './categories';
import './MajorExpenses.css';

export default function MajorExpensesView() {
    const [expenses, setExpenses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [filterCategory, setFilterCategory] = useState<string>('ALL');

    const loadExpenses = async () => {
        setLoading(true);
        const res = await getMajorExpenses();
        if (res.success) setExpenses(res.data || []);
        setLoading(false);
    };

    useEffect(() => { loadExpenses(); }, []);

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
        <div className="page-container">
            <header className="page-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                    <div className="page-title-icon">
                        <Building2 size={28} color="var(--color-primary)" />
                    </div>
                    <div className="page-title-block">
                        <h1>Gastos Mayores</h1>
                        <p>Arriendos, nómina, servicios públicos y otros gastos operativos</p>
                    </div>
                </div>
                <button className="btn-primary-page" onClick={() => setShowForm(true)}>
                    <Plus size={18} /> Nuevo Gasto
                </button>
            </header>

            {showForm && (
                <MajorExpenseFormModal
                    onClose={() => setShowForm(false)}
                    onSaved={loadExpenses}
                />
            )}

            <div className="me-stats-grid">
                {CATEGORY_ENTRIES.map(([key, cfg]) => (
                    totalByCategory[key] ? (
                        <div key={key} className="ui-card me-stat-card">
                            <div className="me-stat-label">{cfg.label}</div>
                            <div className="me-stat-value" style={{ color: cfg.color }}>
                                {formatCurrency(totalByCategory[key])}
                            </div>
                        </div>
                    ) : null
                ))}
                <div className="ui-card me-stat-card me-stat-total">
                    <div className="me-stat-label">Total General</div>
                    <div className="me-stat-value">{formatCurrency(totalAll)}</div>
                </div>
            </div>

            <div className="me-filter-bar">
                <button
                    className={`me-filter-btn ${filterCategory === 'ALL' ? 'active' : ''}`}
                    onClick={() => setFilterCategory('ALL')}
                >
                    Todos
                </button>
                {CATEGORY_ENTRIES.map(([key, cfg]) => (
                    totalByCategory[key] ? (
                        <button
                            key={key}
                            className={`me-filter-btn ${filterCategory === key ? 'active' : ''}`}
                            onClick={() => setFilterCategory(key)}
                        >
                            {cfg.label}
                        </button>
                    ) : null
                ))}
            </div>

            <div className="me-list">
                {loading ? (
                    <div className="ui-empty-state"><p>Cargando...</p></div>
                ) : filteredExpenses.length === 0 ? (
                    <div className="ui-empty-state">
                        <Building2 size={48} color="var(--color-text-faint)" />
                        <p>No hay gastos mayores registrados</p>
                    </div>
                ) : (
                    filteredExpenses.map((expense) => {
                        const cfg = getCategory(expense.category);
                        return (
                            <div key={expense.id} className="ui-card me-row">
                                <div className="me-row-icon" style={{ background: cfg.bg, color: cfg.color }}>
                                    {cfg.icon}
                                </div>
                                <div className="me-row-info">
                                    <p className="me-row-desc">{expense.description}</p>
                                    <p className="me-row-meta">
                                        {cfg.label}{expense.notes ? ` · ${expense.notes}` : ''}
                                    </p>
                                </div>
                                <div className="me-row-right">
                                    <div className="me-row-amount">{formatCurrency(expense.amount)}</div>
                                    <div className="me-row-date">
                                        {new Date(expense.expense_date).toLocaleDateString('es-CO')}
                                    </div>
                                </div>
                                <button
                                    className="me-row-delete"
                                    onClick={() => handleDelete(expense.id)}
                                    title="Eliminar"
                                >
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