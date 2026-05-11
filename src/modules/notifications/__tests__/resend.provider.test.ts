import { ResendEmailProvider } from '../resend.provider';

const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

describe('ResendEmailProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should send email successfully and not throw', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-id' }, error: null });

    const provider = new ResendEmailProvider('test-api-key');
    await expect(
      provider.sendEmail('to@example.com', 'Subject', '<p>Hello</p>'),
    ).resolves.toBeUndefined();
  });

  it('should throw when resend returns an error', async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: 'Invalid API key' } });

    const provider = new ResendEmailProvider('bad-key');
    await expect(
      provider.sendEmail('to@example.com', 'Subject', '<p>Hello</p>'),
    ).rejects.toThrow('Email send failed: Invalid API key');
  });

  it('should send from the correct sender address', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-id' }, error: null });

    const provider = new ResendEmailProvider('test-api-key');
    await provider.sendEmail('to@example.com', 'Subject', '<p>Hello</p>');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'GitHub Release Notifier <noreply@tweeedlex.xyz>',
      }),
    );
  });

  it('should forward to, subject and html to the API', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-id' }, error: null });

    const provider = new ResendEmailProvider('test-api-key');
    await provider.sendEmail('user@example.com', 'New release: v1.0', '<h1>v1.0</h1>');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'New release: v1.0',
        html: '<h1>v1.0</h1>',
      }),
    );
  });
});
