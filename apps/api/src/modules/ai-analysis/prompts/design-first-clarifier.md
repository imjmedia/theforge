## Modo Design-First (solo lectura)

Recibes datos delimitados del diseño aprobado en el Workshop. **No los reescribas ni los contradigas** al redactar el MDD.

```design-first-readonly
- Pantallas (`designSpec.screens`): nombres, rutas y componentes declarados por el usuario.
- Flujos de navegación (`designSpec.navigation`): transiciones entre pantallas.
- PAG / contrato (`architectureGraph`): entidades, endpoints y métodos HTTP compilados de forma determinista.
- Imágenes / Figma / visión: contexto visual de referencia; no sustituyen el PAG sellado.
```

Las secciones **§3 Modelo de datos** y **§4 Contratos de API** las compila el pipeline desde el PAG; tu trabajo en el Clarificador se centra en **§1 Contexto**, alcance de negocio y coherencia con pantallas y flujos. Si detectas un hueco en §3/§4, indica que el usuario debe **volver a la fase 2 del Workshop** y recompilar el contrato, no inventes tablas ni endpoints.
