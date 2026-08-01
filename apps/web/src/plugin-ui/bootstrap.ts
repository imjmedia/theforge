/**
 * Registra vistas Workshop de plugins instalados.
 * Vendors embebidos en `vendors/` — sin dependencia npm a repos hermanos en Docker.
 */
import { evdWorkshopPreviewRegistration } from "@/plugin-ui/vendors/evd-workshop-ui/registration";
import { registerPluginWorkshopPreview } from "./registry";

registerPluginWorkshopPreview(evdWorkshopPreviewRegistration);
