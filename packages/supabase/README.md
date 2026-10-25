# Supabase (opcional) — sincronización y respaldo en la nube

FinZen funciona 100 % sin esto. Es para respaldar tus datos y usar varios celulares.
**Cada persona crea su propio proyecto**: nada de claves va en el repositorio.

1. Crea una cuenta gratis en <https://supabase.com> y un proyecto nuevo.
2. **SQL Editor → New query**: pega [`schema.sql`](schema.sql) y pulsa **Run**.
3. **Authentication → Providers → Email**: para empezar rápido, desactiva *Confirm email*
   (si lo dejas activo, tendrás que confirmar el correo antes de iniciar sesión).
4. **Project Settings → API**: copia la **Project URL** y la clave **anon public**.
   ⚠️ Nunca pegues la `service_role` en la app.
5. En FinZen: **Ajustes → Sincronización**: pega URL y anon key, crea tu cuenta (correo + contraseña)
   y pulsa **Sincronizar ahora**.

## Cómo funciona
- Cada cambio local se anota en una cola (`sync_queue`) y se sube al haber internet.
- **Última escritura gana**: un trigger en la base descarta cualquier cambio más viejo que el guardado.
- **Row Level Security**: cada fila lleva tu `user_id`; nadie más puede leerla.
- No se sube la bitácora de notificaciones, ni el PIN, ni tus claves de IA.
- El plan gratuito pausa proyectos sin actividad durante un tiempo: la app guarda todo en el celular
  y se pone al día cuando el proyecto vuelve a estar activo.
