# MDD: Tienda en línea (borrador)

## 1. Contexto

This online store will allow customers to browse products and place orders. The system should be simple and the team must deliver it fast. The main goal is to sell clothes online and to track sales for the management team, with a clear workflow for every order.

## 2. Arquitectura y Stack

(Pendiente)

## 3. Modelo de Datos

El modelo tiene cuatro tablas principales para usuarios, productos, pedidos y líneas de pedido, con sus claves y restricciones básicas para la primera versión de la tienda.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL
);

CREATE TABLE products (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price_cents INTEGER NOT NULL
);

CREATE TABLE orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL
);

CREATE TABLE order_items (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL
);
```

## 4. Contratos de API

| Método | Ruta | Descripción |
|---|---|---|
| GET | /products | Listado de productos |
| POST | /cart/items | Agrega al carrito |
| GET | /orders/:id | Estado del pedido |

Las rutas siguen el estilo REST del proyecto y devuelven JSON en todas las respuestas, incluidos los errores de validación de cada endpoint del sistema.

## 5. Lógica y Edge Cases

Notifications are sent by WhatsApp to the customer when the order changes. The stock check should run before the payment, and the system must handle retries for every webhook that arrives twice.
