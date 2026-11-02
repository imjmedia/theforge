# Auditoría de seguridad — 2026-11-02

Alcance: `deps` + punto acotado de `app` (render Mermaid en web y parser jsdom en API) · Rama `fix/mermaid-oracle-f1` · Commit: `17b0dd75` + cambios sin commitear · Herramientas: `pnpm audit --json` y `pnpm audit --prod --json` (pnpm 9.15.9, con red), comparación de auditoría HEAD vs. working tree, `pnpm install --frozen-lockfile --lockfile-only --ignore-scripts`, `pnpm view` (registro npm), lectura de `node_modules` (código de mermaid 11.15.0), `git diff`, `grep`. Ariadne no usado (no hay `.ariadne-project`); alcanzabilidad verificada con búsqueda estática.

## Resumen ejecutivo

| Severidad | Total | Introducidos por el diff | Preexistentes |
|---|---|---|---|
| Crítica | 0 | 0 | 0 |
| Alta | 1 | 0 | 1 |
| Media | 3 | 2 | 1 |
| Baja | 2 | 1 | 1 |
| Informativa | 2 | 1 | 1 |

`pnpm audit` del repo: 204 avisos (2 críticos, 75 altos, 99 moderados, 28 bajos); en producción (`--prod`), 169. **El diff no añade ningún aviso nuevo:** la auditoría del lockfile de HEAD y la del working tree dan el mismo conjunto exacto de avisos.

Riesgos principales:
1. **ID-001 (alta, preexistente):** `securityLevel: "loose"` y el SVG insertado sin sanear permiten un XSS almacenado que se dispara con un clic (`click … href "javascript:…"` / `click … call eval(…)`). El JWT vive en `localStorage` y no hay CSP.
2. **ID-002 (media, introducido):** `mermaid` queda fijado en `11.15.0`, por debajo de los parches de seguridad de `11.16.1` (DoS y prototype pollution). Antes, el rango `^11.12.2` permitía actualizar.
3. **ID-005 (media, introducido):** `node-mermaid-parser.ts` monta `window`, `document` y `navigator` en `globalThis`. El módulo se compila en `dist` y llega a la imagen de producción junto con `jsdom` y `mermaid`. Si alguien lo importara en el proceso Nest, los SDK de Anthropic y OpenAI creerían estar en un navegador y no se podrían crear clientes nuevos, y mermaid 11.15.0 contaminaría el prototipo del proceso API.

## Hallazgos

### [ALTA] ID-001 — XSS almacenado de un clic en diagramas Mermaid (`securityLevel: "loose"`)
- **Evidencia:**
  - `apps/web/src/lib/mermaid-runtime.ts:27-32`: `WEB_MERMAID_CONFIG` con `securityLevel: "loose"`.
  - `apps/web/src/components/MarkdownMermaid.tsx:165`: `dangerouslySetInnerHTML={{ __html: svg }}`. En `:149-154`, `bindFunctions?.(el)` conecta los handlers de `click`.
  - Mermaid 11.15.0 (`node_modules/mermaid/dist/mermaid.core.mjs:1157,1224`): el `DOMPurify.sanitize(svgCode, …)` final **solo corre si el nivel no es loose**.
  - `chunks/mermaid.core/chunk-5ZQYHXKU.mjs:140-149`: `formatUrl` solo aplica `sanitizeUrl` si el nivel no es loose, así que `href "javascript:…"` llega intacto. En `:151-164`, `runFunc` recorre `window` y llama a cualquier función global por nombre (p. ej. `eval`) con argumentos del autor del diagrama.
  - `chunks/mermaid.core/flowDiagram-I6XJVG4X.mjs:445-476`: `click … call` solo se activa en loose.
  - Mitigación parcial: las etiquetas siguen pasando por `DOMPurify.sanitize(texto, { FORBID_TAGS: ["style"] })` (`chunk-CSCIHK7Q.mjs:4913-4921`), así que **no hay XSS sin clic** vía `htmlLabels` con el DOMPurify actual. `securityLevel` está en la lista `secure` (`chunk-CSCIHK7Q.mjs:4360-4368`) y `dompurifyConfig` no está entre las claves que un diagrama puede fijar por directiva (`sanitizeDirective`, `chunk-CSCIHK7Q.mjs:4649-4665`): un diagrama no puede rebajar su propia seguridad.
  - El pipeline no filtra `click`: `packages/shared-types/src/mermaid.ts:1014,2094` lo trata como palabra clave válida.
  - Agravantes: el token de sesión está en `localStorage` (`apps/web/src/utils/apiClient.ts:24-28`, `apps/web/src/lib/api.ts:6`), y `docker/nginx-fullstack.conf` no envía `Content-Security-Policy` (tampoco hay `<meta http-equiv>` en `apps/web/index.html`).
  - Preexistente: en HEAD, `MarkdownMermaid.tsx:72` ya tenía `securityLevel: "loose"` y en `:145-148` hacía `el.innerHTML = svg; bindFunctions?.(el)`.
- **Impacto:** quien controle el texto de un diagrama puede ejecutar JS en la sesión de quien haga clic en un nodo (los nodos con `click` llevan cursor de enlace). Eso basta para robar el JWT de `localStorage` y tomar la cuenta. Hay dos fuentes del texto:
  - el LLM del pipeline, expuesto a prompt injection indirecta desde repos legacy, documentos subidos o búsqueda web;
  - cualquier editor del proyecto.

  Si un documento lo ven usuarios de otro tenant o con más privilegio (admin), el riesgo cruza esos límites. La visibilidad entre tenants no está verificada (ver "No auditado").
- **Remediación sugerida** (sin cambiar la decisión de F1):
  1. F2: pasar a `securityLevel: "strict"`. Sigue soportando etiquetas HTML, saneadas, y desactiva `click call` y `javascript:`. `ExcalidrawDiagramBlock` ya usa strict.
  2. Mientras siga en loose, sanear el SVG tras el render, antes de `dangerouslySetInnerHTML`:
     - pasar el SVG por DOMPurify con el mismo perfil que mermaid usa fuera de loose (perfiles `svg`/`svgFilters`/`html`, `HTML_INTEGRATION_POINTS: { foreignobject: true }`);
     - como mínimo, eliminar `href`/`xlink:href` que no casen con `^(https?:|mailto:|#|/)`;
     - no invocar `bindFunctions`, o quitar las líneas `click … call` en la preparación del render (`mermaid-render-prep.util.ts`).
  3. Defensa en profundidad: CSP `script-src 'self'` sin `'unsafe-inline'` ni `'unsafe-eval'`, que bloquea las URL `javascript:` y `eval`. A medio plazo, sacar el JWT de `localStorage` (cookie `HttpOnly`, `SameSite`).
- **Alcanzable / explotable:** alcanzable sí (análisis estático de la ruta completa). Explotable: requiere un clic de la víctima. No verificado dinámicamente, porque no se ejecutan exploits.

### [MEDIA] ID-002 — `mermaid` fijado en 11.15.0, por debajo de los parches de seguridad de 11.16.1
- **Evidencia:**
  - `apps/web/package.json` (dependencia de producción): `"mermaid": "11.15.0"` (antes `^11.12.2`). En `apps/api/package.json:75`, `"mermaid": "11.15.0"` (devDependency nueva).
  - `pnpm audit` lista 5 avisos sobre `mermaid@11.15.0`, todos corregidos en `>=11.16.1`:
    - GHSA-2v8p-3f2j-5mp7 (moderado): DoS por bucle infinito en XY chart.
    - GHSA-rhh3-jpg6-66xh (moderado): DoS en radar con `ticks` enormes.
    - GHSA-3rrr-jr9j-h3q3 (moderado): prototype pollution en `architecture-beta` (`… in __proto__`); el nombre de la propiedad es arbitrario y el valor es `"horizontal"` o `"vertical"`.
    - GHSA-6x64-9x62-f2gx (moderado): inyección CSS a hermanos del `<svg>`.
    - GHSA-c4c3-pg64-4m4v (bajo): prototype pollution por la API de configuración.
  - En el registro existen 11.16.1, 11.17.0-11.17.2 y 12.x (`latest` = 12.2.0). La versión resuelta no cambia (ya era 11.15.0 en el lockfile de HEAD); lo nuevo es que el pin exacto impide que `pnpm update` la corrija.
- **Impacto:**
  - En web, un diagrama malicioso (del LLM o de un editor) puede congelar o tumbar la pestaña de quien abra el documento, o contaminar `Object.prototype` del SPA con un valor truthy, lo que corrompe lógica de UI.
  - La inyección CSS tiene poca aplicabilidad: el `<svg>` es el único hijo de su contenedor (`MarkdownMermaid.tsx:158-166`).
  - En F2 el parser pasa a runtime en el servidor y estos DoS y la prototype pollution afectarían al worker o al API.
- **Remediación sugerida:** fijar `11.17.2` (último 11.x) a la vez en `apps/web` y `apps/api`, para que el oráculo y la web sigan usando la misma versión. Después, reejecutar `mermaid-corpus.spec.ts` y `scripts/mermaid-oracle-concordance.mjs`. Debe estar hecho antes de F2.
- **Alcanzable / explotable:** sí en web (cualquier MDD renderizado). En API, hoy no: solo tests y script local.

### [MEDIA] ID-004 — Cadena muerta `@mermaid-js/mermaid-cli` → `puppeteer` (y `puppeteer-core` directo) en dependencias de producción del API
- **Evidencia:**
  - `apps/api/package.json:30`: `"@mermaid-js/mermaid-cli": "^11.0.0"`, resuelto a 11.16.0, que arrastra `puppeteer@25.3.0` y `puppeteer-core@25.3.0`.
  - `apps/api/package.json:60`: `"puppeteer-core": "^24.0.0"` (24.43.1). Tampoco se importa en `src`.
  - `grep` en `apps/`, `packages/`, `scripts/`, `docker/` y `.github/`: ningún uso en código de la app. El único consumidor es el script nuevo `apps/api/scripts/mermaid-oracle-concordance.mjs:30` (ver ID-006).
  - `puppeteer@25.3.0` tiene `postinstall=node install.mjs`, que descarga Chrome en cada `pnpm install`: builder del Dockerfile (`Dockerfile:13`) y CI (`.github/workflows/ci.yml:28,65`). No hay `PUPPETEER_SKIP_DOWNLOAD` ni `onlyBuiltDependencies`.
  - Avisos que entran solo por esta cadena:
    - `extract-zip@2.0.1`: GHSA-7pqw-9j4j-h8q3 y GHSA-jmr9-qjv8-65gv (altos, CVSS 8.1, **sin versión parcheada**).
    - `basic-ftp@5.3.1`: GHSA-c475-qrg2-pj4r (alto).
    - `ip-address@10.2.0`: GHSA-mwp4-54f8-5fhr (alto) y varios moderados de SSRF.
    - `postcss@8.5.15`: GHSA-r28c-9q8g-f849 (alto). También `browserslist` (altos) vía `@zenuml/core`.
    - Otra copia de `mermaid` y `dompurify` 3.4.5.
  - El Dockerfile copia `/app` completo del builder a la imagen final (`Dockerfile:61`), así que todo esto, y las devDependencies, viaja a producción.
- **Impacto:** no es alcanzable en runtime (sin imports), pero amplía la superficie de cadena de suministro: binario de Chrome descargado en build y CI, y código de terceros con avisos altos sin parche dentro de la imagen. Si un día se usara `extract-zip` o la descarga de navegadores con entradas no confiables, el path traversal sería explotable.
- **Remediación sugerida:**
  - F3: retirar `@mermaid-js/mermaid-cli` y `puppeteer-core` de `dependencies` de `apps/api`.
  - Mientras tanto: `PUPPETEER_SKIP_DOWNLOAD=true` en el builder de Docker y en CI, y lista blanca de scripts de build (`pnpm.onlyBuiltDependencies`: `prisma`, `@prisma/client`, `esbuild`…).
  - Imagen final solo con dependencias de producción (`pnpm deploy --prod` o `pnpm prune --prod` en una etapa intermedia).
- **Alcanzable / explotable:** no (sin imports en `src`). Preexistente.

### [MEDIA] ID-005 — `node-mermaid-parser.ts` monta globales de DOM en el proceso y llega a la imagen de producción
- **Evidencia:**
  - `apps/api/src/modules/mermaid-oracle/node-mermaid-parser.ts:40-59`: `defineGlobal("window" | "document" | "navigator", …)` sobre `globalThis`. En `:61`, `import("mermaid")` en el mismo realm.
  - Registro en Nest: ningún `*.module.ts` referencia `mermaid-oracle` ni `createNodeMermaidParser`. Únicos consumidores: `mermaid-corpus.spec.ts:44` y `scripts/mermaid-oracle-concordance.mjs:73`. Verificado: **no está registrado**.
  - `apps/api/tsconfig.build.json` solo excluye specs, tests y `__fixtures__`. El módulo se compila: existe `apps/api/dist/modules/mermaid-oracle/node-mermaid-parser.js`.
  - `Dockerfile:13`: `pnpm install --frozen-lockfile` instala devDependencies. En `:61`, `COPY --from=api-builder /app /app`, así que `jsdom` y `mermaid` (devDependencies "solo para tests") quedan en la imagen de producción.
  - Efecto si se importara en Nest: `@anthropic-ai/sdk/internal/detect-platform.js:6-14` y `openai/core.js:899-907` detectan navegador con exactamente `window`, `window.document` y `navigator`. `@anthropic-ai/sdk/client.js:89` y `openai/index.js:83` lanzan error si no se pasa `dangerouslyAllowBrowser`.
- **Impacto si por error se importara en el proceso Nest** (hoy no ocurre):
  1. Todo cliente Anthropic u OpenAI creado después fallaría: DoS de las funciones LLM para todos los tenants. Otras librerías que ramifican por `typeof window` cambiarían de comportamiento de forma silenciosa.
  2. Con mermaid 11.15.0, un diagrama `architecture-beta` controlado por el LLM o por un usuario escribiría una propiedad arbitraria con valor truthy en `Object.prototype` del API (GHSA-3rrr). Eso podría corromper comprobaciones de la forma `if (obj.flag)` en guards o servicios.
  3. Los DoS (GHSA-2v8p y GHSA-rhh3) bloquearían el event loop compartido.

  Aspecto positivo: el `JSDOM` se crea sin `runScripts` ni `resources` (`:53-55`), así que jsdom no ejecuta scripts ni hace peticiones.
- **Remediación sugerida:**
  1. Guardia al inicio de `loadMermaid()`. Que lance si `require("node:worker_threads").isMainThread && process.env.NODE_ENV === "production"`, o mejor, que exija estar en un worker salvo con una variable explícita de tests (`MERMAID_ORACLE_ALLOW_MAIN_THREAD=1`).
  2. Regla ESLint `no-restricted-imports` que prohíba importar `**/mermaid-oracle/node-mermaid-parser` fuera de `*.spec.ts` y `scripts/`.
  3. Excluir el archivo de `tsconfig.build.json` hasta F2.
  4. F2, con `worker_threads`:
     - `resourceLimits` (heap) y timeout por llamada con `worker.terminate()`;
     - límite de tamaño de entrada (`maxTextSize`);
     - reciclar el worker cada N parses o tras un error, para que una prototype pollution no persista entre documentos de distintos tenants;
     - actualizar mermaid (ID-002) antes de exponerlo.
  5. Imagen sin devDependencies (ver ID-004).
- **Alcanzable / explotable:** no hoy (sin importadores en runtime). El riesgo aparece en F2 o ante un import accidental. Introducido por el diff.

### [BAJA] ID-003 — `dompurify@3.4.5` (transitiva de mermaid) con 14 avisos, entre ellos 1 crítico y 1 alto, no alcanzables por el uso de mermaid
- **Evidencia:**
  - `pnpm audit`: GHSA-cg2g-xh64-v4q7 (crítico), GHSA-mrv2-3pqr-j5jr (alto) y 6 moderados y 6 bajos. Todos corregidos en `>=3.4.17`.
  - El lockfile resuelve `dompurify: 3.4.5` en todo el árbol (`pnpm-lock.yaml:4084`, snapshot de `mermaid@11.15.0`).
  - Mermaid 11.15.0 declara `dompurify: ^3.3.1` (`pnpm view`), rango que admite 3.4.17 (la última publicada).
  - El crítico y el alto exigen `SAFE_FOR_TEMPLATES` con salida DOM, o `IN_PLACE` con hooks que eliminan nodos. Los moderados exigen `IN_PLACE`, `setConfig` o hooks que mutan `allowedTags`.
  - Mermaid usa DOMPurify en modo string, con config por defecto más `FORBID_TAGS: ["style"]`, y hooks que solo tocan `target` y `rel` de `<a>` (`chunk-CSCIHK7Q.mjs:4873-4921`).
  - `apps/web/src` no usa DOMPurify directamente.
- **Impacto:** no explotable con el uso actual. Aun así, es la única barrera que sanea etiquetas en modo loose (ID-001).
- **Remediación sugerida:** `pnpm update dompurify --recursive` o `pnpm.overrides: { "dompurify": ">=3.4.17" }`. No requiere tocar mermaid.
- **Alcanzable / explotable:** no (según el código de mermaid revisado). Preexistente.

### [BAJA] ID-006 — El script de concordancia depende de `puppeteer` hoisted (dependencia fantasma)
- **Evidencia:** `apps/api/scripts/mermaid-oracle-concordance.mjs:5,30` hace `require("puppeteer")`, que solo existe por el hoisting (`node-linker=hoisted` en `.npmrc`) de `@mermaid-js/mermaid-cli`. `puppeteer` no está declarado en `apps/api/package.json`.
- **Impacto:** cuando F3 retire `mermaid-cli` (ID-004), el script se rompe o resuelve otra versión sin aviso. Además empuja a mantener una dependencia muerta solo para un script local.
- **Remediación sugerida:** si el script se conserva, declarar `puppeteer` (o `puppeteer-core` con Chrome del sistema) como devDependency explícita de `apps/api`, o moverlo a un paquete de herramientas aparte.
- **Alcanzable / explotable:** no (solo local, no corre en CI). Introducido por el diff.

### [INFO] ID-007 — Chrome con `--no-sandbox` en el script local
- **Evidencia:** `apps/api/scripts/mermaid-oracle-concordance.mjs:32`: `puppeteer.launch({ headless: true, args: ["--no-sandbox"] })`. En `:38`, mermaid se inicializa con `securityLevel: "loose"` dentro de Chrome.
- **Impacto:** nulo con el corpus fijo de `__fixtures__`. Si se reutilizara con diagramas no confiables, un exploit del renderer no tendría sandbox.
- **Remediación sugerida:** quitar `--no-sandbox` salvo en contenedores que lo exijan, y documentar que el script solo acepta el corpus versionado.
- **Alcanzable / explotable:** no. Introducido por el diff.

### [INFO] ID-008 — `jsdom@26.1.0` fijado cuatro mayores por detrás (latest 30.1.3)
- **Evidencia:** `pnpm view jsdom dist-tags.latest` → 30.1.3. Sin avisos en `pnpm audit` para jsdom ni para su subárbol.
- **Impacto:** ninguno hoy. A medio plazo, deuda de parches (jsdom procesa HTML/SVG no confiable en F2).
- **Remediación sugerida:** evaluar subir a la última mayor compatible con mermaid antes de F2 y reejecutar la concordancia.
- **Alcanzable / explotable:** no aplica. Introducido por el diff.

## Verificado sin hallazgos

- **Red para `pnpm audit`:** disponible (respuesta de ~1,1 MB). Aviso no bloqueante: `~/.npmrc` referencia una variable de entorno de token no definida (`FONTAWESOME_NPM_AUTH_TOKEN`). No se imprimió ningún valor.
- **Diff sin avisos nuevos:** auditoría del lockfile de HEAD (`git show HEAD:pnpm-lock.yaml`) frente al working tree: 204/204 avisos (169/169 en `--prod`), conjuntos idénticos; ningún aviso nuevo ni desaparecido.
- **Subárbol de jsdom sin avisos:** `cssstyle`, `nwsapi`, `parse5`, `tough-cookie`, `tldts`, `whatwg-url`, `whatwg-encoding`, `whatwg-mimetype`, `ws@8.21.0`, `tr46`, `saxes`, `data-urls`, `decimal.js`, `http(s)-proxy-agent`, `@csstools/*`, `@asamuzakjp/css-color`, etc.
- **`tsx` en `packages/shared-types`:** resuelve al `4.22.3` ya presente. Su único aviso es en `esbuild@0.28.0` (GHSA-g7r4-m6w7-qqqr, bajo: servidor de desarrollo en Windows), no aplicable.
- **Scripts de instalación:** ninguna dependencia nueva tiene `preinstall`, `install` ni `postinstall`. `jsdom`, `whatwg-url`, `whatwg-encoding` y `dompurify` solo tienen `prepare`, que no corre al instalar desde el registro. Los únicos `postinstall` relevantes son preexistentes: `puppeteer@25.3.0` (descarga Chrome) y `esbuild@0.28.0` (binario de plataforma).
- **Lockfile coherente:** `pnpm install --frozen-lockfile --lockfile-only --ignore-scripts` termina sin error y sin modificar el lockfile.
- **Versiones declaradas = resueltas:** jsdom 26.1.0, mermaid 11.15.0 (api y web) y tsx ^4.19.2 → 4.22.3.
- **Sin paquetes inesperados:** los 26 paquetes añadidos al lockfile son exactamente el cierre de dependencias de `jsdom@26.1.0` según su manifiesto publicado (`pnpm view jsdom@26.1.0 dependencies`). Los que ya existían (`parse5`, `ws`, `http(s)-proxy-agent`, `whatwg-encoding`, `whatwg-mimetype`) se reutilizan.
- **Configuración de jsdom:** el `JSDOM` del oráculo no habilita `runScripts` ni `resources`.
- **Directivas de diagrama:** no pueden cambiar `securityLevel` (clave `secure`) ni inyectar `dompurifyConfig` (no está en `configKeys`).
- **Vista Excalidraw:** `ExcalidrawDiagramBlock` usa `securityLevel: strict`, impuesto por `@excalidraw/mermaid-to-excalidraw`.

## No auditado (y por qué)

- **Explotación dinámica** de ID-001, ID-002 e ID-005: prohibido ejecutar exploits; todo se basa en análisis estático del código de mermaid instalado.
- **Momento en que actúa la prototype pollution** de GHSA-3rrr (si ya en `mermaid.parse` o solo en `render`): no verificado sin ejecutar un PoC. Para F2 debe asumirse que ocurre en `parse`.
- **Modelo multi-tenant y visibilidad de MDDs** entre tenants y roles: el repo no tiene `AGENTS.md` ni `CLAUDE.md` en la raíz que lo declare y queda fuera del alcance `deps`. Define si ID-001 cruza tenants.
- **Triaje de alcanzabilidad de los ~190 avisos preexistentes** ajenos a mermaid, jsdom y puppeteer. Ejemplos: `proxy-addr` (crítico, vía express), `undici`, `multer`, `nodemailer`, `fast-uri`, `@modelcontextprotocol/sdk`, `body-parser`, `nanoid` y `lodash-es` (vía excalidraw). Fuera del alcance de este diff; se recomienda una auditoría `deps` general aparte.
- **Infra** (fuera de alcance, preexistente, solo observado de pasada):
  - credenciales de Postgres literales en `ENV` del `Dockerfile` (`:21`, `:51-54`);
  - `.dockerignore` sin `.env*`;
  - contenedor como root;
  - `prisma db push --accept-data-loss` en `docker/entrypoint-full.sh`.

  Merecen una auditoría `infra`.

## Veredicto para el gate

**No bloquea.** El diff no introduce avisos nuevos de `pnpm audit`, no trae scripts de instalación nuevos, el lockfile es coherente y los paquetes añadidos son exactamente el subárbol de jsdom 26.1.0.

- **Introducido por este diff:** ID-002 (pin de mermaid por debajo de 11.16.1), ID-005 (globales de DOM; módulo y devDependencies en la imagen), ID-006 (dependencia fantasma de puppeteer), ID-007 y ID-008 (informativos).
- **Preexistente:** ID-001 (loose + SVG sin sanear + `bindFunctions`; en HEAD ya existía con `innerHTML`), ID-003 (dompurify 3.4.5) e ID-004 (cadena `mermaid-cli`/`puppeteer` y `puppeteer-core` sin uso).
- **Condiciones recomendadas antes de F2** (cuando mermaid y jsdom pasen a runtime): resolver ID-002 (subir a ≥11.16.1, idealmente 11.17.2, en web y api), ID-005 (guardia más worker con límites y timeout) e ID-003 (override de dompurify), y decidir ID-001 (`strict` o saneado posterior al render, más CSP).
