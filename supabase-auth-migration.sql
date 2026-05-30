-- ============================================================
-- FASTRO — Migración a Supabase Auth + RLS
-- Ejecutar por FASES en: Supabase → SQL Editor
-- ============================================================


-- ============================================================
-- FASE 1 — Estructura (aditivo; NO rompe la app actual)
-- Corré TODO este bloque de una.
-- ============================================================

-- 1.1 Tabla de perfiles (rol + permisos), ligada a auth.users
CREATE TABLE IF NOT EXISTS profiles (
  id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email  TEXT,
  name   TEXT NOT NULL DEFAULT '',
  role   TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  active BOOLEAN DEFAULT true,
  can_see_cost          BOOLEAN DEFAULT false,
  can_export_excel      BOOLEAN DEFAULT false,
  can_view_dashboard    BOOLEAN DEFAULT true,
  can_view_orders       BOOLEAN DEFAULT true,
  can_create_orders     BOOLEAN DEFAULT true,
  can_edit_orders       BOOLEAN DEFAULT true,
  can_delete_orders     BOOLEAN DEFAULT true,
  can_view_clients      BOOLEAN DEFAULT false,
  can_create_clients    BOOLEAN DEFAULT false,
  can_edit_clients      BOOLEAN DEFAULT false,
  can_delete_clients    BOOLEAN DEFAULT false,
  can_view_products     BOOLEAN DEFAULT true,
  can_create_products   BOOLEAN DEFAULT false,
  can_edit_products     BOOLEAN DEFAULT false,
  can_delete_products   BOOLEAN DEFAULT false,
  can_view_providers    BOOLEAN DEFAULT true,
  can_create_providers  BOOLEAN DEFAULT true,
  can_edit_providers    BOOLEAN DEFAULT true,
  can_delete_providers  BOOLEAN DEFAULT true,
  can_view_reports      BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.2 Trigger: crea el perfil automáticamente al dar de alta un usuario en Auth
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 1.3 Helper para políticas RLS (SECURITY DEFINER => no recursiona con la RLS de profiles)
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND active);
$$;

-- 1.4 Arreglar warning "Function Search Path Mutable" de next_order_number
CREATE OR REPLACE FUNCTION next_order_number() RETURNS TEXT
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RETURN 'PED-' || LPAD(nextval('order_number_seq')::TEXT, 4, '0');
END; $$;

-- 1.5 Re-apuntar orders.user_id a profiles (seguro: 0 pedidos)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;


-- ============================================================
-- FASE 2 — DESPUÉS de crear los usuarios en Authentication → Add user
-- (con "Auto Confirm"). El trigger ya les creó el profile.
-- Este UPDATE copia rol + permisos desde la tabla vieja `users`.
-- ============================================================
UPDATE profiles p SET
  name                 = u.name,
  role                 = u.role,
  active               = u.active,
  can_see_cost         = u.can_see_cost,
  can_export_excel     = u.can_export_excel,
  can_view_dashboard   = u.can_view_dashboard,
  can_view_orders      = u.can_view_orders,
  can_create_orders    = u.can_create_orders,
  can_edit_orders      = u.can_edit_orders,
  can_delete_orders    = u.can_delete_orders,
  can_view_clients     = u.can_view_clients,
  can_create_clients   = u.can_create_clients,
  can_edit_clients     = u.can_edit_clients,
  can_delete_clients   = u.can_delete_clients,
  can_view_products    = u.can_view_products,
  can_create_products  = u.can_create_products,
  can_edit_products    = u.can_edit_products,
  can_delete_products  = u.can_delete_products,
  can_view_providers   = u.can_view_providers,
  can_create_providers = u.can_create_providers,
  can_edit_providers   = u.can_edit_providers,
  can_delete_providers = u.can_delete_providers,
  can_view_reports     = u.can_view_reports,
  updated_at           = NOW()
FROM users u
WHERE lower(u.email) = lower(p.email);

-- Verificación rápida (debería mostrar Diago y Veronica como admin, Sandra como user)
-- SELECT email, role, active FROM profiles ORDER BY role, email;


-- ============================================================
-- FASE 2-BIS — RECUPERACIÓN (correr si `profiles` quedó vacía)
-- Pasa esto si creaste los usuarios de Auth ANTES de la Fase 1
-- (el trigger no existía aún y no les creó el perfil).
-- Es idempotente: podés correrlo sin miedo.
-- ============================================================

-- a) Crear el perfil para cualquier usuario de Auth que no tenga uno
INSERT INTO profiles (id, email, name)
SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'name', u.email)
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- b) Volver a copiar rol + permisos desde la tabla vieja `users`
UPDATE profiles p SET
  name=u.name, role=u.role, active=u.active,
  can_see_cost=u.can_see_cost, can_export_excel=u.can_export_excel,
  can_view_dashboard=u.can_view_dashboard,
  can_view_orders=u.can_view_orders, can_create_orders=u.can_create_orders,
  can_edit_orders=u.can_edit_orders, can_delete_orders=u.can_delete_orders,
  can_view_clients=u.can_view_clients, can_create_clients=u.can_create_clients,
  can_edit_clients=u.can_edit_clients, can_delete_clients=u.can_delete_clients,
  can_view_products=u.can_view_products, can_create_products=u.can_create_products,
  can_edit_products=u.can_edit_products, can_delete_products=u.can_delete_products,
  can_view_providers=u.can_view_providers, can_create_providers=u.can_create_providers,
  can_edit_providers=u.can_edit_providers, can_delete_providers=u.can_delete_providers,
  can_view_reports=u.can_view_reports, updated_at=NOW()
FROM users u
WHERE lower(u.email) = lower(p.email);

-- c) Verificar: debe listar los 3 (Diago/Veronica admin, Sandra user)
SELECT email, role, active FROM profiles ORDER BY role, email;


-- ============================================================
-- FASE 4 — Activar RLS (correr SOLO cuando el código nuevo ya esté en vivo
-- y el login con Supabase Auth funcione)
-- ============================================================

-- Tablas de datos: solo usuarios autenticados pueden operar; anon = nada
ALTER TABLE clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config       ENABLE ROW LEVEL SECURITY;

CREATE POLICY clients_auth_all          ON clients          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY providers_auth_all        ON providers        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY products_auth_all         ON products         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY product_variants_auth_all ON product_variants FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY orders_auth_all           ON orders           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY order_items_auth_all      ON order_items      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY app_config_auth_all       ON app_config       FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- profiles: todos los autenticados pueden LEER; solo admin puede modificar
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select      ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_admin_write ON profiles FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());


-- ============================================================
-- FASE 5 — Limpieza (OPCIONAL, solo cuando todo esté verificado)
-- ============================================================
-- DROP TABLE users;
