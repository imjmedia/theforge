# Master Design Document — esqueleto «constitución» (YAGNI)

Referencia para agentes y humanos: **solo** lo que el alcance (§1) ya nombra; sin dominio inventado. Las siete secciones canónicas se mantienen; el contenido crece con evidencia del usuario/Benchmark.

---

## 1. Contexto

- **Propósito y resultado de negocio** (una frase medible o criterio de éxito acotado).
- **Fronteras:** qué es core, qué es integración, qué queda fuera.
- **Audiencia técnica** del documento (quién lo consume).

### Mapa de contextos delimitados (DDD)

- **En alcance del MDD:** …
- **Colindantes (integración / solo lectura):** …
- **Fuera de alcance explícito:** …

### Actores del documento

- **Stakeholder de decisión:** …
- **Dueños de implementación:** …

### Glosario de dominio (Ubiquitous Language)

Solo términos **ya usados** en alcance o mensajes del usuario (tabla o lista `término → definición`).

### Bloqueantes de negocio (Human-in-the-Loop)

Ítems que bloquean diseño sin validación humana, o «Ninguno».

---

## 2. Arquitectura y Stack

- Decisiones **citadas en §1** o inferidas mínimamente (versión + **Decisión / ¿Por qué?** en 1–2 frases cada una).
- **Screaming Architecture:** estructura de módulos/carpetas alineada a capacidades nombradas en §1 (no raíz genérica vacía).
- Sin tecnologías que no aparezcan en §1 salvo estándar obvio del stack ya elegido (ej. TLS).

---

## 3. Modelo de Datos

- **Solo** entidades/atributos que **§1 o el glosario** exijan como fuente de verdad persistida.
- Bloque `sql` (PostgreSQL) coherente; si hay geo **solo si §1 lo pide**, extensiones `postgis` en el diseño y tipos `GEOMETRY`/`GEOGRAPHY` explícitos.
- `mermaid` `erDiagram` en paridad con el SQL (el pipeline lo genera desde el SQL; no redactar ER manual salvo excepción documentada).
- Grafo (FalkorDB, etc.) **solo si §2** ya lo fija **y** §1 describe relaciones que justifiquen nodos/aristas; si no, omitir o una línea «no aplica en alcance actual».

Bloques de código **a nivel de párrafo** (no dentro de viñetas):

```sql
-- DDL PostgreSQL (CREATE TABLE, REFERENCES, índices)
```

```TechnicalMetadata
[high_security]
```

---

## 4. Contratos de API

### 4.A API del producto (obligatoria)

Tabla GFM + endpoints que **este sistema expone** (mínimo salud + operaciones alineadas a §3 y capacidades de §1). Request/response en `json` con tipos; códigos 4xx/5xx donde aplique.

### 4.B Integraciones externas (opcional)

Solo si §1 nombra fuentes externas: referencia de contrato (rutas según proveedor, auth, límites). **No** sustituye §4.A.

---

## 5. Lógica y Edge Cases

**Profundidad mínima (~70% lista para senior)** sin que el usuario pida un prompt extra: **≥4** `###` (p. ej. Validación y calidad de datos; Resiliencia y terceros; Consistencia entre almacenes/pasos; Concurrencia, idempotencia y errores) **o** **≥8** viñetas sustantivas en esas áreas; **≥2** escenarios **Gherkin** para caminos críticos; cada **POST/PUT/PATCH**/job asíncrono de §4 con al menos una línea de comportamiento en §5.

- Reglas y fallos **derivados de §1–§4** (validación, idempotencia, límites de terceros si existen).
- **Gherkin** comprobable; no relleno genérico ni «se implementará» sin criterio.

---

## 6. Seguridad

Decisiones **acotadas al alcance**: transporte, secretos, auth si hay API expuesta, RBAC solo si hay actores/roles en §1. Sin exigir tablas de auditoría si §1 no pide trazabilidad persistida.

**Parámetros concretos obligatorios:** Para toda política de seguridad que el alcance mencione (bloqueo de cuentas, expiración de sesiones, MFA, contraseñas), usa valores de industria estándar (OWASP ASVS, NIST) cuando el usuario no especifique un número exacto. Ejemplos:
- Bloqueo por intentos fallidos: **5 intentos en 15 minutos** (OWASP ASVS V3.1.1, NIST SP 800-63B)
- Expiracion de refresh token: **7 días** (estándar OAuth 2.0)
- Sesión MFA: **24h** o hasta cerrar sesión
- Longitud mínima contraseña: **8 caracteres** (NIST SP 800-63B)
- Rate limiting login: **10 solicitudes/minuto por IP**
No dejes valores indefinidos ni frases genéricas como "número de intentos definido por política" — pon el valor estándar con referencias a OWASP/NIST.

---

## 7. Infraestructura

Subsecciones 7.1–7.4 + variables + CI/CD según prompt del Ingeniero de Integración. **Manifest JSON** al final: `stack`, `deployment` e `integration_metadata` deben **reflejar §2 y §3** (p. ej. extensiones de Postgres alineadas al SQL; orquestador Docker/Dokploy si §2 no impone Kubernetes).

---

## Idioma de encabezados

- Los **títulos y subtítulos** del MDD (incl. `**1.1. …**`, `###`) van en **español**. Si el usuario o el Benchmark aportan secciones en inglés, **traduce el encabezado** al español de producto/ingeniería; no copies literalmente títulos en inglés del brief.

## Prohibiciones (calidad del artefacto)

- No pegar instrucciones internas, herramientas ni JSON de ejemplo del prompt en el cuerpo del MDD.
- No duplicar el bloque «Manifest de Infraestructura».
- No mezclar `## 6. Seguridad` con subencabezados pegados sin salto de línea.
- §4 no puede ser **solo** terceros sin §4.A del producto.
