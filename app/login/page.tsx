'use client'

import React, { useState } from 'react';
import { login } from '../actions/auth';
import './login.css';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = await login(formData);

    if (result?.error) {
      setError(result.error);
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <header className="login-header">
          <h1>Distri Belleza</h1>
          <p>Gestión Empresarial de Inventario</p>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Correo Electrónico</label>
            <input
              className="form-input"
              type="email"
              id="email"
              name="email"
              required
              placeholder="admin@glow.com"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Contraseña</label>
            <input
              className="form-input"
              type="password"
              id="password"
              name="password"
              required
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div style={{ color: '#ef4444', fontSize: '0.875rem', marginBottom: '20px', textAlign: 'center' }}>
              {error}
            </div>
          )}

          <button className="btn-login" type="submit" disabled={isLoading}>
            {isLoading ? 'Iniciando sesión...' : 'Ingresar al sistema'}
          </button>
        </form>

        <footer className="login-footer">
          &copy; 2026 Distri Belleza ERP. Todos los derechos reservados.
        </footer>
      </div>
    </div>
  );
}
