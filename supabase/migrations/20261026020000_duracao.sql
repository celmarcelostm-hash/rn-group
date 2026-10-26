-- Duração do compromisso (mostra o horário de término na agenda do dia)
alter table public.items add column duration_min int check (duration_min between 5 and 1440);
