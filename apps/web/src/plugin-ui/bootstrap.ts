/**
 * Registra vistas Workshop de plugins instalados.
 * Cada plugin comercial aporta un paquete npm `@kreodevs/*-workshop-ui`.
 */
import { evdWorkshopPreviewRegistration } from "@kreodevs/evd-workshop-ui";
import { registerPluginWorkshopPreview } from "./registry";

registerPluginWorkshopPreview(evdWorkshopPreviewRegistration);
