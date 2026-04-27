import type { GitHubRelease } from '../../github/github.types';
import type { EmailProvider } from '../email.provider';
import { NotificationService } from '../notification.service';

const mockEmailProvider: jest.Mocked<EmailProvider> = {
  sendEmail: jest.fn(),
};

const BASE_URL = 'http://localhost:3000';

function createService() {
  return new NotificationService(mockEmailProvider, BASE_URL);
}

const mockRelease: GitHubRelease = {
  id: 1,
  tag_name: 'v1.22.0',
  name: 'Go 1.22',
  body: 'Release notes...',
  html_url: 'https://github.com/golang/go/releases/tag/v1.22.0',
  published_at: '2024-02-06T00:00:00Z',
  draft: false,
  prerelease: false,
};

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmailProvider.sendEmail.mockResolvedValue(undefined);
  });

  describe('sendConfirmationEmail', () => {
    it('should send confirmation email with correct link', async () => {
      const service = createService();

      await service.sendConfirmationEmail('test@example.com', 'mytoken', 'golang/go');

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        'test@example.com',
        'Confirm subscription to golang/go releases',
        expect.stringContaining(`${BASE_URL}/confirm.html?token=mytoken`),
      );
    });

    it('should include repo name in subject', async () => {
      const service = createService();

      await service.sendConfirmationEmail('test@example.com', 'token', 'facebook/react');

      const [, subject] = mockEmailProvider.sendEmail.mock.calls[0];
      expect(subject).toContain('facebook/react');
    });
  });

  describe('sendReleaseNotification', () => {
    it('should send release notification with correct unsubscribe link', async () => {
      const service = createService();

      await service.sendReleaseNotification(
        'test@example.com',
        'unsubtoken',
        'golang/go',
        mockRelease,
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        'test@example.com',
        'New release: golang/go v1.22.0',
        expect.stringContaining(`${BASE_URL}/unsubscribe.html?token=unsubtoken`),
      );
    });

    it('should include release tag in subject', async () => {
      const service = createService();

      await service.sendReleaseNotification(
        'test@example.com',
        'unsubtoken',
        'golang/go',
        mockRelease,
      );

      const [, subject] = mockEmailProvider.sendEmail.mock.calls[0];
      expect(subject).toContain('v1.22.0');
    });

    it('should include release URL in email body', async () => {
      const service = createService();

      await service.sendReleaseNotification(
        'test@example.com',
        'unsubtoken',
        'golang/go',
        mockRelease,
      );

      const [, , html] = mockEmailProvider.sendEmail.mock.calls[0];
      expect(html).toContain(mockRelease.html_url);
    });
  });
});
