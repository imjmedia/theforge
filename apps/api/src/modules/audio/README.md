# Audio

Transcripción de audio a texto vía OpenAI Whisper usando el runtime BYOK del usuario. Sin modelo local — depende del proveedor IA configurado.

## Dependencias

- `UserLLMRuntime` — usa el modelo STT (`sttModel`) del proveedor activo del usuario.

## Capa

- **`audio.service.ts`** — lógica de transcripción con streaming.
- **`audio.controller.ts`** — endpoint `POST /audio/transcribe`.
- **`audio.module.ts`** — módulo NestJS.