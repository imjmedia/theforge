MDD: Reservas (fixture: mermaid TD válido fuera de una sección "Flujo de")

---
## 1. Contexto

Sistema de reservas de salas.
---
## 4. Contratos de API

### Diagrama de reserva

```mermaid
flowchart TD
  s0(Recibir solicitud de reserva)
  s1(Validar sala)
  s2(Validar horario)
  s3(Verificar permisos)
  s4{¿Sala libre?}
  s5(Registrar reserva)
  s6(Notificar al solicitante)
  s7(Sugerir otro horario)
  s8(Cerrar solicitud)
  s9(Registrar auditoría)
  s0 --> s1 --> s2 --> s3 --> s4
  s4 -->|Sí| s5 --> s6 --> s9
  s4 -->|No| s7 --> s8
```

---
## 5. Seguridad

Solo usuarios autenticados reservan salas.