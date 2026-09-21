import { sendTransactionalEmail, buildOrgInviteEmailTemplate, buildEmployeeInviteEmailTemplate } from '../src/services/emailService';

describe('Transactional Email Service Tests', () => {
    it('should generate branded org invite email template with correct links and recipients', () => {
        const inviteLink = 'http://localhost:5173/setup-org?token=testtoken123';
        const recipientEmail = 'founder@startup.io';

        const template = buildOrgInviteEmailTemplate({ inviteLink, recipientEmail });

        expect(template.subject).toContain('Welcome to Elite Timesheet OS');
        expect(template.html).toContain(inviteLink);
        expect(template.html).toContain(recipientEmail);
        expect(template.text).toContain(inviteLink);
        expect(template.text).toContain(recipientEmail);
    });

    it('should generate branded employee invite email template with employee name', () => {
        const inviteLink = 'http://localhost:5173/accept-invite?token=emptoken456';
        const employeeName = 'Sarah Connor';
        const recipientEmail = 'sarah@skynet.com';

        const template = buildEmployeeInviteEmailTemplate({ inviteLink, employeeName, recipientEmail });

        expect(template.subject).toContain('Timesheet Portal Account Invitation');
        expect(template.html).toContain('Sarah Connor');
        expect(template.html).toContain(inviteLink);
        expect(template.text).toContain('Sarah Connor');
        expect(template.text).toContain(recipientEmail);
    });

    it('should dispatch email via dev-mock transport and return delivery result without credentials leak', async () => {
        const result = await sendTransactionalEmail({
            to: 'admin@acme.com',
            subject: 'Test Subject',
            html: '<p>Hello world</p>',
            text: 'Hello world'
        });

        expect(result.success).toBe(true);
        expect(result.provider).toBeDefined();
        expect(result.messageId).toBeDefined();
        expect(result.error).toBeUndefined();
    });

    it('should return explicit failure if EMAIL_PROVIDER=resend but RESEND_API_KEY is missing', async () => {
        const originalProvider = process.env.EMAIL_PROVIDER;
        const originalKey = process.env.RESEND_API_KEY;

        process.env.EMAIL_PROVIDER = 'resend';
        delete process.env.RESEND_API_KEY;

        try {
            const result = await sendTransactionalEmail({
                to: 'admin@acme.com',
                subject: 'Test',
                html: '<p>Test</p>'
            });

            expect(result.success).toBe(false);
            expect(result.provider).toBe('resend');
            expect(result.error).toBe('NOT_CONFIGURED');
        } finally {
            process.env.EMAIL_PROVIDER = originalProvider;
            if (originalKey) process.env.RESEND_API_KEY = originalKey;
        }
    });

    it('should report a generic failure (and never reroute) when Resend rejects the message', async () => {
        const originalProvider = process.env.EMAIL_PROVIDER;
        const originalKey = process.env.RESEND_API_KEY;
        const originalFetch = global.fetch;

        process.env.EMAIL_PROVIDER = 'resend';
        process.env.RESEND_API_KEY = 're_test_fake_key';

        // Mock fetch returning Resend 403 domain error
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            json: async () => ({
                statusCode: 403,
                message: 'The domain elitetimesheet.com is not verified. Please verify your domain.'
            })
        } as any);

        try {
            const result = await sendTransactionalEmail({
                to: 'admin@acme.com',
                subject: 'Test',
                html: '<p>Test</p>'
            });

            expect(result.success).toBe(false);
            expect(result.provider).toBe('resend');
            // Provider response text is never surfaced; only a generic code.
            expect(result.error).toBe('PROVIDER_REJECTED');
        } finally {
            process.env.EMAIL_PROVIDER = originalProvider;
            if (originalKey) process.env.RESEND_API_KEY = originalKey;
            global.fetch = originalFetch;
        }
    });
});

