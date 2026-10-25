-- Agenda a função de alertas para rodar a cada minuto.
-- Rode no SQL Editor do Supabase DEPOIS de publicar as funções.
-- Troque SEU-PROJETO pelo id do projeto e SEU-SEGREDO pelo mesmo valor de CRON_SECRET.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('rn-group-alertas') where exists (select 1 from cron.job where jobname = 'rn-group-alertas');

select cron.schedule(
  'rn-group-alertas',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/send-alerts',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', 'SEU-SEGREDO'),
    body := '{}'::jsonb
  );
  $$
);
