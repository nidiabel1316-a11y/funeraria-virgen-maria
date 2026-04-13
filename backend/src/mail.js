/**
 * Envío de correo (recuperación de contraseña).
 * Configura en .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_PUBLIC_URL
 * Si no hay SMTP, solo registra el enlace en consola (desarrollo).
 */

export async function sendPasswordResetEmail(toEmail, resetUrl) {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.warn("[mail] SMTP_HOST no definido. Enlace de recuperación:", resetUrl);
    return { sent: false, devLog: true };
  }

  const nodemailer = (await import("nodemailer")).default;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth:
      process.env.SMTP_USER != null && process.env.SMTP_USER !== ""
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS || "",
          }
        : undefined,
  });

  const from = process.env.SMTP_FROM || "noreply@funerariavirgenmaria.com";
  const subject = "Restablecer contraseña — Funeraria Virgen María";
  const text = `Hola,\n\nPara crear una nueva contraseña abre este enlace (válido 1 hora):\n${resetUrl}\n\nSi no solicitaste este cambio, ignora este correo.\n`;
  const html = `<p>Hola,</p><p>Para crear una nueva contraseña haz clic en el siguiente enlace (válido 1 hora):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Si no solicitaste este cambio, ignora este correo.</p>`;

  await transporter.sendMail({ from, to: toEmail, subject, text, html });
  return { sent: true };
}
