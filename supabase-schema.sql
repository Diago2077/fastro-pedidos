-- ============================================================
-- FASTRO S.A. - Sistema de Pedidos
-- Esquema Supabase PostgreSQL
-- Ejecutar completo en: Supabase → SQL Editor → New Query
-- ============================================================

-- Usuarios (autenticación propia)
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Clientes
CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  store_name  TEXT,
  ruc         TEXT,
  phone       TEXT,
  city        TEXT,
  email       TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Proveedores
CREATE TABLE IF NOT EXISTS providers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Configuración global de la aplicación
CREATE TABLE IF NOT EXISTS app_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Productos
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  brand       TEXT,
  provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
  season      TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Variantes de producto: cada combinación Color × Talla con sus precios
-- El precio varía por talla; el mismo color puede tener múltiples tallas
CREATE TABLE IF NOT EXISTS product_variants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color       TEXT NOT NULL,
  size        TEXT NOT NULL,
  sale_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  cost_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, color, size)
);

-- Secuencia y función para numeración de pedidos
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

CREATE OR REPLACE FUNCTION next_order_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'PED-' || LPAD(nextval('order_number_seq')::TEXT, 4, '0');
END;
$$;

-- Pedidos
CREATE TABLE IF NOT EXISTS orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE NOT NULL DEFAULT next_order_number(),
  client_id    UUID REFERENCES clients(id) ON DELETE SET NULL,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  provider_id  UUID REFERENCES providers(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'sent')),
  season       TEXT,
  shipping_date DATE,
  discount_pct NUMERIC(5,2) DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  observation  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Ítems de pedido (snapshot de precios al momento de crear el pedido)
CREATE TABLE IF NOT EXISTS order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_variant_id  UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  unit_sale_price     NUMERIC(10,2) NOT NULL,
  unit_cost_price     NUMERIC(10,2) NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DATOS INICIALES
-- ============================================================

INSERT INTO app_config (key, value) VALUES
  ('current_season', 'Verano 2026'),
  ('company_name', 'FASTRO S.A.')
ON CONFLICT (key) DO NOTHING;

-- Usuario administrador por defecto
-- Contraseña inicial: Admin2024!
-- SHA-256 de "Admin2024!" generado con pgcrypto
INSERT INTO users (name, email, password_hash, role)
VALUES ('Administrador', 'admin@fastro.com',
        encode(digest('Admin2024!', 'sha256'), 'hex'), 'admin')
ON CONFLICT (email) DO NOTHING;

-- ============================================================
-- SEGURIDAD: Deshabilitar RLS (herramienta interna de empresa)
-- Si expones la app al público, habilita RLS con políticas.
-- ============================================================
ALTER TABLE users           DISABLE ROW LEVEL SECURITY;
ALTER TABLE clients         DISABLE ROW LEVEL SECURITY;
ALTER TABLE providers       DISABLE ROW LEVEL SECURITY;
ALTER TABLE products        DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders          DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_items     DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_config      DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- MIGRACIONES (ejecutar solo una vez si la tabla ya existe)
-- ============================================================
-- Permisos generales
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_see_cost          BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_export_excel      BOOLEAN DEFAULT false;
-- Dashboard
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_dashboard    BOOLEAN DEFAULT true;
-- Pedidos
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_orders       BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_orders     BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_orders       BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_delete_orders     BOOLEAN DEFAULT true;
-- Clientes (era admin-only, por eso default false)
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_clients      BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_clients    BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_clients      BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_delete_clients    BOOLEAN DEFAULT false;
-- Productos
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_products     BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_products     BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_delete_products   BOOLEAN DEFAULT false;
-- Proveedores
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_providers    BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_providers  BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_providers    BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_delete_providers  BOOLEAN DEFAULT true;
-- Reportes
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_reports      BOOLEAN DEFAULT true;
