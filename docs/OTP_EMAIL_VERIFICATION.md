# OTP & Email Verification Playbook

This guide documents the exact steps needed to prove the admin OTP flow works 100% both on localhost and on the Render deployment. Follow the checklists sequentially.

---

## 1. Prerequisites

1. **Email App Password**
   - In the email account used for admin OTP (for example `admin@example.com`), enable 2FA and issue an App Password.
   - Record the 16-character password (no spaces). This value must be set as `EMAIL_PASS` wherever the backend runs.
2. **Shared Credentials**
   - `ADMIN_LOGIN_USERNAME` / `INIT_ADMIN_EMAIL`: `<your-admin-email>`
   - `ADMIN_LOGIN_PASSWORD` / `INIT_ADMIN_PASSWORD`: `<your-admin-password>`
3. **Environment variables**
   - Required everywhere: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `EMAIL_SERVICE=gmail`, `EMAIL_SECURE=false`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM="VermiLinks <no-reply@yourdomain.com>"`, `ADMIN_OTP_TTL_MS=180000` (3 minutes), `CORS_ORIGINS`, `SOCKETIO_CORS_ORIGINS`.
   - Render also needs `DATABASE_URL` populated from the managed Postgres instance (already wired in the Render config file).
4. **Dependencies installed locally**
   - From `backend/`: `npm install`
   - Activate the repo-level Python venv only if you plan to run other utilities (not required for OTP flow).

---

## 2. Localhost Validation (PowerShell)

> These commands assume your prompt is at `C:\xampp\htdocs\beantobin\system`.

1. **Kick off login to trigger OTP email**

```powershell
$job = Start-Job -ScriptBlock { cd C:\xampp\htdocs\beantobin\system\backend; node server.js }
Start-Sleep -Seconds 5
$loginBody = @{ email = '<your-admin-email>'; password = '<your-admin-password>' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:5000/api/admin/login -Method Post -Body $loginBody -ContentType 'application/json'
Stop-Job $job
Receive-Job $job
```

Expect JSON `{ success: true, data.requires2FA: true, delivery: "email" }` and the job output showing the Gmail `messageId` confirmation.

2. **Read the latest OTP from Gmail**

```powershell
cd backend
node scripts\fetch_latest_otp.js
cd ..
```

The script prints the newest OTP code and expiration timestamp. Copy the `otpCode` immediately (it expires in 3 minutes).

3. **Submit the OTP to finish authentication**

```powershell
$job = Start-Job -ScriptBlock { cd C:\xampp\htdocs\beantobin\system\backend; node server.js }
Start-Sleep -Seconds 5
$otpBody = @{ email = '<your-admin-email>'; otp = '<6-digit-code>' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:5000/api/admin/verify-otp -Method Post -Body $otpBody -ContentType 'application/json'
Stop-Job $job
Receive-Job $job
```

Replace `<6-digit-code>` with the value returned by `fetch_latest_otp.js`. You should receive `{ success: true, data.token: <JWT> }`. Save the JWT if you want to hit authenticated admin APIs in the same session.

4. **Optional SMTP sanity check**

```powershell
cd backend
npm run test-email
cd ..
```

This sends a simple verification email using the same SMTP credentials and prints the Gmail `messageId`.

---

## 3. Render Deployment Checklist

1. **Configure environment variables** via the Render dashboard or CLI (`render services update`):
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=587`
   - `EMAIL_SERVICE=gmail`
   - `EMAIL_SECURE=false`
   - `EMAIL_USER=<smtp-user>`
   - `EMAIL_PASS=<smtp-app-password>`
   - `EMAIL_FROM="VermiLinks <no-reply@yourdomain.com>"`
   - `ADMIN_LOGIN_USERNAME`, `ADMIN_LOGIN_PASSWORD`, `INIT_ADMIN_EMAIL`, `INIT_ADMIN_PASSWORD` (same values as above)
   - `CORS_ORIGINS=https://vermilinks.com,https://www.vermilinks.com,https://vermilinks-frontend.onrender.com`
   - `SOCKETIO_CORS_ORIGINS` similarly
   - Optional: `ADMIN_OTP_TTL_MS=180000` for explicit parity with local.

2. **Deploy / restart** the `vermilinks-backend` service so the new env vars take effect.

3. **Trigger the login flow against Render** from any machine with curl or PowerShell:

```powershell
$loginBody = @{ email = '<your-admin-email>'; password = '<your-admin-password>' } | ConvertTo-Json
Invoke-RestMethod -Uri https://vermilinks-backend.onrender.com/api/admin/login -Method Post -Body $loginBody -ContentType 'application/json'
```

(Replace the domain with the actual Render URL shown in the dashboard.) Confirm `success: true` in the response.

4. **Watch backend logs** to double-check Nodemailer delivery:
   - Via dashboard: *vermilinks-backend → Logs* (filter for `OTP sent successfully`).
   - Via CLI: `render services logs vermilinks-backend --tail`.

5. **Fetch the OTP from Gmail**
   - You can re-use the local script (it only needs IMAP access):

```powershell
cd backend
node scripts\fetch_latest_otp.js
cd ..
```

   - If you prefer Gmail UI, look for the latest “VermiLinks OTP Verification” email.

6. **Submit the OTP to the Render backend**

```powershell
$otpBody = @{ email = '<your-admin-email>'; otp = '<6-digit-code>' } | ConvertTo-Json
Invoke-RestMethod -Uri https://vermilinks-backend.onrender.com/api/admin/verify-otp -Method Post -Body $otpBody -ContentType 'application/json'
```

Expect `{ success: true, data.token: <JWT> }`. Grab this JWT for admin dashboard testing via the frontend.

7. **Monitor for failures**
   - If the login response shows `delivery: "email_failed"`, Gmail rejected the SMTP send. Check Render logs for the exact error and verify the App Password is still valid.
   - If `fetch_latest_otp.js` cannot find a recent email, ensure the Render backend actually accepted the login request (HTTP 200) and that the Gmail account inbox is not filtered or rate-limited.

---

## 4. Common Troubleshooting

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| `Unable to connect to the remote server` when hitting `/api/admin/login` locally | Backend exited after the 60s VS Code command limit | Wrap `node server.js` inside a PowerShell `Start-Job` block as shown above. |
| Login response `{ success: false, message: 'Invalid credentials' }` | Admin password drifted from `.env` | Run `node backend/scripts/reset-admin.js` with the desired password or update the database record manually. |
| Gmail blocks the SMTP connection | App Password revoked or 2FA disabled | Re-issue the App Password and update `EMAIL_PASS` everywhere. |
| OTP email arrives but verification fails with `Invalid or expired code` | Delay exceeded `ADMIN_OTP_TTL_MS` | Re-run the login request and use the new OTP immediately. |
| Render logs show `getaddrinfo ENOTFOUND smtp.gmail.com` | Render default networking blocked DNS temporarily | Retry after 1–2 minutes; Gmail outages are rare but DNS hiccups can occur on free plans. |

---

## 5. Evidence Capture Template

When demonstrating the flow (for QA, audits, or the defense), gather:

1. Output of the login request (JSON snippet showing `requires2FA`).
2. `fetch_latest_otp.js` JSON showing `otpCode` + expiration.
3. Output of the OTP verification request (JWT + expiry).
4. Screenshot or log excerpt from Render showing the same events.

Save these artifacts under `docs/<date>-otp-proof/` if you need a permanent record.
