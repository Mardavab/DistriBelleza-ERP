'use server'

import { createClient } from '../../lib/supabase/server';
import { redirect } from 'next/navigation';

export async function login(formData: FormData) {
  const supabase = createClient();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: 'Credenciales inválidas o error de conexión.' };
  }

  redirect('/');
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function getUserProfile() {
  const supabase = createClient();
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;

  // Intentar obtener el perfil
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  // Si no hay perfil (ej. usuario creado antes del primer trigger), retornar info básica del auth
  if (!profile) {
    return {
        id: user.id,
        full_name: user.user_metadata?.full_name || user.email,
        role: user.user_metadata?.role || 'manager'
    };
  }

  return profile;
}
