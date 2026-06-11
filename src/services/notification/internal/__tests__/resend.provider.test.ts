import type { ILogger } from '@/shared/logger';
import { ResendEmailProvider } from '../resend.provider';

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn(),
    },
  })),
}));

const FROM_ADDRESS = 'GitHub Release Notifier <noreply@tweeedlex.xyz>';

const mockLogger: jest.Mocked<ILogger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as jest.Mocked<ILogger>;

function createProvider() {
  return new ResendEmailProvider('test-api-key', FROM_ADDRESS, mockLogger);
}

describe('ResendEmailProvider', () => {
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    const { Resend } = require('resend');
    mockSend =
      Resend.mock.results[Resend.mock.results.length - 1]?.value?.emails?.send ?? jest.fn();
    Resend.mockImplementation(() => ({
      emails: { send: mockSend },
    }));
  });

  it('should send email with correct parameters', async () => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: '123' }, error: null });
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({ emails: { send: mockSend } }));

    const provider = createProvider();
    await provider.sendEmail('test@example.com', 'Test Subject', '<p>Hello</p>');

    expect(mockSend).toHaveBeenCalledWith({
      from: FROM_ADDRESS,
      to: 'test@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
    });
  });

  it('should throw when Resend returns an error', async () => {
    mockSend = jest.fn().mockResolvedValue({ data: null, error: { message: 'Invalid API key' } });
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({ emails: { send: mockSend } }));

    const provider = createProvider();

    await expect(provider.sendEmail('test@example.com', 'Subject', '<p>Hello</p>')).rejects.toThrow(
      'Email send failed: Invalid API key',
    );
  });

  it('should not throw when send succeeds', async () => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: '456' }, error: null });
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({ emails: { send: mockSend } }));

    const provider = createProvider();

    await expect(
      provider.sendEmail('user@example.com', 'Subject', '<p>Body</p>'),
    ).resolves.toBeUndefined();
  });

  it('should log success after sending', async () => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: '789' }, error: null });
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({ emails: { send: mockSend } }));

    const provider = createProvider();
    await provider.sendEmail('user@example.com', 'Subject', '<p>Body</p>');

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.com' }),
      expect.any(String),
    );
  });

  it('should log error before throwing', async () => {
    mockSend = jest.fn().mockResolvedValue({ data: null, error: { message: 'Rate limited' } });
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({ emails: { send: mockSend } }));

    const provider = createProvider();

    await expect(
      provider.sendEmail('user@example.com', 'Subject', '<p>Body</p>'),
    ).rejects.toThrow();

    expect(mockLogger.error).toHaveBeenCalled();
  });
});
