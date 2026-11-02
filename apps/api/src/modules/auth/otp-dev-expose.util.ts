/**
 * Decide si el OTP puede devolverse en la respuesta (`otp_dev_expose_code`).
 * En producción siempre es `false`: con el flag activo, `/auth/otp/request` (público)
 * devolvería el código de cualquier correo y bastaría el email para entrar.
 */
export function resolveOtpDevExposeCode(configured: boolean, production: boolean): boolean {
  if (production) return false;
  return configured;
}
