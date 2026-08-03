# Reglas SDD — UI/UX accionable para implementación

Estas reglas aplican al generar o regenerar entregables SDD con superficie UI (Workshop, doc-reconcile, implement-from-spec).

## Stack UI (sin hardcode de vendor)

- **Con MCP gráfico activo:** nombres exactos del **catálogo del MCP conectado** (resuelvo vía `resolve_component` / `pantallas.md`). No asumir Kreo ni otro vendor si no es el MCP activo.
- **Sin MCP gráfico:** base **shadcn/ui + Tailwind** (o stack declarado en MDD/Blueprint legacy); tokens en `design-system.md`; componentes genéricos documentados en `pantallas.md`.
- **Stack fallback (orden):** MCP gráfico activo → librería declarada en MDD §2 → **MUI + adapter `packages/ui`** → **shadcn/Tailwind preset** (`colorSource: system-default`).
- **Prohibido** mezclar tokens de fuentes distintas (Stitch, Ariadne, MCP externo, shadcn custom) sin declarar cuál manda en **## Tema canónico**.

## Multi-superficie (producto + admin + tools)

| Superficie | Shell | Notas |
|------------|-------|-------|
| Producto / app | `AppShell` | Nav por rol JWT; journeys de usuario final |
| Admin / backoffice | `AdminShell` | Mismas tokens DS; nav densa; tablas admin |
| Tools / internal | `ToolShell` opcional | Solo si MDD §2 lo declara |

- **Mismo design system** en todas las superficies (`design-system.md` único).
- Documentar shells en `pantallas.md` § Layout transversal y en tasks Frontend (`Surface:`).

## Adapter `packages/ui` (monorepo generado)

- **Prohibido** importar vendor UI (`@mui/material`, `@radix-ui/*`, etc.) directamente en `apps/*`.
- **Obligatorio:** consumir solo `@scope/ui` (adapter documentado en Blueprint §2 / MDD §2).
- El adapter re-exporta primitivos del stack elegido; tokens vienen de `design-system.md`.

## Colores no determinados (sin marca)

- Si el cliente **no** aporta paleta: `colorSource: system-default` en YAML frontmatter.
- Aplicar **preset completo del stack** (shadcn zinc, MUI default, tailwind slate) — **prohibido** inventar hex sueltos.
- Semánticos (`primary`, `destructive`, …) referencian primitivos (`{primitives.zinc900}`).

## Tokens: primitivos + semánticos

- **Primitivos:** paleta base del preset (`zinc50`, `blue700`, …).
- **Semánticos:** `primary`, `background`, `foreground`, `muted`, `border`, `destructive`, `success`, `warning` — siempre referencian primitivos en YAML/components.
- Un solo bloque activo en `design-system.md`; anexo catálogo **no** duplica tokens.

## Criterios de aceptación (regeneración exitosa)

- Un agente puede implementar **solo con docs locales** sin inventar rutas ni colores.
- `pantallas.md` cubre **100%** de rutas en user stories con componente + API verificables.
- **Cero** endpoints UI referenciados que no estén en `api-contracts.md`.
- **Un solo** bloque de tokens activo en `design-system.md`.
- Tasks UI son **atómicas** (1 pantalla ≈ 1 tarea).
- Tablero tipo Kanban solo donde el journey lo justifique.
- Cada flujo crítico documenta `empty` / `loading` / `error`.
- Nav por rol documentada en layout shell (`AppLayout` o equivalente del stack).

## Una sola verdad visual

- Declara **un** tema canónico: `light` | `dark` | `system` + preset del stack (si el MCP expone presets) o tokens custom en YAML.
- Incluye `productionNote` si el tema desplegado difiere del diseño aspiracional.
- Tokens mínimos obligatorios en `design-system.md`: `primary`, `background`, `foreground`, `muted`, `border`, `destructive`, `success`, `warning` + tipografía + spacing (grid 8px) + radii + elevation.

## Pantallas, no entidades

- **No** mapees cada tabla del MDD a un componente UI de forma automática.
- Agrupa por **journeys de usuario** (roles del §1) y **pantallas** con ruta React Router.
- Pipeline arrastrable (Kanban) solo si el flujo es explícitamente columnas de estado visibles para el usuario final.
- Sesiones OTP, logs de auditoría y consumo de tokens **no** son Kanban.

## Endpoints reales

- Cada pantalla debe referenciar endpoints de **api-contracts.md** existentes.
- **Prohibido** inventar `GET /api/v1/{tabla}` genéricos si no están en contratos.
- Si un CRUD admin no existe en v1, márcalo `fuera de alcance v1` en `pantallas.md`.

## Componentes explícitos (catálogo del stack)

- Nombre **exacto** según MCP activo o convención shadcn/ui documentada en `pantallas.md` (p. ej. `DataTable`, `Button`, `Dialog`, `Form`, `Table`, `EmptyState`).
- Por pantalla: lista de componentes + props mínimas (columnas, fields, actions).
- Si hay MCP gráfico: indicar import path / paquete cuando el MCP lo devuelva en `resolve_component`.

## Estados por pantalla crítica

Para login, dashboard, listados principales, formularios y flujos con side-effects:

| Estado | Requisito |
|--------|-----------|
| `loading` | skeleton o spinner con altura reservada (evitar CLS) |
| `empty` | estado vacío con CTA contextual |
| `error` | mensaje + reintento; códigos API documentados |
| `success` | toast/feedback + navegación siguiente paso |
| `disabled` | reglas de negocio (OTP, quota, impersonación) |

## Navegación y roles

- Layout shell con ítems de nav por rol (`AppLayout` o equivalente).
- Rutas protegidas con guard JWT (`role`, `tenant_id`).
- Banners/modales transversales documentados (impersonación, quota LLM 80%/100%).

## Responsive (obligatorio web)

- **Mobile-first**; breakpoints: sm 640, md 768, lg 1024, xl 1280.
- Tablas densas → vista móvil en cards o stack bajo `md`.
- Touch targets ≥ 44×44px; WCAG AA; **sin scroll horizontal**.
- Cada fila de `pantallas.md` incluye columnas **Layout** + **Responsive**.
- Cada task Frontend incluye línea `Responsive:` y opcional `Surface: product|admin`.

## Layout

- Grid **8px**; shells documentados (`AppShell`, `AdminShell`).
- Nav por rol; modales globales en § Layout transversal de pantallas.

## Prioridad entre artefactos (conflictos)

1. **MDD** — constitución.
2. **`pantallas.md`** — mapa pantalla→ruta→componente→API (gana sobre Blueprint §8 heurístico).
3. **`design-system.md`** — tokens visuales (única SSOT de tema).
4. **Blueprint §8** — alineado a `pantallas.md`, no CRUD genérico por entidad.
5. **User Stories / Tasks** — trazables a pantallas concretas, no a tablas sueltas.

---

## Formato obligatorio: `design-system.md` / uxUiGuide

Frontmatter YAML válido (sin bloques ``` rotos). **Una sola paleta canónica.**

Estructura obligatoria tras el YAML:

1. **## Tema canónico** — `mode`, preset del stack (si aplica), `stackBase` (`shadcn/ui`, MCP `{libraryName}`, etc.), `productionNote` opcional.
2. **## Tokens** — tabla `| Token | Valor | Uso |` con primary, background, foreground, muted, border, destructive, success, warning.
3. **## Tipografía** — familias, escala, line-height.
4. **## Spacing** — grid 8px (sm/md/lg/xl).
5. **## Radii** — sm, md, lg, full.
6. **## Elevation** — niveles de sombra/z-index.
7. **## Componentes base** — Button, Card, Input, Badge con tokens referenciados (`{colors.primary}`, no hex duplicado).
8. **## Do's and Don'ts** + **## Accesibilidad** — WCAG AA, foco, teclado, 44×44px.

**Anexo catálogo (opcional):** componentes usados en `pantallas.md` — **no duplicar tokens**.

---

## Formato obligatorio: MDD § UI/UX Design Intent

**Prohibido:** tabla entidad→componente heurística, `Entity Classification`, `GET /api/v1/{tabla}` genéricos.

Estructura obligatoria:

1. **### Personas y journeys** — 2–4 párrafos por rol/journey (quién, objetivo, flujo principal).
2. **### Matriz pantalla→componente** — tabla resumen; detalle ejecutable en `pantallas.md` (Ruta | Componentes UI | API | Estados).
3. **### Reglas de composición**
   - Formularios = componente formulario del stack + Zod (schema compartido con DTO API).
   - Listados = tabla + filtros + paginación (nombres según catálogo activo).
   - Dashboard = KPIs + gráficas según catálogo activo.
4. **### Componentes transversales** — layout shell, empty state, toast, modales globales.
5. **### Fuera de alcance UI v1** — lista explícita (CRUD admin sin contrato, Kanban no justificado, etc.).

---

## Formato obligatorio: User Stories — criterios UI

Por cada US con superficie UI, sección obligatoria:

```markdown
### 🎨 Criterios UI
- **Ruta:** `/...`
- **Componentes:** {nombres del catálogo activo o shadcn}
- **AC-UI1:** En viewport < md, la tabla se muestra como cards apiladas
- **AC-UI2:** Estado vacío muestra EmptyState con botón "Crear primera estrategia"
- **AC-UI3:** Error 429 OTP muestra countdown de bloqueo 15 min
```

Incluir endpoint(s) de `api-contracts.md` en AC cuando aplique.

---

## Formato obligatorio: Tasks — desglose UI

Sustituir tareas genéricas tipo «Implementar frontend» por tareas atómicas:

```markdown
- [ ] [P] UI `/strategies` — DataTable + StrategyForm + PaginationBar (US-003)
  - **Surface:** product
  - **Archivos:** apps/frontend/src/pages/StrategiesPage.tsx, ...
  - **Responsive:** sm cards · md table · lg sidebar+content
  - **Estados:** empty, loading, error
  - **API:** GET/POST/PUT /strategies
  - **DS:** tokens §design-system; componentes vía `@scope/ui` §pantallas
```

Una tarea = una pantalla o flujo modal acotado.

---

## Formato obligatorio: `pantallas.md`

Entregable `{featureDir}/pantallas.md` + espejo `docs/sdd/pantallas.md`:

```markdown
# Pantallas — {nombre proyecto}

## {Rol} ({claims JWT})

| Ruta | Página | US | Componentes UI | API principal | Estados | Layout | Responsive |
|------|--------|-----|----------------|---------------|---------|
| /login | LoginPage | US-001 | Form, Input, Button | POST /auth/login | loading, error, locked |

## Layout transversal
- AppLayout (o shell equivalente): nav items, iconos, orden
- Modales globales: {nombre, trigger, componente}

## Fuera de alcance v1
- Lista explícita
```

Columna **Componentes UI:** nombres del MCP gráfico activo al generar; si no hay MCP, convención shadcn/ui + primitivos documentados.

---

## Anexo opcional: `ui-project.json`

Solo si el **MCP gráfico activo** expone instrucciones de prototipo (p. ej. tool `validate_ui_project_instructions`). Generar `{featureDir}/ui-project.json` con:

- `context.navigation.primaryItems` por rol
- `screens[]` con `key`, `title`, `ui.layout`, `ui.sections[]`
- `states[]` por pantalla crítica
- `constraints.preferredComponents` alineados a `pantallas.md`

**No duplicar tokens** — referenciar `design-system.md` para tema. **Sin MCP con soporte de prototipo:** omitir este archivo.
