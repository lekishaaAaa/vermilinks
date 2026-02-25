#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

async function main() {
  const summaryPathArg = process.argv[2];
  const subjectArg = process.argv[3];
  const summaryPath = summaryPathArg ? path.resolve(process.cwd(), summaryPathArg) : path.resolve(process.cwd(), 'deploy-summary.txt');
  const subject = subjectArg || 'VermiLinks Deployment Status';

  if (!fs.existsSync(summaryPath)) {
    throw new Error(`Summary file not found at ${summaryPath}`);
  }

  const summary = fs.readFileSync(summaryPath, 'utf8');

  const user = process.env.VERMILINKS_GMAIL_USER || '';
  const password = process.env.VERMILINKS_GMAIL_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD;
  const recipient = process.env.VERMILINKS_REPORT_RECIPIENT || '';

  if (!user) {
    throw new Error('Missing sender email. Set VERMILINKS_GMAIL_USER.');
  }
  if (!recipient) {
    throw new Error('Missing report recipient. Set VERMILINKS_REPORT_RECIPIENT.');
  }
  if (!password) {
    throw new Error('Missing Gmail app password. Set VERMILINKS_GMAIL_APP_PASSWORD or GMAIL_APP_PASSWORD.');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass: password,
    },
  });

  await transporter.sendMail({
    from: `"VermiLinks System" <${user}>`,
    to: recipient,
    subject,
    text: summary,
  });

  console.log('📧 Email report sent successfully!');
}

main().catch((error) => {
  console.error(`Failed to send email: ${error.message}`);
  process.exit(1);
});
