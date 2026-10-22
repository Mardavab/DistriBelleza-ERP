'use client'

import SuppliersView from '../../../components/Suppliers/SuppliersView';
import { useAppProfile } from '../../../components/Dashboard/AppShell';

export default function ProveedoresPage() {
    const profile = useAppProfile();

    // El middleware.ts ya redirige a un manager fuera de /proveedores; este
    // chequeo es la doble defensa por si el middleware se desconfigura.
    if (profile && profile.role !== 'owner') {
        return (
            <div className="p-8 text-slate-500">
                No tienes permiso para acceder a esta sección.
            </div>
        );
    }
    return <SuppliersView />;
}
