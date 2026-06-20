-- ============================================================
-- FASTRO — Programación del envío automático de reportes
-- Un único job DIARIO llama a la Edge Function `send-report` en modo 'auto';
-- la función decide si hoy corresponde el envío semanal y/o mensual según
-- la configuración guardada en app_config (Configuración → Reportes por correo).
--
-- ANTES DE EJECUTAR, reemplazá:
--   <CRON_SECRET>  por el mismo valor cargado en el secret CRON_SECRET de la función.
-- (El project ref ya está puesto: rsnhzmjqyiswdkfzizsm)
--
-- Para cambiar la hora, editá el cron '0 11 * * *' (11:00 UTC ≈ 07:00 Paraguay).
-- ============================================================

-- 1) Extensiones necesarias
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) (Re)crear el job diario. Si ya existe, lo borramos primero.
select cron.unschedule('send-report-daily')
where exists (select 1 from cron.job where jobname = 'send-report-daily');

select cron.schedule(
  'send-report-daily',
  '0 11 * * *',
  $$
  select net.http_post(
    url     := 'https://rsnhzmjqyiswdkfzizsm.functions.supabase.co/send-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := jsonb_build_object('mode', 'auto')
  );
  $$
);

-- Ver / verificar el job:
--   select * from cron.job where jobname = 'send-report-daily';
-- Ver corridas recientes:
--   select * from cron.job_run_details order by start_time desc limit 10;
