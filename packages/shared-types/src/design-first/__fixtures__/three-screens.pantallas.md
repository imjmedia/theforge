# Pantallas (Design-First)

> Generado determinísticamente desde `designSpec`.

## Home dashboard (`home`)

- **Ruta:** `/`
- **Estática:** sí
- **Componentes:** (ninguno)

## Order detail (`order-detail`)

- **Ruta:** `/orders/:id`
- **Propósito:** View and edit a single order
- **Componentes:** order-form

## Order list (`order-list`)

- **Ruta:** `/orders`
- **Propósito:** Browse and filter orders
- **Componentes:** orders-table, btn-new-order

## Navegación

| Desde | Hacia | Evento |
|:------|:------|:-------|
| `home` | `order-list` | linkClick |
| `order-list` | `order-detail` | rowActivate (orders-table) |
