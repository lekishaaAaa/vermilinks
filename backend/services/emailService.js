const { Resend } = require('resend');

let resendClient;

function getResendClient() {
  if (resendClient) {
    return resendClient;
  }

  const apiKey = (process.env.RESEND_API_KEY || '').toString().trim();
  if (!apiKey) {
    throw new Error('RESEND_API_KEY environment variable is required to send email.');
  }

  resendClient = new Resend(apiKey);
  return resendClient;
}

function getFrontendBaseUrl() {
  const raw = typeof process.env.FRONTEND_URL === 'string' && process.env.FRONTEND_URL.trim().length > 0
    ? process.env.FRONTEND_URL.trim()
    : 'http://localhost:3002';
  return raw.replace(/\/$/, '');
}

async function sendOtpEmail({ to, code, expiresAt }) {
  const expiryLabel = expiresAt instanceof Date ? expiresAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '5 minutes';
  return sendEmail({
    to,
    subject: 'Your BeanToBin admin verification code',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">BeanToBin Admin Verification</h2>
        <p>Use the following one-time code to finish signing in:</p>
        <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${code}</p>
        <p>This code expires at <strong>${expiryLabel}</strong>.</p>
        <p>If you did not request this code, you can safely ignore this email.</p>
      </div>
    `,
  });
}

async function sendEmail({ to, subject, html }) {
  try {
    const client = getResendClient();
    const from = (process.env.EMAIL_FROM || '').toString().trim();

    if (!from) {
      throw new Error('EMAIL_FROM environment variable is required to send email.');
    }

    const recipients = Array.isArray(to) ? to : [to];
    const response = await client.emails.send({
      from,
      to: recipients,
      subject,
      html,
    });

    console.log('RESEND SUCCESS:', response);
    return response;
  } catch (error) {
    console.error('RESEND ERROR:', error);
    throw error;
  }
}

async function sendPasswordResetEmail({ to, token }) {
  const resetLink = `${getFrontendBaseUrl()}/admin/reset-password?token=${encodeURIComponent(token)}`;

  return sendEmail({
    to,
    subject: 'Reset your BeanToBin admin password',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">BeanToBin Password Reset</h2>
        <p>We received a request to reset your admin account password.</p>
        <p>
          <a href="${resetLink}" style="display:inline-block;padding:10px 16px;background:#1769aa;color:#fff;text-decoration:none;border-radius:4px;">Reset Password</a>
        </p>
        <p>This link expires in <strong>15 minutes</strong>. If you did not request a reset, you can safely ignore this email.</p>
        <p style="font-size: 12px; color: #666;">If the button does not work, copy and paste this URL into your browser:<br />${resetLink}</p>
      </div>
    `,
  });
}

module.exports = {
  sendEmail,
  sendOtpEmail,
  sendPasswordResetEmail,
};
