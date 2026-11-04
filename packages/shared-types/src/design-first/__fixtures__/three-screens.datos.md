# Datos (Design-First)

> Entidades y necesidades de datos del `designSpec`.

## Entidades

| Id | Nombre | REST |
|:---|:-------|:-----|
| `customer` | Customer | `/api/v1/customers` |
| `order` | Order | `/api/v1/orders` |

## Necesidades de datos

### Pantalla `order-detail`

- **Estados:** empty, error, loading
- **Componente `order-form`:**
  - `need-customer-label` (string) → entidad `customer`
  - `need-order-record` (Order) → entidad `order`

### Pantalla `order-list`

- **Estados:** empty, error, loading
- **Componente `orders-table`:**
  - `need-orders-rows` (Order[]) → entidad `order`
