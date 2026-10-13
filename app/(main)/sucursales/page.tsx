'use client'

import BranchManagement from '../../../components/Dashboard/BranchManagement';
import { useAppProfile } from '../../../components/Dashboard/AppShell';

export default function SucursalesPage() {
    const profile = useAppProfile();
    // BranchManagement renderiza su propio aviso de "sin permiso" para
    // roles no-owner; aquí solo se le pasa el rol.
    return <BranchManagement currentUserRole={profile?.role || 'manager'} />;
}
