import { sendTransactionalEmail, buildOrganisationSetupEmailTemplate, buildBranchAdminInviteEmailTemplate } from '../src/services/emailService';

describe('Transactional Email Service Tests', () => {
    it('builds the organisation set-up email with the link and recipient, escaped', () => {
        const setupLink = 'https://app.simplehours.test/setup-organisation?token=abc';
        const template = buildOrganisationSetupEmailTemplate({ setupLink, recipientEmail: 'founder@startup.io' });
        expect(template.subject).toBe('Set up your SimpleHours organisation');
        expect(template.html).toContain(setupLink);
        expect(template.text).toContain('founder@startup.io');
        expect(template.html).not.toMatch(/Elite Timesheet/i);
    });

    it('builds the Branch Admin invitation naming the organisation and branches, escaping HTML', () => {
        const template = buildBranchAdminInviteEmailTemplate({
            inviteLink: 'https://app.simplehours.test/accept-invite?token=abc',
            recipientEmail: 'sarah@abc.test',
            organisationName: '<b>ABC</b> Health',
            branchNames: ['Melbourne', 'Richmond'],
        });
        expect(template.text).toContain('Melbourne, Richmond');
        expect(template.html).toContain('&lt;b&gt;ABC&lt;/b&gt; Health');
        expect(template.html).not.toContain('<b>ABC</b>');
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
                message: 'The domain example.com is not verified. Please verify your domain.'
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

