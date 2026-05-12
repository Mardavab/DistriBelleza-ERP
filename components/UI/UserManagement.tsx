'use client'

import React, { useState, useEffect } from 'react';
import { 
  Users, Plus, Trash2, Edit2, Shield, Mail, 
  UserCircle, AlertCircle, Check, X, RefreshCcw 
} from 'lucide-react';
import { getUsers, createUser, updateUser, deleteUser } from '../../app/actions/users';
import CustomSelect from './CustomSelect';

interface UserManagementProps {
  currentUserRole: string;
}

export default function UserManagement({ currentUserRole }: UserManagementProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'manager'
  });

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    const res = await getUsers();
    if (res.success) {
      setUsers(res.data);
    }
    setLoading(false);
  }

  const openCreateModal = () => {
    setIsEditing(false);
    setEditingId(null);
    setFormData({ email: '', password: '', full_name: '', role: 'manager' });
    setError(null);
    setShowModal(true);
  };

  const openEditModal = (user: any) => {
    setIsEditing(true);
    setEditingId(user.id);
    setFormData({ 
      email: '', // No editamos email aquí por seguridad de Auth
      password: '', // No editamos password aquí
      full_name: user.full_name,
      role: user.role 
    });
    setError(null);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (isEditing && editingId) {
      const updates: any = { 
        full_name: formData.full_name, 
        role: formData.role 
      };
      
      // SOLO EL TECNICO puede editar email y password
      if (currentUserRole === 'technician') {
        if (formData.email) updates.email = formData.email;
        if (formData.password) updates.password = formData.password;
      }

      const res = await updateUser(editingId, updates);
      if (res.success) {
        setShowModal(false);
        loadUsers();
      } else {
        setError(res.error);
        setLoading(false);
      }
    } else {
      const res = await createUser(formData);
      if (res.success) {
        setShowModal(false);
        setFormData({ email: '', password: '', full_name: '', role: 'manager' });
        loadUsers();
      } else {
        setError(res.error);
        setLoading(false);
      }
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`¿Estás seguro de eliminar al usuario ${name}? Esta acción no se puede deshacer.`)) {
      const res = await deleteUser(id);
      if (res.success) {
        loadUsers();
      } else {
        alert("Error al eliminar: " + res.error);
      }
    }
  };

  return (
    <div className="user-mgmt-container">
      <header className="mgmt-header">
        <div className="title-area">
          <div className="icon-box">
            <Users size={24} color="#6366f1" />
          </div>
          <div>
            <h2>Gestión de Personal</h2>
            <p>Controla los accesos y roles de tus empleados</p>
          </div>
        </div>
        <button className="btn-add-user" onClick={openCreateModal}>
          <Plus size={20} /> Nuevo Empleado
        </button>
      </header>

      <div className="users-grid">
        {loading && users.length === 0 ? (
          [1,2,3,4,5,6].map(i => (
            <div key={i} className="user-card skeleton-card">
              <div className="skeleton-avatar"></div>
              <div className="skeleton-text-group">
                <div className="skeleton-line w-3/4"></div>
                <div className="skeleton-line w-1/2"></div>
              </div>
            </div>
          ))
        ) : (
          users.map((user) => (
            <div key={user.id} className="user-card">
              <div className="card-top">
                <div className="avatar">
                  <UserCircle size={48} color="#cbd5e1" />
                  <span className={`role-dot ${user.role}`}></span>
                </div>
                <div className="user-details">
                  <h3>{user.full_name}</h3>
                  <div className="role-tag">
                    <Shield size={12} />
                    <span>{user.role}</span>
                  </div>
                </div>
              </div>
              
              <div className="card-info">
                <div className="info-item">
                  <Mail size={14} />
                  <span>ID: {user.id.substring(0, 8)}...</span>
                </div>
              </div>

              <div className="card-actions">
                <button className="btn-edit" title="Editar" onClick={() => openEditModal(user)}>
                  <Edit2 size={16} />
                </button>
                <button 
                    className="btn-delete" 
                    title="Eliminar"
                    onClick={() => handleDelete(user.id, user.full_name)}
                    disabled={user.role === 'owner'}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-window">
            <div className="modal-header">
              <h3>{isEditing ? 'Editar Empleado' : 'Registrar Nuevo Empleado'}</h3>
              <button className="btn-close" onClick={() => setShowModal(false)}><X /></button>
            </div>
            
            <form onSubmit={handleSubmit} className="modal-body">
              {error && (
                <div className="error-box">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              )}

              <div className="form-group">
                <label>Nombre Completo</label>
                <input 
                  type="text" 
                  required 
                  placeholder="Ej: Juan Pérez"
                  value={formData.full_name}
                  onChange={e => setFormData({...formData, full_name: e.target.value})}
                />
              </div>

              {(!isEditing || currentUserRole === 'technician') && (
                <>
                  <div className="form-group">
                    <label>Correo Electrónico {isEditing && '(Opcional)'}</label>
                    <input 
                      type="email" 
                      required={!isEditing}
                      placeholder="empleado@glow.com"
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                    />
                  </div>

                  <div className="form-group">
                    <label>Contraseña {isEditing ? 'Nueva (Opcional)' : 'Temporal'}</label>
                    <input 
                      type="password" 
                      required={!isEditing}
                      placeholder={isEditing ? "Dejar en blanco para no cambiar" : "Mínimo 6 caracteres"}
                      value={formData.password}
                      onChange={e => setFormData({...formData, password: e.target.value})}
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <CustomSelect
                  label="Rol de Usuario"
                  value={formData.role}
                  onChange={(val) => setFormData({...formData, role: val})}
                  options={[
                    { value: 'manager', label: 'Manager (Ventas y Reportes)' },
                    { value: 'technician', label: 'Técnico (Inventario y Config)' },
                    { value: 'owner', label: 'Owner (Acceso Total)' }
                  ]}
                />
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-cancel" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-save" disabled={loading}>
                  {loading ? <RefreshCcw size={18} className="spin" /> : <Check size={18} />}
                  Guardar Usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .user-mgmt-container { padding: 20px; }
        .mgmt-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
        .title-area { display: flex; gap: 16px; align-items: center; }
        .icon-box { background: #eff6ff; padding: 12px; border-radius: 12px; }
        .title-area h2 { margin: 0; font-size: 1.5rem; color: #1e293b; }
        .title-area p { margin: 4px 0 0; color: #64748b; font-size: 0.875rem; }

        .btn-add-user { background: #6366f1; color: white; border: none; padding: 12px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s; }
        .btn-add-user:hover { background: #4f46e5; transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.3); }

        .users-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
        .user-card { background: white; border-radius: 20px; border: 1px solid #e2e8f0; padding: 24px; transition: all 0.2s; }
        .user-card:hover { border-color: #6366f1; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05); }
        
        .card-top { display: flex; gap: 16px; align-items: center; margin-bottom: 20px; }
        .avatar { position: relative; }
        .role-dot { position: absolute; bottom: 0; right: 0; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; }
        .role-dot.owner { background: #f59e0b; }
        .role-dot.manager { background: #10b981; }
        .role-dot.technician { background: #6366f1; }

        .user-details h3 { margin: 0; font-size: 1.1rem; color: #0f172a; }
        .role-tag { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: #64748b; text-transform: uppercase; font-weight: 700; margin-top: 4px; }
        
        .card-info { padding: 12px 0; border-top: 1px solid #f1f5f9; margin-bottom: 12px; }
        .info-item { display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 0.85rem; }

        .card-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .btn-edit, .btn-delete { padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0; background: white; cursor: pointer; color: #64748b; transition: all 0.2s; }
        .btn-edit:hover { color: #6366f1; border-color: #6366f1; }
        .btn-delete:hover:not(:disabled) { color: #ef4444; border-color: #ef4444; background: #fef2f2; }
        .btn-delete:disabled { opacity: 0.3; cursor: not-allowed; }

        /* Modal Styles */
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(4px); display: flex; justify-content: center; align-items: center; z-index: 2000; }
        .modal-window { background: white; border-radius: 24px; width: 100%; max-width: 500px; overflow: hidden; }
        .modal-header { padding: 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        .modal-body { padding: 24px; display: flex; flex-direction: column; gap: 20px; }
        .form-group { display: flex; flex-direction: column; gap: 8px; }
        .form-group label { font-size: 0.875rem; font-weight: 600; color: #475569; }
        .form-group input { padding: 12px; border: 1px solid #e2e8f0; border-radius: 12px; outline: none; transition: border-color 0.2s; }
        .form-group input:focus { border-color: #6366f1; }
        
        .error-box { background: #fef2f2; border: 1px solid #fecaca; padding: 12px; border-radius: 12px; color: #dc2626; display: flex; gap: 10px; font-size: 0.875rem; }
        
        .modal-footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 12px; }
        .btn-cancel { background: #f1f5f9; border: none; padding: 12px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; color: #64748b; }
        .btn-save { background: #0f172a; color: white; border: none; padding: 12px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; }
        
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        /* SKELETON */
        .skeleton-card { background: #f8fafc; border: 1px solid #f1f5f9; display: flex; gap: 16px; align-items: center; }
        .skeleton-avatar { width: 48px; height: 48px; border-radius: 50%; background: #e2e8f0; position: relative; overflow: hidden; }
        .skeleton-text-group { flex: 1; display: flex; flex-direction: column; gap: 8px; }
        .skeleton-line { height: 12px; background: #e2e8f0; border-radius: 4px; position: relative; overflow: hidden; }
        .skeleton-line.w-3\/4 { width: 75%; }
        .skeleton-line.w-1\/2 { width: 50%; }

        .skeleton-avatar::after, .skeleton-line::after {
          content: "";
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
          animation: skeleton-shimmer 1.5s infinite;
        }
        @keyframes skeleton-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
