'use client'

import UserManagement from '../../../components/UI/UserManagement';
import { useAppProfile } from '../../../components/Dashboard/AppShell';

export default function ConfiguracionPage() {
    const profile = useAppProfile();

    if (profile?.role !== 'owner') {
        return (
            <div className="p-8 text-slate-500">
                No tienes permiso para acceder a esta sección.
            </div>
        );
    }
    return <UserManagement currentUserRole={profile.role} />;
}
