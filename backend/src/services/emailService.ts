/**
 * Transactional Email Service Abstraction
 * Supports Resend, Postmark, SendGrid, SMTP, or audited fallback transport.
 * Never leaks API keys or credentials to the client.
 */

export interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export interface EmailDeliveryResult {
    success: boolean;
    provider: string;
    messageId?: string;
    error?: string;
    reroutedTo?: string;
}

/**
 * Dispatches an email using the configured provider via environment variables.
 * If no provider API key is configured, safely falls back to audited development transport.
 */
export async function sendTransactionalEmail(options: EmailOptions): Promise<EmailDeliveryResult> {
    const isTestEnv = process.env.NODE_ENV === 'test';
    const provider = (process.env.EMAIL_PROVIDER || (isTestEnv ? 'dev-mock' : 'auto')).toLowerCase();
    const fromAddress = process.env.EMAIL_FROM || 'Elite Timesheet <onboarding@resend.dev>';

    // 1. Resend Provider
    if (provider === 'resend' || (!isTestEnv && provider === 'auto' && process.env.RESEND_API_KEY)) {
        if (!process.env.RESEND_API_KEY) {
            return {
                success: false,
                provider: 'resend',
                error: 'RESEND_API_KEY is not configured on the server.',
            };
        }

        const devRecipient = process.env.RESEND_TEST_RECIPIENT || 'dennistomang@gmail.com';
        const isLocalDomain = options.to.endsWith('.local') || options.to.endsWith('.test') || options.to.endsWith('.example');
        const targetRecipient = isLocalDomain ? devRecipient : options.to;
        const isRerouted = targetRecipient.toLowerCase() !== options.to.toLowerCase();

        const buildPayload = (sendTo: string, isReroute: boolean) => {
            let finalHtml = options.html;
            let finalText = options.text || options.html.replace(/<[^>]*>?/gm, '');
            let finalSubject = options.subject;

            if (isReroute) {
                finalSubject = `[For: ${options.to}] ${options.subject}`;
                const bannerHtml = `
                <div style="background-color: #1e1b4b; border: 1px solid #6366f1; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #e0e7ff; font-size: 13px; line-height: 1.5;">
                  <div style="font-weight: 700; color: #818cf8; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px;">Resend Testing Sandbox Notice</div>
                  <div>This email was intended for <strong>${options.to}</strong>.</div>
                  <div style="color: #94a3b8; font-size: 12px; margin-top: 4px;">Delivered to your verified account <strong>${sendTo}</strong> because Resend sandbox requires a verified custom domain at resend.com/domains to send to external recipients.</div>
                </div>
                `;
                finalHtml = finalHtml.replace(/<body[^>]*>/i, `$&${bannerHtml}`);
                finalText = `[Resend Sandbox Notice: Originally dispatched to ${options.to}. Delivered to ${sendTo}]\n\n${finalText}`;
            }

            return {
                from: fromAddress,
                to: sendTo,
                subject: finalSubject,
                html: finalHtml,
                text: finalText,
            };
        };

        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload(targetRecipient, isRerouted)),
            });

            if (res.ok) {
                const data: any = await res.json();
                console.log(`[EMAIL DISPATCHED] Resend delivered email to ${targetRecipient}${isRerouted ? ` (rerouted from ${options.to})` : ''} (ID: ${data.id})`);
                return { 
                    success: true, 
                    provider: 'resend', 
                    messageId: data.id, 
                    ...(isRerouted ? { reroutedTo: targetRecipient } : {}) 
                };
            }

            // If Resend rejected, check error details
            let errorMsg = `Resend HTTP ${res.status}`;
            let errData: any = {};
            try {
                errData = await res.json();
                if (errData.message) errorMsg = errData.message;
                else if (errData.error) errorMsg = typeof errData.error === 'string' ? errData.error : JSON.stringify(errData.error);
            } catch {
                errorMsg = `Resend HTTP ${res.status} ${res.statusText || ''}`.trim();
            }

            // Check if Resend rejected because of testing restriction:
            const matchAllowed = errorMsg.match(/\(([^)]+@.+?)\)/);
            const verifiedAccount = matchAllowed ? matchAllowed[1].trim() : devRecipient;

            if (res.status === 403 && verifiedAccount && verifiedAccount.toLowerCase() !== targetRecipient.toLowerCase()) {
                console.warn(`[RESEND RETRY] Initial dispatch to ${targetRecipient} rejected by Resend sandbox. Retrying to verified developer address: ${verifiedAccount}`);
                
                const retryRes = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(buildPayload(verifiedAccount, true)),
                });

                if (retryRes.ok) {
                    const retryData: any = await retryRes.json();
                    console.log(`[EMAIL REROUTED & DISPATCHED] Resend delivered to ${verifiedAccount} for intended recipient ${options.to} (ID: ${retryData.id})`);
                    return {
                        success: true,
                        provider: 'resend',
                        messageId: retryData.id,
                        reroutedTo: verifiedAccount
                    };
                } else {
                    const retryErr = await retryRes.json().catch(() => ({}));
                    console.error(`[EMAIL RETRY FAILED] Failed retry to ${verifiedAccount}:`, retryErr);
                }
            }

            console.error(`[EMAIL ERROR] Resend dispatch failed for ${options.to}:`, errorMsg);
            return { success: false, provider: 'resend', error: errorMsg };
        } catch (err: any) {
            console.error(`[EMAIL NETWORK ERROR] Failed to contact Resend API:`, err.message);
            return { success: false, provider: 'resend', error: err.message || 'Network error communicating with Resend' };
        }
    }

    // 2. Postmark Provider
    if (provider === 'postmark' || (provider === 'auto' && process.env.POSTMARK_SERVER_TOKEN)) {
        if (!process.env.POSTMARK_SERVER_TOKEN) {
            return {
                success: false,
                provider: 'postmark',
                error: 'POSTMARK_SERVER_TOKEN is not configured on the server.',
            };
        }

        try {
            const res = await fetch('https://api.postmarkapp.com/email', {
                method: 'POST',
                headers: {
                    'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    From: fromAddress,
                    To: options.to,
                    Subject: options.subject,
                    HtmlBody: options.html,
                    TextBody: options.text || options.html.replace(/<[^>]*>?/gm, ''),
                }),
            });

            if (res.ok) {
                const data: any = await res.json();
                return { success: true, provider: 'postmark', messageId: data.MessageID };
            } else {
                const errData: any = await res.json().catch(() => ({}));
                return { success: false, provider: 'postmark', error: errData.Message || `Postmark HTTP ${res.status}` };
            }
        } catch (err: any) {
            return { success: false, provider: 'postmark', error: err.message || 'Network error communicating with Postmark' };
        }
    }

    // 3. Audited Dev / Test Transport (Only when explicitly configured or in test mode)
    if (provider === 'dev-mock' || provider === 'test' || process.env.NODE_ENV === 'test') {
        const simulatedId = 'dev-' + Math.random().toString(36).substring(2, 11);
        console.log(`[EMAIL DISPATCHED - DEV/TEST] Provider: dev-mock | To: ${options.to} | Subject: "${options.subject}" | MessageId: ${simulatedId}`);

        return {
            success: true,
            provider: 'dev-mock',
            messageId: simulatedId,
        };
    }

    // 4. No provider configured
    return {
        success: false,
        provider,
        error: `No transactional email provider credentials configured (RESEND_API_KEY required).`,
    };
}

/**
 * Generates branded HTML template for Organisation Setup Invitation
 */
export function buildOrgInviteEmailTemplate(params: { inviteLink: string, recipientEmail: string }): { subject: string, html: string, text: string } {
    const subject = 'Welcome to Elite Timesheet OS - Set Up Your Organisation';
    const text = `Welcome to Elite Timesheet OS!\n\nYou have been invited to provision and administer your company workspace.\n\nClick the link below to get started:\n${params.inviteLink}\n\nThis invitation was issued to ${params.recipientEmail}. It is single-use and expires in 7 days.`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; }
        .card { max-width: 540px; margin: 0 auto; background-color: #1e293b; border-radius: 20px; border: 1px solid #334155; padding: 36px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
        .brand { font-size: 20px; font-weight: 800; color: #6366f1; letter-spacing: -0.5px; margin-bottom: 24px; }
        .title { font-size: 24px; font-weight: 800; color: #ffffff; margin-bottom: 12px; line-height: 1.3; }
        .desc { font-size: 14px; line-height: 1.6; color: #94a3b8; margin-bottom: 28px; }
        .btn { display: inline-block; background-color: #6366f1; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 700; font-size: 14px; text-align: center; }
        .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; line-height: 1.5; }
        .highlight { color: #cbd5e1; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="brand">ELITE TIMESHEET OS</div>
        <div class="title">Set Up Your Organisation Workspace</div>
        <p class="desc">
          You have been designated as the Organisation Administrator. Your new workspace is ready to be configured for rosters, timesheets, and staff management.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${params.inviteLink}" class="btn">Complete Organisation Setup →</a>
        </div>
        <div class="footer">
          This single-use invitation is issued strictly for <span class="highlight">${params.recipientEmail}</span> and will expire in 7 days.<br><br>
          If button doesn't work, copy this URL:<br>
          <span style="word-break: break-all; color: #6366f1;">${params.inviteLink}</span>
        </div>
      </div>
    </body>
    </html>
    `;

    return { subject, html, text };
}

/**
 * Generates branded HTML template for Employee Account Setup Invitation
 */
export function buildEmployeeInviteEmailTemplate(params: { inviteLink: string, employeeName: string, recipientEmail: string }): { subject: string, html: string, text: string } {
    const subject = 'Your Timesheet Portal Account Invitation';
    const text = `Hi ${params.employeeName},\n\nYou have been invited to access your Elite Timesheet Employee Portal.\n\nClick the link below to set your password and activate your account:\n${params.inviteLink}\n\nThis invitation was issued to ${params.recipientEmail}.`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; }
        .card { max-width: 540px; margin: 0 auto; background-color: #1e293b; border-radius: 20px; border: 1px solid #334155; padding: 36px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
        .brand { font-size: 20px; font-weight: 800; color: #6366f1; letter-spacing: -0.5px; margin-bottom: 24px; }
        .title { font-size: 24px; font-weight: 800; color: #ffffff; margin-bottom: 12px; line-height: 1.3; }
        .desc { font-size: 14px; line-height: 1.6; color: #94a3b8; margin-bottom: 28px; }
        .btn { display: inline-block; background-color: #6366f1; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 700; font-size: 14px; text-align: center; }
        .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; line-height: 1.5; }
        .highlight { color: #cbd5e1; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="brand">ELITE TIMESHEET OS</div>
        <div class="title">Welcome, ${params.employeeName}!</div>
        <p class="desc">
          Your manager has created your account on Elite Timesheet OS. You can now view your shift roster, log your work hours, check your leave balances, and submit fortnightly timesheets.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${params.inviteLink}" class="btn">Activate Account & Set Password →</a>
        </div>
        <div class="footer">
          This invitation was sent to <span class="highlight">${params.recipientEmail}</span>.<br><br>
          If button doesn't work, copy this URL:<br>
          <span style="word-break: break-all; color: #6366f1;">${params.inviteLink}</span>
        </div>
      </div>
    </body>
    </html>
    `;

    return { subject, html, text };
}

/**
 * Generates branded HTML template for Password Reset
 */
export function buildPasswordResetEmailTemplate(params: { resetLink: string, recipientEmail: string }): { subject: string, html: string, text: string } {
    const subject = 'Reset Your Elite Timesheet OS Password';
    const text = `Reset Your Password\n\nWe received a request to reset the password for your Elite Timesheet OS account (${params.recipientEmail}).\n\nClick the link below to set a new password:\n${params.resetLink}\n\nThis link will expire in 1 hour. If you did not request this, you can safely ignore this email.`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; }
        .card { max-width: 540px; margin: 0 auto; background-color: #1e293b; border-radius: 20px; border: 1px solid #334155; padding: 36px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
        .brand { font-size: 20px; font-weight: 800; color: #6366f1; letter-spacing: -0.5px; margin-bottom: 24px; }
        .title { font-size: 24px; font-weight: 800; color: #ffffff; margin-bottom: 12px; line-height: 1.3; }
        .desc { font-size: 14px; line-height: 1.6; color: #94a3b8; margin-bottom: 28px; }
        .btn { display: inline-block; background-color: #6366f1; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 700; font-size: 14px; text-align: center; }
        .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; line-height: 1.5; }
        .highlight { color: #cbd5e1; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="brand">ELITE TIMESHEET OS</div>
        <div class="title">Reset Your Password</div>
        <p class="desc">
          We received a request to reset your password for <span class="highlight">${params.recipientEmail}</span>. Click the button below to choose a secure new password.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${params.resetLink}" class="btn">Reset Password →</a>
        </div>
        <p class="desc" style="font-size: 12px; color: #64748b;">
          If you did not request this password reset, your account is safe and you can safely ignore this email. This link will expire in 1 hour.
        </p>
        <div class="footer">
          If button doesn't work, copy this URL:<br>
          <span style="word-break: break-all; color: #6366f1;">${params.resetLink}</span>
        </div>
      </div>
    </body>
    </html>
    `;

    return { subject, html, text };
}

/**
 * Generates branded HTML template for Two-Step Verification (2FA) OTP
 */
export function buildTwoFactorEmailTemplate(params: { code: string, recipientEmail: string }): { subject: string, html: string, text: string } {
    const subject = `Your Elite Timesheet Verification Code: ${params.code}`;
    const text = `Elite Timesheet OS Two-Step Verification\n\nYour verification code is: ${params.code}\n\nThis code will expire in 10 minutes.\n\nIf you did not attempt to sign in to ${params.recipientEmail}, someone may know your password. We recommend resetting your password immediately.`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; }
        .card { max-width: 540px; margin: 0 auto; background-color: #1e293b; border-radius: 20px; border: 1px solid #334155; padding: 36px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
        .brand { font-size: 20px; font-weight: 800; color: #6366f1; letter-spacing: -0.5px; margin-bottom: 24px; }
        .title { font-size: 24px; font-weight: 800; color: #ffffff; margin-bottom: 12px; line-height: 1.3; }
        .desc { font-size: 14px; line-height: 1.6; color: #94a3b8; margin-bottom: 20px; }
        .code-box { background-color: #0f172a; border: 2px solid #334155; border-radius: 16px; padding: 20px; text-align: center; margin: 28px 0; }
        .code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #818cf8; }
        .badge { display: inline-block; background: #1e1b4b; color: #a5b4fc; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; margin-bottom: 12px; }
        .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; line-height: 1.5; }
        .warning { color: #f87171; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="brand">ELITE TIMESHEET OS</div>
        <span class="badge">Security Verification</span>
        <div class="title">Two-Step Verification Code</div>
        <p class="desc">
          Enter this one-time code to complete sign-in for <strong style="color: #ffffff;">${params.recipientEmail}</strong>:
        </p>
        
        <div class="code-box">
          <div class="code">${params.code}</div>
        </div>

        <p class="desc" style="font-size: 13px;">
          ⏱️ This code will expire in <strong>10 minutes</strong> and can only be used once.
        </p>

        <p class="desc" style="font-size: 12px; color: #64748b;">
          <span class="warning">Did not attempt to sign in?</span> Someone may have entered your password. Please sign in and reset your password immediately to secure your account.
        </p>

        <div class="footer">
          Elite Timesheet OS Security Team &bull; Automated security notification
        </div>
      </div>
    </body>
    </html>
    `;

    return { subject, html, text };
}

/**
 * Generates branded HTML template for Suspicious / Unrecognised Login Verification
 */
export function buildSuspiciousLoginVerificationTemplate(params: {
    recipientEmail: string;
    verifyLink: string;
    verificationCode: string;
    approxLocation: string;
    deviceInfo: string;
}): { subject: string; html: string; text: string } {
    const subject = 'Security Alert: Confirm Sign-In from New Location or Device';
    const text = `Elite Timesheet OS Security Confirmation\n\nWe noticed a sign-in attempt to your account (${params.recipientEmail}) from an unrecognised location or device:\n\nApprox. Location: ${params.approxLocation}\nDevice: ${params.deviceInfo}\n\nTo confirm this sign-in, enter the following code on your sign-in screen:\n${params.verificationCode}\n\nOr click this confirmation link:\n${params.verifyLink}\n\nThis verification link and code will expire in 15 minutes.\n\nIf you did not attempt to sign in, do not confirm this request. Change your password immediately to secure your account.`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; }
        .card { max-width: 560px; margin: 0 auto; background-color: #1e293b; border-radius: 20px; border: 1px solid #334155; padding: 36px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
        .brand { font-size: 20px; font-weight: 800; color: #6366f1; letter-spacing: -0.5px; margin-bottom: 24px; }
        .alert-badge { display: inline-block; background: #7f1d1d; color: #fca5a5; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px; }
        .title { font-size: 24px; font-weight: 800; color: #ffffff; margin-bottom: 12px; line-height: 1.3; }
        .desc { font-size: 14px; line-height: 1.6; color: #94a3b8; margin-bottom: 20px; }
        .meta-table { width: 100%; background-color: #0f172a; border-radius: 12px; padding: 16px; margin: 20px 0; border: 1px solid #334155; }
        .meta-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
        .meta-label { color: #64748b; font-weight: 600; }
        .meta-value { color: #f1f5f9; font-weight: 700; }
        .code-box { background-color: #0f172a; border: 2px solid #6366f1; border-radius: 14px; padding: 18px; text-align: center; margin: 24px 0; }
        .code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #a5b4fc; }
        .btn { display: inline-block; background-color: #6366f1; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 700; font-size: 14px; text-align: center; margin-top: 8px; }
        .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; line-height: 1.5; }
        .warning { color: #f87171; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="brand">ELITE TIMESHEET OS</div>
        <span class="alert-badge">⚠️ Suspicious Sign-In Detected</span>
        <div class="title">Confirm Sign-In From New Location</div>
        <p class="desc">
          We detected an attempt to sign in to your account (<strong style="color: #ffffff;">${params.recipientEmail}</strong>) from a new or unrecognised location:
        </p>

        <div class="meta-table">
          <div class="meta-row">
            <span class="meta-label">Approx. Location:</span>
            <span class="meta-value">${params.approxLocation}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Device & Browser:</span>
            <span class="meta-value">${params.deviceInfo}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Time:</span>
            <span class="meta-value">Just now</span>
          </div>
        </div>

        <p class="desc">
          To complete your sign-in, enter this 6-digit confirmation code on your screen:
        </p>

        <div class="code-box">
          <div class="code">${params.verificationCode}</div>
        </div>

        <div style="text-align: center; margin: 24px 0;">
          <a href="${params.verifyLink}" class="btn">Authorise and Sign In Now →</a>
        </div>

        <p class="desc" style="font-size: 13px; color: #94a3b8;">
          ⏱️ This challenge will expire in <strong>15 minutes</strong> and can only be used once.
        </p>

        <p class="desc" style="font-size: 12px; color: #64748b;">
          <span class="warning">Wasn't you?</span> If you did not attempt this sign-in, someone may have obtained your password. We strongly recommend changing your password immediately.
        </p>

        <div class="footer">
          Elite Timesheet OS Security Infrastructure &bull; Automated security challenge
        </div>
      </div>
    </body>
    </html>
    `;

    return { subject, html, text };
}


