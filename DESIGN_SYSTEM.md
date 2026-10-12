# Sistema de Diseño — DistriBelleza ERP

Documento vivo que describe los tokens, patrones y reglas de estilo utilizadas
en toda la aplicación. La **fuente única de verdad** de los tokens vive en
`app/globals.css`; este archivo los referencia y documenta su aplicación.

> Inspirado en el módulo de Reportes (`components/Reports/ReportsView.tsx`) y
> generalizado al resto del sistema.

---

## 1. Resoluciones objetivo

La aplicación está optimizada para pantallas de escritorio en el punto de
venta (POS). El sidebar colapsa en resoluciones chicas pero la app está
pensada **primero para computadoras de escritorio**, no para móvil.

| Breakpoint | Ancho | Comportamiento |
|---|---|---|
| **xl2** | ≥ 1920 px | Monitores 2K/4K. Layout base, más espacio horizontal. |
| **xl** | ≥ 1440 px | Monitor estándar 1080p+. Layout completo, sidebar 240px. |
| **lg** | ≥ 1280 px | Laptop estándar. Layout base. |
| **md** | ≥ 1024 px | Laptop chica / tablet horizontal. **Sidebar colapsa a 80px (solo iconos).** |
| **sm** | ≤ 768 px | Tablet vertical / móvil. **Sidebar pasa a barra horizontal** arriba. KPI en 1 columna. |
| **xs** | ≤ 640 px | Móvil chico. Modo degradado. |

### Reglas por breakpoint (CSS actual en `globals.css` + `Dashboard.css`)

```css
/* globals.css línea 224: padding estándar del main-content */
.main-content:not(.pos-active) {
  padding: var(--space-6) var(--space-8);   /* 24px / 32px */
  padding-bottom: var(--space-12);          /* 48px */
}

/* Dashboard.css: sidebar colapsa en pantallas chicas */
@media (max-width: 1024px) { /* md */ .sidebar { width: 80px; } }
@media (max-width: 768px)  { /* sm */ .sidebar { width: 100%; flex-direction: row; } }
```

---

## 2. Colores

Paleta principal **indigo** (`#6366f1`) como color de marca, sobre fondos
neutros slate (`#f1f5f9`).

### 2.1 Colores de marca y estado

| Token | Valor | Uso |
|---|---|---|
| `--color-primary` | `#6366f1` | Botones primarios, iconos de página, acentos |
| `--color-primary-dark` | `#4f46e5` | Hover de botones primarios |
| `--color-primary-light` | `#818cf8` | Tints, sidebar en modo plataforma |
| `--color-primary-bg` | `#f5f3ff` | Fondo suave de iconos de header |
| `--color-primary-bg-dark` | `#ede9fe` | Fondo hover de chips |
| `--color-primary-fg` | `#ffffff` | Texto sobre `primary` |
| `--color-primary-ring` | `rgba(99,102,241,.1)` | Anillo de focus |

### 2.2 Estado

| Token | Valor | Uso |
|---|---|---|
| `--color-success` / `-dark` / `-light` | `#10b981` / `#059669` / `#dcfce7` | Confirmaciones, KPI comisionado, audit-item.success |
| `--color-warning` / `-dark` / `-light` | `#f59e0b` / `#d97706` / `#fef3c7` | Alertas, badges warning |
| `--color-danger` / `-dark` / `-light` | `#ef4444` / `#dc2626` / `#fee2e2` | Errores, ventas canceladas, gastos |
| `--color-info` / `-bg` | `#3b82f6` / `#dbeafe` | Información, KPI de ventas |

### 2.3 Neutros (Tailwind slate)

| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `#f1f5f9` | Fondo de la app |
| `--color-bg-soft` | `#f8fafc` | Fondo de cards y zonas de input |
| `--color-bg-softer` | `#fafbfc` | Inputs |
| `--color-text` | `#0f172a` | Texto principal (títulos) |
| `--color-text-soft` | `#1e293b` | Texto de cards |
| `--color-text-mid` | `#334155` | Labels |
| `--color-text-mute` | `#64748b` | Subtítulos, descripciones |
| `--color-text-light` | `#94a3b8` | Iconos secundarios |
| `--color-text-faint` | `#cbd5e1` | Texto casi invisible |
| `--color-border` | `#e2e8f0` | Borde estándar |
| `--color-border-soft` | `#f1f5f9` | Borde suave |
| `--color-border-mid` | `#cbd5e1` | Borde medio (scrollbar) |

### 2.4 Backgrounds semánticos

```css
--bg-card: #ffffff;         /* card principal */
--bg-card-soft: #f8fafc;    /* card interna */
--bg-input: #ffffff;        /* input */
--bg-error: #fef2f2;        /* fondo error */
--bg-success: #f0fdf4;      /* fondo success */
--bg-warning: #fef3c7;      /* fondo warning */
```

---

## 3. Tipografía

**Familia**: Inter (sans-serif del sistema, fallback). Courier New solo en
los recibos térmicos.

### 3.1 Escala

| Token | Valor | Uso |
|---|---|---|
| `--font-xs` | `0.65rem` (10.4px) | tag-*, badges muy chicos |
| `--font-sm` | `0.75rem` (12px) | labels, descripciones, alerts |
| `--font-base` | `0.875rem` (14px) | texto base, botones, inputs |
| `--font-md` | `1rem` (16px) | texto por defecto del navegador |
| `--font-lg` | `1.25rem` (20px) | títulos de modal |
| `--font-xl` | `1.5rem` (24px) | KPI numéricos |
| `--font-2xl` | `1.75rem` (28px) | títulos de página (`page-title-block h1`) |
| `--font-3xl` | `2rem` (32px) | hero, números grandes |

### 3.2 Pesos

```css
--font-weight-normal: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
--font-weight-bold: 700;
--font-weight-black: 800;
```

### 3.3 Espaciado de letras

```css
.page-title-block h1 { letter-spacing: -0.025em; }
```

---

## 4. Espaciado

Escala de 4px. **Usá siempre tokens, nunca valores sueltos.**

| Token | Valor | Uso típico |
|---|---|---|
| `--space-1` | `4px` | gap interno mínimo, paddings de tags |
| `--space-2` | `8px` | gap chico entre icon y label |
| `--space-3` | `12px` | gap estándar, padding de inputs, gap de botones |
| `--space-4` | `16px` | padding chico de cards, gap de listas |
| `--space-5` | `20px` | padding de audit-item |
| `--space-6` | `24px` | padding estándar de cards, gap entre cards |
| `--space-8` | `32px` | padding grande, gap de dashboard-content |
| `--space-10` | `40px` | separación grande |
| `--space-12` | `48px` | padding inferior de main-content |
| `--space-16` | `64px` | hero / spacing extremo |

---

## 5. Radios (border-radius)

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | `4px` | tags |
| `--radius-md` | `6px` | skeletons, scrollbar |
| `--radius-base` | `8px` | inputs, chips, page-date-chip |
| `--radius-lg` | `12px` | botones, badges, audit-items |
| `--radius-xl` | `16px` | cards estándar (`ui-card`, KPI cards) |
| `--radius-2xl` | `20px` | modales, audit-footer |
| `--radius-3xl` | `24px` | cards grandes (Reports, Dashboard) |
| `--radius-full` | `999px` | chips, scrollbar, avatares |

---

## 6. Sombras

| Token | Valor | Uso |
|---|---|---|
| `--shadow-sm` | `0 2px 4px rgba(0,0,0,.04)` | hover sutil |
| `--shadow-md` | `0 4px 8px rgba(0,0,0,.05)` | hover de cards |
| `--shadow-lg` | `0 10px 15px -3px rgba(0,0,0,.08)` | dropdowns |
| `--shadow-xl` | `0 25px 50px -12px rgba(0,0,0,.25)` | modales |
| `--shadow-primary` | `0 8px 24px rgba(99,102,241,.35)` | hover botón primario |
| `--shadow-success` | `0 8px 24px rgba(16,185,129,.35)` | hover botón success |

---

## 7. Layout y contenedores

### 7.1 Layout principal

```
┌─────────┬─────────────────────────────────────────┐
│         │                                         │
│ sidebar │            main-content                 │
│  240px  │    (padding: 24px h, 32px v)           │
│         │    max-width: 1400px (layout)           │
│         │                                         │
└─────────┴─────────────────────────────────────────┘
```

```css
.dashboard-layout { display: flex; min-height: 100vh; }
.main-content { flex: 1; overflow-y: auto; height: 100vh; }
.main-content:not(.pos-active) {
  padding: var(--space-6) var(--space-8);   /* 24 32 */
  padding-bottom: var(--space-12);
}
```

### 7.2 Sidebar

```css
.sidebar { width: 260px; padding: var(--space-6); }
```

### 7.3 Anchos máximos

```css
--layout-sidebar-width: 240px;
--layout-content-max-width: 1400px;   /* contenedor de página */
--layout-modal-sm: 400px;
--layout-modal-max-width: 560px;      /* modal estándar */
--layout-modal-lg: 720px;
```

### 7.4 Grids

Patrones según densidad de información:

```css
/* Dashboard KPIs (autoadaptativo) */
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-6); }

/* Reports KPIs (forzado 2 columnas) */
.kpi-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-6); }

/* Reports method-grid (4 columnas fijas) */
.method-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-3); }

/* Report general layout (ancho fijo centrado) */
.report-grid { max-width: 1000px; margin: 0 auto; }
```

---

## 8. Componentes base (en `globals.css`)

### 8.1 Page Header (todos los módulos)

Patrón estándar. **No repetir inline styles.**

```html
<header class="page-header">
  <div class="page-header-group">
    <div class="page-title-icon"><Icon size={28} /></div>
    <div class="page-title-block">
      <h1>Título</h1>
      <p>Subtítulo</p>
    </div>
  </div>
  <button class="btn-primary-page">Acción</button>
</header>
```

```css
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-8);
  flex-wrap: wrap;
  gap: var(--space-4);
}
.page-header-group { display: flex; align-items: center; gap: var(--space-4); }
.page-title-icon {
  background: var(--color-primary-bg);
  color: var(--color-primary);
  padding: var(--space-3);
  border-radius: var(--radius-lg);
  display: flex; align-items: center; justify-content: center;
}
.page-title-block h1 {
  font-size: var(--font-2xl);          /* 28px */
  font-weight: var(--font-weight-bold);
  color: var(--color-text);
  letter-spacing: -0.025em;
  margin: 0;
}
.page-title-block p {
  font-size: var(--font-base);
  color: var(--color-text-mute);
  margin: var(--space-1) 0 0;
}
```

### 8.2 Botones

```css
.ui-btn { padding: var(--space-3) var(--space-6); border-radius: var(--radius-lg); ... }
.ui-btn-primary    { background: var(--color-primary);    color: var(--color-primary-fg); }
.ui-btn-secondary  { background: var(--color-bg);         color: var(--color-text-mid); }
.ui-btn-danger     { background: var(--color-danger);     color: var(--color-primary-fg); }

.btn-primary-page  { padding: var(--space-3) var(--space-6); border-radius: var(--radius-lg); background: var(--color-primary); }
.btn-success-page  { background: var(--color-success); }
.btn-danger-page   { background: var(--color-danger); }

/* Hover: translateY(-2px) + box-shadow */
.ui-btn-primary:hover:not(:disabled) { background: var(--color-primary-dark); transform: translateY(-2px); box-shadow: var(--shadow-primary); }
```

### 8.3 Inputs

```css
.ui-input {
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  font-size: var(--font-base);
  background: var(--bg-input);
}
.ui-input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(99,102,241,.1); }

.ui-label { display: block; font-size: var(--font-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-mid); margin-bottom: var(--space-2); }
.ui-field { display: flex; flex-direction: column; }
```

### 8.4 Modales

```html
<div class="ui-modal-overlay">
  <div class="ui-modal-window ui-modal-md">
    <div class="ui-modal-header"><h3>…</h3><button class="ui-modal-close">✕</button></div>
    <div class="ui-modal-body">…</div>
    <div class="ui-modal-footer">…</div>
  </div>
</div>
```

```css
.ui-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(8px);
  display: flex; justify-content: center; align-items: center;
  z-index: 1000;
  animation: ui-modal-fade-in var(--transition-slow);
}
.ui-modal-window {
  background: var(--bg-card);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  max-height: 90vh;
  overflow-y: auto;
  animation: ui-modal-pop var(--transition-bounce);
}
.ui-modal-sm { width: 100%; max-width: var(--layout-modal-sm); }     /* 400 */
.ui-modal-md { width: 100%; max-width: var(--layout-modal-max-width); } /* 560 */
.ui-modal-lg { width: 100%; max-width: var(--layout-modal-lg); }       /* 720 */
.ui-modal-danger { border-top: 4px solid var(--color-danger); }
```

### 8.5 Cards

```css
.ui-card {
  background: var(--bg-card);
  border-radius: var(--radius-xl);   /* 16px */
  border: 1px solid var(--color-border);
  padding: var(--space-6);
  transition: all var(--transition-base);
}
.ui-card-hoverable:hover { border-color: var(--color-primary); box-shadow: var(--shadow-md); }
```

Patrón grande (Reports, Dashboard): `border-radius: 24px`, `padding: 32px`.

### 8.6 Tags

```css
.tag-primary, .tag-success, .tag-warning, .tag-danger {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
}
```

### 8.7 Alerts

```css
.ui-alert { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-radius: var(--radius-base); font-size: var(--font-sm); }
.ui-alert-danger  { background: var(--color-danger-light);  color: var(--color-danger-dark);  border: 1px solid var(--color-danger); }
.ui-alert-success { background: var(--color-success-light); color: var(--color-success-dark); border: 1px solid var(--color-success); }
.ui-alert-warning { background: var(--color-warning-light); color: var(--color-warning-dark); border: 1px solid var(--color-warning); }
```

### 8.8 Estado vacío

```css
.ui-empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: var(--space-12) var(--space-6);
  color: var(--color-text-light);
  text-align: center;
  gap: var(--space-3);
}
```

---

## 9. Skeletons & animaciones

```css
.skeleton-box {
  background: linear-gradient(90deg, var(--color-bg) 25%, var(--color-border) 50%, var(--color-bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s infinite;
  border-radius: var(--radius-md);
}
.skeleton-effect { opacity: 0.7; pointer-events: none; }

@keyframes skeleton-loading { from { background-position: 200% 0; } to { background-position: -200% 0; } }

.animate-fade-in { animation: fadeIn 0.3s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
```

---

## 10. Transiciones

```css
--transition-fast: 0.1s ease;
--transition-base: 0.2s ease;        /* default en todo */
--transition-slow: 0.3s ease;
--transition-bounce: 0.4s cubic-bezier(0.16, 1, 0.3, 1);  /* modales */
```

```css
.transition-fast { transition: all var(--transition-fast); }
.transition-base { transition: all var(--transition-base); }
.transition-slow { transition: all var(--transition-slow); }
```

---

## 11. Focus y accesibilidad

```css
*:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
```

Inputs en focus:
```css
box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
```

---

## 12. Reglas de uso

### 12.1 Hacer

- **Siempre usar tokens CSS**. No hardcodear hex ni píxeles sueltos.
- **Usar `var(--space-N)`** para todo padding, margin, gap.
- **`globals.css` es la única fuente** de tokens. Cualquier nuevo token se
  agrega ahí y se documenta en este archivo.
- **Page headers** usan la estructura estándar (page-header →
  page-header-group → page-title-icon + page-title-block).
- **Cards grandes** en 24px radius, padding 32px.
- **Cards chicas** en 16px radius, padding 24px.
- **Modales** usan `.ui-modal-overlay / .ui-modal-window` con sus tamaños.
- **Botones de página** usan `.btn-primary-page` (no inline styles).
- **Botones secundarios** usan `.ui-btn-secondary`.
- **Inputs** usan `.ui-input` con su label `.ui-label`.

### 12.2 No hacer

- ❌ `style={{ color: '#6366f1' }}` → usar variable o class.
- ❌ `style={{ padding: '24px' }}` → usar `var(--space-6)`.
- ❌ `style={{ borderRadius: '12px' }}` → usar `var(--radius-lg)`.
- ❌ Inline styles para repetir patrones → crear utility class en globals.css.
- ❌ Crear un page-header con estructura custom → respetar el patrón.

### 12.3 Auditoría rápida

```bash
# Buscar colores hardcodeados
grep -rn "#[0-9a-fA-F]\{3,8\}" components/ app/ --include="*.tsx" --include="*.ts"

# Buscar px sueltos en styles
grep -rn "padding: '[0-9]" components/ --include="*.tsx"
```

---

## 13. Catálogo visual

### Reportes (referencia)
```
- Header: page-header + page-title-icon + page-title-block
- KPI row: 2 columnas (1fr 1fr), gap 24px, padding 24px, radius 24px
  - KPI icon: 48px square, radius 16px, fondo #f8fafc
  - border-left 4px (color según estado: blue / gray / green)
- Card principal: padding 32px, radius 24px, border #e2e8f0, shadow sm
  - Audit-divider: font-xs uppercase, color #94a3b8
  - Method-grid: 4 columnas fijas, padding 16px, radius 16px
  - Audit-item: padding 14px 16px, radius 12px, bg #f8fafc
    - .success → bg #f0fdf4, text #15803d
    - .danger → bg #fef2f2, text #b91c1c
  - Audit-footer: padding 24px, bg #0f172a, radius 20px, texto blanco
```

### Dashboard (referencia)
```
- Sidebar 260px, padding 24, fondo #0f172a, texto blanco
  - Links 16 padding 12-16, radius 8
  - Link activo: fondo primary, texto blanco
- KPI grid: auto-fit minmax(280, 1fr), gap 24
- KPI card: padding 24, radius 12, border #e2e8f0
- KPI icon: 56px square, radius 12, fondo tinted
- Goal section: padding 32, radius 12, border #e2e8f0
- Progress bar: 12px alto, radius 6
```

### POS (referencia)
```
- Layout full-bleed (padding: 0 en .pos-active)
- Status bar: header superior
- Pos grid: main + sidebar
- Modales full-screen con .dark-blur
```

---

## 14. Próximos pasos

- [ ] Migrar `<input>` nativos a `.ui-input` en módulos pendientes.
- [ ] Migrar botones inline a `.ui-btn` family en Inventory, Suppliers, etc.
- [ ] Crear variante `.ui-card-lg` con padding 32px y radius 24px.
- [ ] Auditar inputs con `style=` inline y mover a `.ui-input`.
- [ ] Documentar patrones de tabla (Reports, Suppliers, Inventory).
- [ ] Crear Storybook / documentación visual con ejemplos de cada componente.

---

**Mantener este archivo sincronizado con `app/globals.css` cuando se
agreguen nuevos tokens.**