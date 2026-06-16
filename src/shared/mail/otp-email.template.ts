/**
 * Simple OTP email as a self-contained HTML string with inline CSS.
 * Email clients strip <style> blocks and ignore external CSS, so every
 * style is set inline on the element.
 */
export function otpEmailHtml(code: string, name?: string): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background-color:#111827;padding:20px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:0.5px;">Nuebics</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 16px;color:#111827;font-size:16px;">${greeting}</p>
                <p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.6;">
                  Use the verification code below to confirm your account. This code expires in 10 minutes.
                </p>
                <div style="text-align:center;margin:0 0 24px;">
                  <span style="display:inline-block;background-color:#f3f4f6;color:#111827;font-size:30px;font-weight:bold;letter-spacing:8px;padding:14px 24px;border-radius:8px;">${escapeHtml(
                    code
                  )}</span>
                </div>
                <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
                  If you did not request this, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;color:#9ca3af;font-size:12px;">&copy; Nuebics. All rights reserved.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
