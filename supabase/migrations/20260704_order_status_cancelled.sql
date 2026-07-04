-- ============================================================
-- Estado "Cancelado" para pedidos (orders.status = 'cancelled')
-- Correr en el proyecto FASTRO (ref rsnhzmjqyiswdkfzizsm), NO en el
-- proyecto del MCP. La tabla orders no está versionada en el repo;
-- esta migración solo ajusta la restricción del campo status.
--
-- Un pedido cancelado NO se elimina: queda como registro histórico y
-- deja de sumar en Dashboard y Reportes (eso se filtra en el frontend).
-- ============================================================

-- Si la columna status tuviera un CHECK que solo permite open/closed/sent,
-- insertar 'cancelled' fallaría. Quitamos cualquier CHECK sobre status
-- (tenga el nombre que tenga) y lo recreamos incluyendo 'cancelled'.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'orders'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.orders drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.orders
  add constraint orders_status_check
  check (status in ('open', 'closed', 'sent', 'cancelled'));

-- Nota: si en tu base status fuese un tipo ENUM (no un text con CHECK),
-- este script daría error. En ese caso, en su lugar correr:
--   alter type <nombre_del_enum> add value if not exists 'cancelled';
-- (por el código actual, que escribe status como texto libre, lo esperado
--  es un text con o sin CHECK, y esta migración lo cubre.)
