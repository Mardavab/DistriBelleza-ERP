'use client'

import React, { useState } from 'react';
import { Building2, Plus, AlertCircle } from 'lucide-react';
import CompanyList from './CompanyList';
import CreateCompanyModal from './CreateCompanyModal';

/**
 * Panel de gestión de empresas del administrador de plataforma.
 *
 * Responsabilidad: cabecera de sección, mostrar el listado de empresas y
 * abrir el alta de una nueva. La lógica del formulario de alta vive en
 * `CreateCompanyModal` y el listado en `CompanyList`.
 */
export default function CompaniesPanel() {
    const [error, setError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    function handleCreated() {
        setReloadToken(k => k + 1);
    }

    return (
        <div className="page-container">
            <header className="page-header">
                <div className="page-header-group">
                    <div className="page-title-icon">
                        <Building2 size={28} />
                    </div>
                    <div className="page-title-block">
                        <h1>Gestión de Empresas</h1>
                        <p>Crea nuevos tenants (empresas clientes) en la plataforma</p>
                    </div>
                </div>
                <button
                    className="btn-primary-page"
                    onClick={() => {
                        setError(null);
                        setShowCreateModal(true);
                    }}
                >
                    <Plus size={20} /> Nueva Empresa
                </button>
            </header>

            {error && (
                <div className="platform-alert-error">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                </div>
            )}

            <CompanyList reloadToken={reloadToken} />

            {showCreateModal && (
                <CreateCompanyModal
                    onClose={() => setShowCreateModal(false)}
                    onCreated={handleCreated}
                />
            )}
        </div>
    );
}