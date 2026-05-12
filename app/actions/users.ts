'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { revalidatePath } from 'next/cache';

export async function getUsers() {
  try {
    const { data: profiles, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data: profiles };
  } catch (err: any) {
    console.error('[Action: getUsers]', err.message);
    return { success: false, error: err.message };
  }
}

export async function createUser(userData: { email: string; password: string; full_name: string; role: string }) {
  try {
    // 1. Crear el usuario en Auth
    const { data, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: userData.email,
      password: userData.password,
      user_metadata: { full_name: userData.full_name, role: userData.role },
      email_confirm: true
    });

    if (authError) throw authError;

    // 2. El trigger 'handle_new_user' debería encargarse del perfil, 
    // pero como precaución (por si está fallando), intentamos asegurar que el perfil exista.
    // Si el trigger funcionó, este upsert no hará daño.
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: data.user.id,
        full_name: userData.full_name,
        role: userData.role
      });

    if (profileError) console.warn("Aviso: El perfil se creó pero hubo un detalle menor:", profileError.message);

    revalidatePath('/');
    return { success: true, data: data.user };
  } catch (err: any) {
    console.error('[Action: createUser]', err.message);
    return { success: false, error: err.message };
  }
}

export async function updateUser(userId: string, updates: { full_name?: string; role?: string; email?: string; password?: string }) {
  try {
    // 1. Actualizar perfil en tabla pública (Solo full_name y role)
    const profileUpdates: any = {};
    if (updates.full_name) profileUpdates.full_name = updates.full_name;
    if (updates.role) profileUpdates.role = updates.role;

    if (Object.keys(profileUpdates).length > 0) {
      const { error } = await supabaseAdmin
        .from('profiles')
        .update(profileUpdates)
        .eq('id', userId);
      if (error) throw error;
    }
    
    // 2. Actualizar en Auth (Metadata, Email, Password)
    const authUpdates: any = {
        user_metadata: {
            full_name: updates.full_name,
            role: updates.role
        }
    };
    if (updates.email) authUpdates.email = updates.email;
    if (updates.password) authUpdates.password = updates.password;

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, authUpdates);
    if (authError) throw authError;

    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    console.error('[Action: updateUser]', err.message);
    return { success: false, error: err.message };
  }
}

export async function deleteUser(userId: string) {
  try {
    // 1. Eliminar de Auth (esto eliminará el perfil por ON DELETE CASCADE si está configurado)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;

    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    console.error('[Action: deleteUser]', err.message);
    return { success: false, error: err.message };
  }
}
