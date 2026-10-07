/* Configuración PÚBLICA de Supabase.
   La "anon key" está pensada para vivir en el navegador: la seguridad la dan las políticas RLS y las
   funciones RPC de supabase/schema.sql. NUNCA pegues aquí la "service_role key" ni la contraseña de la base.
   Mientras url/anonKey estén vacíos, la app funciona en MODO LOCAL (pestañas del mismo navegador). */
(function (R) {
  'use strict';
  R.SUPABASE = {
    url: 'https://qdljwfsnohqgpogvndgx.supabase.co',
    anonKey: 'sb_publishable_hpTeG02PykBV3JHkuJImaA_8GsC0zX_'   // clave pública (publishable): segura en el navegador
  };
})(window.Ruleta = window.Ruleta || {});
