const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const { sendEmail } = require('../services/emailService');

async function main() {
  const to = process.env.EMAIL_TEST_TO || 'beantobin2025@gmail.com';
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    console.error('RESEND_API_KEY and EMAIL_FROM must be configured before running scripts/test-email.js');
    process.exit(1);
  }

  const info = await sendEmail({
    to,
    subject: 'VermiLinks Resend test',
    html: '<p>This is a verification email sent by scripts/test-email.js to confirm Resend delivery.</p>',
  });

  console.log('Email dispatched via Resend', {
    to,
    id: info && info.data ? info.data.id : info && info.id ? info.id : undefined,
  });
}

main().catch((err) => {
  console.error('Failed to send test email:', err && err.message ? err.message : err);
  process.exit(1);
});
