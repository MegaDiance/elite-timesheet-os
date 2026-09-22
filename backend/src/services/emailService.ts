/**
 * Transactional email delivery.
 *
 * Security rules:
 * - A message is only ever sent to `options.to`, which callers must take from
 *   trusted server-side state (the users / invitations tables), never from a
 *   request body or a provider response.
 * - There is NO fallback / rerouting recipient. If the provider rejects a send
 *   (e.g. Resend 403 for an unverified domain) the send fails and the caller
 *   receives a generic error code. Provider response bodies are never parsed
 *   for alternative addresses and never returned to API clients.
 * - The mock transport is used automatically only in tests and in an explicit
 *   NODE_ENV=development environment. Message bodies (which may contain
 *   one-time links or codes) are printed only in development, never in tests
 *   or production.
 */

export interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export type EmailFailureCode = 'NOT_CONFIGURED' | 'PROVIDER_REJECTED' | 'NETWORK_ERROR' | 'INVALID_RECIPIENT' | 'EMAIL_DISABLED';

export interface EmailDeliveryResult {
    success: boolean;
    provider: string;
    messageId?: string;
    /** Generic failure code. Safe to store; never contains provider response text. */
    error?: EmailFailureCode;
}

export interface CapturedEmail extends EmailOptions {
    messageId: string;
    sentAt: string;
}

// Messages "sent" through the mock transport while NODE_ENV=test, for assertions.
const testOutbox: CapturedEmail[] = [];

export function getTestOutbox(): CapturedEmail[] {
    return testOutbox;
}

export function clearTestOutbox(): void {
    testOutbox.length = 0;
}

/**
 * Whether the app should attempt to send transactional email at all. This is the MVP on/off
 * switch (`EMAIL_ENABLED`), separate from whether a transport is configured: while it is off,
 * every flow that would normally email something (invitations, password resets, 2FA codes,
 * login alerts) must fall back to its no-email alternative instead of trying to send, and must
 * never say an email was sent. Unset defaults to on during automated tests (so existing email
 * content/delivery coverage keeps running) and to off everywhere else, per "email is off for
 * the MVP". Either state can be forced with `EMAIL_ENABLED=true` / `EMAIL_ENABLED=false`.
 */
export function isEmailSendingEnabled(): boolean {
    const raw = (process.env.EMAIL_ENABLED || '').trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return process.env.NODE_ENV === 'test';
}

type ProviderName = 'resend' | 'postmark' | 'mock' | 'none';

function resolveProvider(): ProviderName {
    const configured = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
    const env = process.env.NODE_ENV;

    if (configured === 'resend') return 'resend';
    if (configured === 'postmark') return 'postmark';
    if (configured === 'mock' || configured === 'dev-mock' || configured === 'test') {
        // The mock transport never delivers mail, so it is refused in production.
        return env === 'production' ? 'none' : 'mock';
    }

    if (env === 'test') return 'mock';
    if (process.env.RESEND_API_KEY) return 'resend';
    if (process.env.POSTMARK_SERVER_TOKEN) return 'postmark';
    if (env === 'development') return 'mock';
    return 'none';
}

/**
 * True when a real (or, outside production, mock) transport is available.
 * Flows that depend on email (invitations, password reset, 2FA) must check
 * this and fail clearly instead of silently producing an undeliverable secret.
 */
export function isEmailDeliveryConfigured(): boolean {
    if (!isEmailSendingEnabled()) return false;
    const provider = resolveProvider();
    if (provider === 'resend') return Boolean(process.env.RESEND_API_KEY);
    if (provider === 'postmark') return Boolean(process.env.POSTMARK_SERVER_TOKEN);
    return provider === 'mock';
}

function isPlausibleRecipient(address: string): boolean {
    return typeof address === 'string' && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(address.trim());
}

function maskForLog(address: string): string {
    const [local, domain] = address.split('@');
    if (!domain) return '***';
    return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Sends one transactional email to exactly `options.to`.
 */
export async function sendTransactionalEmail(options: EmailOptions): Promise<EmailDeliveryResult> {
    if (!isEmailSendingEnabled()) {
        return { success: false, provider: 'none', error: 'EMAIL_DISABLED' };
    }

    const provider = resolveProvider();
    const fromAddress = process.env.EMAIL_FROM || 'SimpleHours <onboarding@resend.dev>';
    const text = options.text || options.html.replace(/<[^>]*>?/gm, '');

    if (!isPlausibleRecipient(options.to)) {
        return { success: false, provider, error: 'INVALID_RECIPIENT' };
    }

    if (provider === 'resend') {
        if (!process.env.RESEND_API_KEY) {
            console.error('[EMAIL] Resend selected but RESEND_API_KEY is not set.');
            return { success: false, provider, error: 'NOT_CONFIGURED' };
        }
        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ from: fromAddress, to: options.to, subject: options.subject, html: options.html, text }),
            });
            if (res.ok) {
                const data: any = await res.json().catch(() => ({}));
                return { success: true, provider, messageId: data?.id };
            }
            // Log only the status. The response body is not parsed for anything.
            console.error(`[EMAIL] Resend rejected message to ${maskForLog(options.to)} (HTTP ${res.status}).`);
            return { success: false, provider, error: 'PROVIDER_REJECTED' };
        } catch {
            console.error(`[EMAIL] Network error contacting Resend for ${maskForLog(options.to)}.`);
            return { success: false, provider, error: 'NETWORK_ERROR' };
        }
    }

    if (provider === 'postmark') {
        if (!process.env.POSTMARK_SERVER_TOKEN) {
            console.error('[EMAIL] Postmark selected but POSTMARK_SERVER_TOKEN is not set.');
            return { success: false, provider, error: 'NOT_CONFIGURED' };
        }
        try {
            const res = await fetch('https://api.postmarkapp.com/email', {
                method: 'POST',
                headers: {
                    'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ From: fromAddress, To: options.to, Subject: options.subject, HtmlBody: options.html, TextBody: text }),
            });
            if (res.ok) {
                const data: any = await res.json().catch(() => ({}));
                return { success: true, provider, messageId: data?.MessageID };
            }
            console.error(`[EMAIL] Postmark rejected message to ${maskForLog(options.to)} (HTTP ${res.status}).`);
            return { success: false, provider, error: 'PROVIDER_REJECTED' };
        } catch {
            console.error(`[EMAIL] Network error contacting Postmark for ${maskForLog(options.to)}.`);
            return { success: false, provider, error: 'NETWORK_ERROR' };
        }
    }

    if (provider === 'mock') {
        const messageId = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        if (process.env.NODE_ENV === 'test') {
            testOutbox.push({ ...options, text, messageId, sentAt: new Date().toISOString() });
        } else if (process.env.NODE_ENV === 'development') {
            // Development only: print the message so one-time links can be used locally.
            console.log(`\n[EMAIL:DEV-ONLY] To: ${options.to}\nSubject: ${options.subject}\n${text}\n`);
        }
        return { success: true, provider, messageId };
    }

    console.error('[EMAIL] No email provider is configured; message not sent.');
    return { success: false, provider, error: 'NOT_CONFIGURED' };
}

function escapeHtml(value: string): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Shared layout for "click this single-use link" emails. All interpolated values are escaped. */
function buildActionEmail(params: { title: string; body: string; buttonLabel: string; link: string; footer: string }): string {
    const link = escapeHtml(params.link);
    return `
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
      </style>
    </head>
    <body>
      <div class="card">
        <div class="brand">SIMPLEHOURS</div>
        <div class="title">${escapeHtml(params.title)}</div>
        <p class="desc">${escapeHtml(params.body)}</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${link}" class="btn">${escapeHtml(params.buttonLabel)} →</a>
        </div>
        <div class="footer">
          ${escapeHtml(params.footer)}<br><br>
          If the button doesn't work, copy this URL:<br>
          <span style="word-break: break-all; color: #6366f1;">${link}</span>
        </div>
      </div>
    </body>
    </html>
    `;
}

/**
 * Organisation sign-up: the link lets the recipient create an organisation and become its Owner.
 */
export function buildOrganisationSetupEmailTemplate(params: { setupLink: string, recipientEmail: string }): { subject: string, html: string, text: string } {
    const subject = 'Set up your SimpleHours organisation';
    const footer = `This single-use link was requested for ${params.recipientEmail} and expires in 24 hours. If you did not request it, you can ignore this email.`;
    const text = `Set up your SimpleHours organisation\n\nUse the link below to create your organisation. You will become its Organisation Owner.\n\n${params.setupLink}\n\n${footer}`;
    const html = buildActionEmail({
        title: 'Set up your organisation',
        body: 'Use the button below to create your organisation on SimpleHours. You will become its Organisation Owner, and can then add branches and invite Branch Admins.',
        buttonLabel: 'Create organisation',
        link: params.setupLink,
        footer,
    });
    return { subject, html, text };
}

/**
 * Branch Admin invitation, sent by an Organisation Owner.
 */
export function buildBranchAdminInviteEmailTemplate(params: {
    inviteLink: string,
    recipientEmail: string,
    organisationName: string,
    branchNames: string[],
}): { subject: string, html: string, text: string } {
    const branches = params.branchNames.join(', ');
    const subject = `You have been invited to manage ${params.organisationName} on SimpleHours`;
    const footer = `This single-use invitation was issued to ${params.recipientEmail} and expires in 7 days.`;
    const body = `You have been invited to be a Branch Admin at ${params.organisationName} for: ${branches}. Branch Admins manage the workers, roster and timesheets of their assigned branches.`;
    const text = `${subject}\n\n${body}\n\nAccept the invitation:\n${params.inviteLink}\n\n${footer}`;
    const html = buildActionEmail({
        title: `Branch Admin invitation — ${params.organisationName}`,
        body,
        buttonLabel: 'Accept invitation',
        link: params.inviteLink,
        footer,
    });
    return { subject, html, text };
}

/**
 * Generates branded HTML template for Password Reset
 */
export function buildPasswordResetEmailTemplate(params: { resetLink: string, recipientEmail: string }): { subject: string, html: string, text: string } {
    const subject = 'Reset Your SimpleHours Password';
    const text = `Reset Your Password\n\nWe received a request to reset the password for your SimpleHours account (${params.recipientEmail}).\n\nClick the link below to set a new password:\n${params.resetLink}\n\nThis link will expire in 1 hour. If you did not request this, you can safely ignore this email.`;

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
        <div class="brand">SIMPLEHOURS</div>
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
    const subject = `Your SimpleHours Verification Code: ${params.code}`;
    const text = `SimpleHours Two-Step Verification\n\nYour verification code is: ${params.code}\n\nThis code will expire in 10 minutes.\n\nIf you did not attempt to sign in to ${params.recipientEmail}, someone may know your password. We recommend resetting your password immediately.`;

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
        <div class="brand">SIMPLEHOURS</div>
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
          SimpleHours Security Team &bull; Automated security notification
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
    const text = `SimpleHours Security Confirmation\n\nWe noticed a sign-in attempt to your account (${params.recipientEmail}) from an unrecognised location or device:\n\nApprox. Location: ${params.approxLocation}\nDevice: ${params.deviceInfo}\n\nTo confirm this sign-in, enter the following code on your sign-in screen:\n${params.verificationCode}\n\nOr click this confirmation link:\n${params.verifyLink}\n\nThis verification link and code will expire in 15 minutes.\n\nIf you did not attempt to sign in, do not confirm this request. Change your password immediately to secure your account.`;

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
        <div class="brand">SIMPLEHOURS</div>
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
          SimpleHours Security Infrastructure &bull; Automated security challenge
        </div>
      </div>
    </body>
    </html>
    `;

    return { subject, html, text };
}


