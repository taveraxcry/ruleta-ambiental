/* Configuración PÚBLICA de Supabase.
   La "anon key" está pensada para vivir en el navegador: la seguridad la dan las políticas RLS y las
   funciones RPC de supabase/schema.sql. NUNCA pegues aquí la "service_role key" ni la contraseña de la base.
   Mientras url/anonKey estén vacíos, la app funciona en MODO LOCAL (pestañas del mismo navegador). */
(function (R) {
  'use strict';
  R.SUPABASE = {
    url: '',      // Ej: https://abcdefghijk.supabase.co
    anonKey: ''   // Settings → API → "anon public"
  };
})(window.Ruleta = window.Ruleta || {});
