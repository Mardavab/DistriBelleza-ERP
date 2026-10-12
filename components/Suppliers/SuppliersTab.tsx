'use client';

import React, { useState } from 'react';
import { Search, Plus, Truck, Edit2, Trash2, Building2, RefreshCw } from 'lucide-react';
import type { Supplier } from '../../app/actions/suppliers';
import { deleteSupplier } from '../../app/actions/suppliers';
import SupplierModal from './SupplierModal';
import ConfirmModal from './ConfirmModal';

type SuppliersTabProps = {
  suppliers: Supplier[];
  loading: boolean;
  onRefresh: () => void;
};

/**
 * Tab "Proveedores": listado con búsqueda + acciones (crear/editar/desactivar).
 */
export default function SuppliersTab({ suppliers, loading, onRefresh }: SuppliersTabProps) {
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<null | 'new' | Supplier>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<Supplier | null>(null);

  const filtered = suppliers.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.phone ?? '').includes(search) ||
      (s.email ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const handleDeleteConfirmed = async () => {
    if (!confirmTarget) return;
    setDeleting(true);
    await deleteSupplier(confirmTarget.id);
    setDeleting(false);
    setConfirmTarget(null);
    onRefresh();
  };

  return (
    <>
      <div className="sup-toolbar">
        <div className="sup-search-wrap">
          <Search size={16} />
          <input
            id="suppliers-search"
            className="sup-search-input"
            placeholder="Buscar proveedor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className="btn-primary"
          id="btn-new-supplier"
          onClick={() => setModal('new')}
        >
          <Plus size={16} /> Nuevo Proveedor
        </button>
      </div>

      <div className="sup-table-wrap">
        {loading ? (
          <div className="sup-empty">
            <RefreshCw size={32} className="spin" />
            <p>Cargando proveedores…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="sup-empty">
            <Building2 size={48} strokeWidth={1.2} />
            <p>
              <strong>No hay proveedores</strong>
            </p>
            <p>Agrega tu primer proveedor con el botón de arriba.</p>
          </div>
        ) : (
          <table className="sup-table">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Teléfono</th>
                <th>Correo</th>
                <th>Dirección</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          background: '#ede9fe',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Truck size={16} color="#7c3aed" />
                      </div>
                      <span style={{ fontWeight: 600, color: '#0f172a' }}>{s.name}</span>
                    </div>
                  </td>
                  <td>
                    {s.phone ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>
                  <td>
                    {s.email ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>
                  <td
                    style={{
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.address ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>
                  <td>
                    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      <button className="icon-btn" title="Editar" onClick={() => setModal(s)}>
                        <Edit2 size={14} />
                      </button>
                      <button
                        className="icon-btn danger"
                        title="Desactivar"
                        onClick={() => setConfirmTarget(s)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <SupplierModal
          initial={modal === 'new' ? null : (modal as Supplier)}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            onRefresh();
          }}
        />
      )}
      {confirmTarget && (
        <ConfirmModal
          title="¿Desactivar proveedor?"
          message={`"${confirmTarget.name}" desaparecerá de la lista. Sus facturas asociadas se conservan.`}
          confirmLabel="Sí, desactivar"
          variant="warning"
          loading={deleting}
          onConfirm={handleDeleteConfirmed}
          onClose={() => setConfirmTarget(null)}
        />
      )}
    </>
  );
}