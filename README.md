# TeraFi Clinic (PWA) · primera entrega

**Estado:** código sin compilar ni probar (mi entorno no tenía internet para instalar paquetes). No está publicada.
**Incluye:** acceso con roles (admin, fisio, recepción), recuperar contraseña, cierre por inactividad (15 min), pacientes con expediente automático y búsqueda, notas SOAP con guardado automático, finalización y adendas, auditoría, RLS y PWA para iPhone.
**Falta:** historia clínica y valoración completas, escalas, fotos y comparación, gráficas, PDF, panel de administración (hoy los usuarios se crean en Supabase), consentimientos, agenda, registro de lecturas, IA.

## Publicar (solo navegador, sin Mac)
1. supabase.com → New project. Guarda la contraseña de la base.
2. SQL Editor → pega `supabase/migrations/001_core.sql` → Run.
3. Authentication → Sign In / Providers → Email: desactiva el registro público. Authentication → Users → Add user (tu correo y una contraseña larga).
4. SQL Editor (cambia el UUID por el de tu usuario):
   ```sql
   with c as (insert into clinics(name) values ('TeraFi') returning id)
   insert into profiles(id, clinic_id, full_name, role)
   select 'UUID-DEL-USUARIO', c.id, 'Tu nombre', 'admin' from c;
   ```
5. Project Settings → API: copia Project URL y la clave anon (nunca la service_role).
6. github.com → repositorio privado → Add file → Upload files con el contenido de esta carpeta. Subir carpetas completas requiere un navegador de computadora (no tiene que ser Mac); desde iPhone solo se suben archivos sueltos.
7. vercel.com → Add New → Project → importa el repositorio (Vite). En Environment Variables agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Deploy.
8. Supabase → Authentication → URL Configuration: pon tu URL de Vercel en Site URL.
9. iPhone: abre la URL en Safari → Compartir → Añadir a pantalla de inicio.

**Invitar a otro fisioterapeuta:** Authentication → Users → Add user; luego inserta su fila en `profiles` con role `fisio` y el `clinic_id` de tu clínica.

## Antes de usar expedientes reales
No tiene certificación legal ni sanitaria. Falta revisión jurídica (LFPDPPP, NOM-004-SSA3-2012: aviso de privacidad, consentimientos, conservación) y de seguridad (incluida una política CSP). Verifica en los precios vigentes de Supabase y Vercel que el plan incluya respaldos y no pause el proyecto; no asumas que un plan gratuito basta para datos clínicos reales.
