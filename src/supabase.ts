import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configured = Boolean(url && key)
// Solo la clave pública (anon). La seguridad real la imponen las políticas RLS de la base.
export const supabase = createClient(url || 'http://localhost', key || 'sin-configurar')
