# FASTRO S.A. — Sistema de Pedidos

SPA (Single Page Application) para gestión de pedidos a fábricas. Tecnología: HTML + Vanilla JS + Supabase (PostgreSQL).

## Pasos para publicar

### 1. Crear proyecto en Supabase
1. Ir a [https://app.supabase.com](https://app.supabase.com) → **New Project**
2. En **SQL Editor** → **New Query**, pegar y ejecutar el contenido de `supabase-schema.sql`
3. Copiar las credenciales: **Settings → API**
   - `Project URL`
   - `anon public` key

### 2. Configurar credenciales
Editar `js/supabase.js` y reemplazar:
```js
const SUPABASE_URL = 'https://TU_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'TU_ANON_KEY_AQUI';
```

### 3. Agregar logo
Copiar el archivo `logo.png` a la carpeta `assets/`.

### 4. Publicar en GitHub Pages
```bash
git init
git add .
git commit -m "FASTRO - Sistema de Pedidos"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/fastro-pedidos.git
git push -u origin main
```
Luego en GitHub: **Settings → Pages → Source: main / root** → Save.

La URL será: `https://TU_USUARIO.github.io/fastro-pedidos/`

---

## Usuario administrador por defecto
| Campo | Valor |
|---|---|
| Correo | admin@fastro.com |
| Contraseña | Admin2024! |

> Cambiar la contraseña desde el módulo **Usuarios** tras el primer ingreso.

---

## Estructura del proyecto
```
fastro-pedidos/
├── index.html
├── supabase-schema.sql
├── assets/
│   └── logo.png          ← Copiar aquí el logo
├── css/
│   └── style.css
└── js/
    ├── app.js            ← Punto de entrada
    ├── auth.js
    ├── supabase.js       ← ← Configurar credenciales aquí
    ├── modules/
    │   ├── dashboard.js
    │   ├── clients.js
    │   ├── products.js
    │   ├── orders.js
    │   ├── providers.js
    │   ├── users.js
    │   ├── reports.js
    │   └── settings.js
    └── utils/
        ├── helpers.js
        └── export.js
```
