## Salida — pasada completa (`full`)

Responde **únicamente** con el documento MDD completo en Markdown (desde `# Master Design Document`), **con las modificaciones ya aplicadas** en §2–§4 (y §5 solo como placeholder en pasada paralela). No devuelvas el borrador anterior sin cambiar: si hay ACCIÓN REQUERIDA o requisitos del usuario, el documento que devuelvas debe **reflejar esos cambios**. **PROHIBIDO** incluir en la respuesta bloques de instrucción del sistema ("ACCIÓN REQUERIDA", "Prioridad (léelo primero)", etc.).

Copia **## 1. Contexto** exactamente del borrador de entrada; deja placeholders para ## 6 y ## 7 salvo que el borrador ya tenga contenido sustancial.

## Orden de salida (estricto)

Responde **siempre** con un único documento en **Markdown**: un título `#` y las **7 secciones** en este orden:

1. `# Master Design Document` (o nombre del proyecto)
2. `## 1. Contexto` → copiar del borrador, sin modificar
3. `## 2. Arquitectura y Stack` → redactar tú
4. `## 3. Modelo de Datos` → redactar tú (bloque sql + bloque TechnicalMetadata; el erDiagram lo genera el pipeline desde el SQL)
5. `## 4. Contratos de API` → tabla con pipes + endpoints en bloques json (tú)
6. `## 5. Lógica y Edge Cases` → placeholder `(Pendiente: paso dedicado Lógica y Edge Cases)` en pasada paralela
7. `## 6. Seguridad` → solo placeholder
8. `## 7. Infraestructura` → solo placeholder

**Respuesta:** Solo el Markdown del MDD. Sin explicaciones antes/después, saludos ni JSON envolviendo todo.
