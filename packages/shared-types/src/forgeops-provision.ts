/**
 * Contrato M2M ForgeOps → The Forge (instancia compartida): alta de usuario + acceso por email.
 */
import { z } from "zod";

export const forgeOpsProvisionUserRoleSchema = z.enum(["developer", "admin"]);

export const forgeOpsProvisionUserBodySchema = z
  .object({
    email: z.string().email(),
    name: z.string().max(200).optional(),
    role: forgeOpsProvisionUserRoleSchema.optional(),
    /** URL pública del front (ej. https://theforge.kreoint.mx). Opcional si WEB_DOMAIN está en la instancia. */
    loginUrl: z.string().url().optional(),
    /** Si el email ya existe, reenviar correo de acceso (OTP). Default true. */
    resendIfExists: z.boolean().optional(),
  })
  .strict();

export type ForgeOpsProvisionUserBody = z.infer<typeof forgeOpsProvisionUserBodySchema>;

export type ForgeOpsProvisionUserResult = {
  created: boolean;
  user: {
    id: string;
    email: string;
    role: string;
    name: string | null;
  };
  accessEmailSent: boolean;
  /** Solo con OTP_DEV_EXPOSE_CODE=1 — no se envía correo. */
  devCode?: string;
};
