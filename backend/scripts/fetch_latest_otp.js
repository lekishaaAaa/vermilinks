const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

async function main() {
  const user = process.env.OTP_IMAP_USER;
  const pass = process.env.OTP_IMAP_PASS;

  if (!user || !pass) {
    throw new Error('OTP_IMAP_USER and OTP_IMAP_PASS must be configured.');
  }

  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  const mailbox = await client.mailboxOpen('INBOX');
  if (!mailbox || !mailbox.exists) {
    console.log('Inbox appears to be empty.');
    await client.logout();
    return;
  }

  const maxLookback = 50;
  const latestUid = mailbox.uidNext ? mailbox.uidNext - 1 : null;
  if (!latestUid || latestUid < 1) {
    console.log('No messages found in inbox.');
    await client.logout();
    return;
  }

  let foundMessage = null;
  for (let uid = latestUid; uid >= 1 && uid > latestUid - maxLookback; uid -= 1) {
    const candidate = await client.fetchOne(uid, { source: true, envelope: true });
    if (!candidate || !candidate.envelope || !candidate.envelope.subject) {
      continue;
    }
    if (String(candidate.envelope.subject).includes('VermiLinks OTP Verification')) {
      foundMessage = candidate;
      break;
    }
  }

  if (!foundMessage) {
    console.log('No OTP email found in the last ' + maxLookback + ' messages.');
    await client.logout();
    return;
  }

  await client.logout();

  const parsed = await simpleParser(foundMessage.source);
  const text = (parsed && parsed.text) || '';
  const otpMatch = text.match(/(\d{6})/);
  const otpCode = otpMatch ? otpMatch[1] : null;

  console.log(JSON.stringify({
    subject: parsed.subject,
    date: parsed.date,
    otpCode,
    snippet: text.trim().split(/\r?\n/).slice(0, 3),
  }, null, 2));
}

main().catch((err) => {
  console.error('Failed to fetch OTP email:', err && err.message ? err.message : err);
  process.exit(1);
});
