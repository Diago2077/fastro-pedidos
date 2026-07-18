-- ============================================================
-- FASTRO — Guardar pedido + ítems de forma atómica (RPC)
-- Correr en el SQL Editor del proyecto FASTRO (ref rsnhzmjqyiswdkfzizsm).
--
-- Antes: el frontend hacía UPDATE/INSERT de orders y luego un DELETE +
-- INSERT de order_items como pasos separados. Si la conexión se cortaba
-- entre esos pasos (ej. en el celular, a mitad de guardar), el pedido
-- podía quedar con los ítems borrados y sin los nuevos.
--
-- Esta función hace todo dentro de una única transacción: si algo falla
-- en el medio, Postgres deshace todo (no hay estado intermedio visible).
--
-- SECURITY INVOKER (el default, no se declara SECURITY DEFINER): la
-- función corre con los privilegios y el auth.uid() del que la invoca,
-- así que las políticas RLS de orders/order_items (dueño o admin) se
-- siguen aplicando exactamente igual que antes.
-- ============================================================

create or replace function public.save_order_with_items(
  p_order_id     uuid,      -- null = crear pedido nuevo
  p_client_id    uuid,
  p_provider_id  uuid,
  p_season       text,
  p_discount_pct numeric,
  p_shipping_date date,
  p_status       text,
  p_observation  text,
  p_items        jsonb      -- [{ variant_id, quantity, sale_price, cost_price }, ...]
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
begin
  if p_order_id is null then
    insert into orders (client_id, provider_id, season, discount_pct, shipping_date, status, observation, user_id, updated_at)
    values (p_client_id, p_provider_id, p_season, p_discount_pct, p_shipping_date, p_status, p_observation, auth.uid(), now())
    returning id into v_order_id;
  else
    update orders set
      client_id     = p_client_id,
      provider_id   = p_provider_id,
      season        = p_season,
      discount_pct  = p_discount_pct,
      shipping_date = p_shipping_date,
      status        = p_status,
      observation   = p_observation,
      updated_at    = now()
    where id = p_order_id
    returning id into v_order_id;

    if v_order_id is null then
      raise exception 'Pedido no encontrado o sin permiso para editarlo';
    end if;
  end if;

  delete from order_items where order_id = v_order_id;

  insert into order_items (order_id, product_variant_id, quantity, unit_sale_price, unit_cost_price)
  select
    v_order_id,
    (item->>'variant_id')::uuid,
    (item->>'quantity')::integer,
    (item->>'sale_price')::numeric,
    (item->>'cost_price')::numeric
  from jsonb_array_elements(p_items) as item;

  return v_order_id;
end;
$$;

revoke execute on function public.save_order_with_items(uuid, uuid, uuid, text, numeric, date, text, text, jsonb) from public, anon;
grant  execute on function public.save_order_with_items(uuid, uuid, uuid, text, numeric, date, text, text, jsonb) to authenticated;
