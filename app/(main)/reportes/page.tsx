'use client'

import ReportsView from '../../../components/Reports/ReportsView';
import { useAppProfile } from '../../../components/Dashboard/AppShell';

export default function ReportesPage() {
    const profile = useAppProfile();
    return <ReportsView userProfile={profile} />;
}
