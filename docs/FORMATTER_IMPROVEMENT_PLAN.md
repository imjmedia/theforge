# Plan de Mejora: Formateador/Reparador Markdown

## Estado Actual

### Arquitectura Actual
- **Enfoque:** Transformaciones regex/string-based (~4000 líneas)
- **Archivos principales:**
  - `format-document-markdown.ts` (87 líneas) - Orquestador principal
  - `markdown-repair.ts` (176 líneas) - Reparación de fences
  - `markdown-table.ts` (315 líneas) - Normalización de tablas
  - `repair-pasted-markdown.ts` (898 líneas) - Reparaciones heurísticas
  - `repair-glued-headings.ts` (139 líneas) - Reparación de headings
  - `repair-infra-markdown.ts` (650 líneas) - Reparación de infraestructura
  - `repair-collapsed-sql.ts` (460 líneas) - Expansión de SQL
  - `repair-directory-tree.ts` (173 líneas) - Formato de árboles
  - `repair-flow-sections.ts` (227 líneas) - Prose a flowchart. **Eliminado** en el lote 2 de calidad del MDD (2026-11-03, ADR 0002): generaba diagramas desde viñetas y llamaba al reemplazo por webhook inventado

### Fortalezas
1. **Especialización en dominio:** Maneja mermaid, infraestructura, SQL colapsado
2. **Reparación de contenido roto:** Corrige markdown generado por LLMs
3. **Sin dependencias externas:** Solo TypeScript, sin remark/unified
4. **Rendimiento:** Transformaciones regex son rápidas para documentos grandes

### Debilidades
1. **Fragilidad:** Los regex pueden fallar con edge cases no previstos
2. **Mantenibilidad:** 4000+ líneas de regex son difíciles de mantener
3. **Testing:** Difícil probar combinaciones de transformaciones
4. **Parsing incompleto:** No maneja todos los casos válidos de markdown

## Inspiración de markdown-formatter

### Lo que hace bien markdown-formatter
1. **AST-based:** Usa remark para parsing estructurado
2. **Configuración:** Opciones granulares para cada regla
3. **GFM completo:** Soporta tablas, task lists, strikethrough
4. **TOC:** Generación automática de tabla de contenidos
5. **Watermark:** Opcional, para marcar documentos formateados

### Lo que NO hace markdown-formatter
1. **Reparación:** No corrige markdown roto
2. **Mermaid:** No tiene awareness de diagramas
3. **Infraestructura:** No maneja Dockerfile, docker-compose
4. **SQL:** No expande SQL colapsado
5. **Dominio TheForge:** No conoce MDD, BRD, etc.

## Plan de Mejora

### Fase 1: Adoptar remark como motor AST (2-3 semanas)

#### Objetivo
Reemplazar las transformaciones regex por parsing AST con remark, manteniendo las reparaciones heurísticas como pre/post processing.

#### Pasos
1. **Agregar dependencias:**
   ```bash
   npm install unified remark-parse remark-stringify remark-gfm remark-frontmatter
   ```

2. **Crear wrapper de remark:**
   ```typescript
   // src/remark-adapter.ts
   import { unified } from 'unified'
   import remarkParse from 'remark-parse'
   import remarkStringify from 'remark-stringify'
   import remarkGfm from 'remark-gfm'
   
   export function parseMarkdown(text: string): Root {
     return unified()
       .use(remarkParse)
       .use(remarkGfm)
       .parse(text)
   }
   
   export function stringifyMarkdown(ast: Root): string {
     return unified()
       .use(remarkStringify, {
         bullet: '-',
         emphasis: '_',
         strong: '_',
         listItemIndent: 'one',
       })
       .stringify(ast)
   }
   ```

3. **Migrar `markdown-table.ts` a AST:**
   - Usar `mdast` para detectar nodos `table`
   - Normalizar propiedades de tabla via AST
   - Reemplazar regex de detección por traversal

4. **Migrar `repair-glued-headings.ts` a AST:**
   - Usar nodos `heading` para detectar headings
   - Reemplazar regex por manipulación de nodos

5. **Migrar `markdown-repair.ts` a AST:**
   - Usar nodos `code` para detectar fences
   - Reparar fences via manipulación de nodos

#### Beneficios
- **Parsing robusto:** remark maneja todos los casos válidos de markdown
- **Mantenibilidad:** AST es más fácil de manipular que regex
- **Testing:** Puedes probar transformaciones individuales
- **Extensibilidad:** Fácil agregar nuevas transformaciones

### Fase 2: Mejorar reparaciones heurísticas (1-2 semanas) ✅ COMPLETADA

#### Objetivo
Mejorar la detección y reparación de contenido roto sin depender de regex frágiles.

#### Pasos completados
1. **Clasificador de patrones** (`src/pattern-classifier.ts`):
   - Detecta 10 patrones: mermaid, sql, dockerfile, docker-compose, env, json, yaml, directory-tree, markdown, unknown
   - `classifyPattern(text)` para análisis de contenido
   - `classifyCodeBlock(lang, body)` para fences con language tag
   - Confidence scores para decidir si aplicar reparación

2. **Reparadores por patrón** (`src/repairers/pattern-repairers.ts`):
   - Cada patrón tiene su propia función de reparación
   - `repairMermaid` — normaliza diagramas (graph→flowchart, etc.)
   - `repairSql` — repara fences fragmentados y bloques huérfanos
   - `repairDirectoryTree` — formatea árboles de directorios
   - `repairMarkdownProse` — headings, fences, tablas, bullets
   - Dispatcher automático `dispatchRepair(ctx)` routing por patrón
   - Fácil extender con nuevos patrones

3. **Pipeline de reparación** (`src/repair-pipeline.ts`):
   - `runRepairPipeline(text, options)` — orquesta clasificación→reparación→reemplazo
   - Phase 1: clasifica y repara code blocks (regex-based extraction)
   - Phase 2: clasifica y repara prose segments (line-based)
   - Opciones: `skipPatterns`, `onlyPatterns`, `debug`
   - Estadísticas: `repairedCount`, `byPattern` breakdown
   - Integrado en `format-document-markdown-ast.ts` reemplazando llamadas individuales

4. **Tests** (28 tests nuevos):
   - `pattern-classifier.spec.ts` — 20 tests (12 classifyPattern + 8 classifyCodeBlock)
   - `repair-pipeline.spec.ts` — 8 tests (pipeline + classifyAndRepair)

#### Beneficios alcanzados
- **Menos false positives:** Detección más precisa con confidence scores
- **Mantenibilidad:** Lógica separada por patrón en archivos dedicados
- **Testing:** Fácil probar cada reparador individualmente
- **Extensibilidad:** Fácil agregar nuevos patrones (solo crear función + agregar al dispatcher)

### Fase 3: Agregar features de markdown-formatter (1-2 semanas) ✅ COMPLETADA

#### Objetivo
Agregar features útiles de markdown-formatter que faltan en el formateador actual.

#### Archivos creados
- `src/toc-generator.ts` — Generación de TOC usando `extractHeadings` de remark-adapter
- `src/gfm-task-lists.ts` — Normalización de GFM task lists (checkbox markers)
- `src/formatter-presets.ts` — Presets de configuración (minimal, standard, strict)
- `src/toc-generator.spec.ts` — 9 tests
- `src/gfm-task-lists.spec.ts` — 11 tests
- `src/formatter-presets.spec.ts` — 6 tests

#### Integración
- Opciones `taskList`, `tocOptions` agregadas a `FormatOptions`
- `normalizeTaskLists()` integrado en `formatWithAst()` (Step 8)
- `generateToc()` integrado en `formatWithAst()` (Step 9, opcional)

#### Beneficios
- **Feature parity:** Funcionalidades similares a markdown-formatter
- **Configuración:** Presets predefinidos (minimal, standard, strict) + opciones granulares
- **GFM completo:** Soporte completo de task lists con normalización de markers

### Fase 4: Mejorar testing y documentación (1 semana)

#### Objetivo
Mejorar la cobertura de tests y documentación del formateador.

#### Pasos
1. **Agregar tests de integración:**
   ```typescript
   // src/__tests__/integration.test.ts
   describe('Formatter Integration', () => {
     it('should repair and format complex documents', () => {
       const input = readFixture('complex-document.md')
       const expected = readFixture('complex-document-formatted.md')
       const result = formatDocumentMarkdown(input)
       expect(result).toBe(expected)
     })
   })
   ```

2. **Agregar tests de edge cases:**
   ```typescript
   // src/__tests__/edge-cases.test.ts
   describe('Edge Cases', () => {
     it('should handle empty documents', () => {
       expect(formatDocumentMarkdown('')).toBe('')
     })
     
     it('should handle documents with only whitespace', () => {
       expect(formatDocumentMarkdown('   \n\n  ')).toBe('')
     })
   })
   ```

3. **Agregar documentación:**
   ```markdown
   # Formateador Markdown
   
   ## Uso
   ```typescript
   import { formatDocumentMarkdown } from '@theforge/shared-types'
   
   const formatted = formatDocumentMarkdown(rawMarkdown)
   ```
   
   ## Opciones
   ```typescript
   const formatted = formatDocumentMarkdown(rawMarkdown, {
     bullet: '-',
     emphasis: '_',
     generateToc: true,
   })
   ```
   
   ## Reparaciones
   El formateador corrige automáticamente:
   - Fences de código mal formados
   - Headings pegados a prosa
   - Tablas desalineadas
   - SQL colapsado
   - Contenido de infraestructura
   ```

4. **Agregar métricas de calidad:**
   ```typescript
   // src/quality-metrics.ts
   export function measureQuality(input: string, output: string): QualityMetrics {
     return {
       linesChanged: countLineChanges(input, output),
       headingsFixed: countHeadingsFixed(input, output),
       tablesNormalized: countTablesNormalized(input, output),
       fencesRepaired: countFencesRepaired(input, output),
     }
   }
   ```

#### Beneficios
- **Confianza:** Tests exhaustivos garantizan que no se rompa nada
- **Documentación:** Fácil entender y mantener
- **Métricas:** Visibilidad sobre qué tan bien funciona

## Estrategia de Migración

### Order de implementación
1. **Fase 1 (remark):** Primero, porque es la base para las demás mejoras
2. **Fase 2 (reparaciones):** Segundo, porque mejora la calidad del input
3. **Fase 3 (features):** Tercero, porque agrega funcionalidad nueva
4. **Fase 4 (testing):** Último, porque valida todo el trabajo anterior

### Compatibilidad hacia atrás
- **Mantener API existente:** `formatDocumentMarkdown()` sigue funcionando igual
- **Agregar opciones:** Nuevas opciones son opt-in
- **Deprecations:** Marcar funciones antiguas como deprecated, no eliminar

### Rollout
1. **Branch de desarrollo:** Crear `feature/remark-migration`
2. **Tests continuos:** Ejecutar tests existentes en cada paso
3. **Canary release:** Probar con documentos reales antes de mergear
4. **Monitoring:** Monitorear performance y calidad post-release

## Estimación de Esfuerzo

| Fase | Esfuerzo | Estado | Dependencias |
|------|----------|--------|--------------|
| Fase 1: remark | 2-3 semanas | ✅ COMPLETADA | Ninguna |
| Fase 2: reparaciones | 1-2 semanas | ✅ COMPLETADA | Fase 1 |
| Fase 3: features | 1-2 semanas | ✅ COMPLETADA | Fase 1 |
| Fase 4: testing | 1 semana | Pendiente | Fases 1-3 |
| **Total** | **5-8 semanas** | **3/4 completadas** | |

## Riesgos y Mitigaciones

### Riesgo 1: Performance
- **Problema:** remark puede ser más lento que regex
- **Mitigación:** Benchmarking, caching de AST, lazy parsing

### Riesgo 2: Compatibilidad
- **Problema:** remark puede formatear differently que el formatter actual
- **Mitigación:** Tests de regresión, comparación lado a lado

### Riesgo 3: Complejidad
- **Problema:** Agregar remark aumenta la complejidad del proyecto
- **Mitigación:** Documentación clara, separación de concerns

## Conclusión

Este plan transforma el formateador de un sistema regex frágil a un sistema AST robusto, manteniendo las ventajas del dominio específico (mermaid, SQL, infra) y agregando features útiles de markdown-formatter. El resultado será un formateador más mantenible, extensible y confiable.