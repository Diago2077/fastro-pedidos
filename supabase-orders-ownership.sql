-- ============================================================
-- FASTRO — Pedidos por dueño (row-level security)
-- Ejecutar en Supabase → SQL Editor.
--
-- Objetivo: el ADMIN ve y edita TODOS los pedidos; cada usuario
-- normal solo ve/edita los SUYOS (orders.user_id = auth.uid()).
--
-- Reemplaza las políticas abiertas (USING true) por políticas por dueño.
-- Reusa la función is_admin() ya creada en la migración de Auth.
-- ============================================================

-- 1) PEDIDOS
DROP POLICY IF EXISTS orders_auth_all  ON orders;
DROP POLICY IF EXISTS orders_owner_all ON orders;
CREATE POLICY orders_owner_all ON orders FOR ALL TO authenticated
  USING      (is_admin() OR user_id = auth.uid())
  WITH CHECK (is_admin() OR user_id = auth.uid());

-- 2) ÍTEMS DEL PEDIDO (se acota a través del pedido padre)
DROP POLICY IF EXISTS order_items_auth_all  ON order_items;
DROP POLICY IF EXISTS order_items_owner_all ON order_items;
CREATE POLICY order_items_owner_all ON order_items FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_items.order_id
      AND (is_admin() OR o.user_id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_items.order_id
      AND (is_admin() OR o.user_id = auth.uid())
  ));

-- Verificación rápida (opcional):
--   SELECT polname, cmd FROM pg_policies WHERE tablename IN ('orders','order_items');
