import * as grpc from '@grpc/grpc-js';
import {
  ConflictError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../../../shared/errors/app-error';
import type { ILogger } from '../../../shared/logger';
import type { SubscriptionService } from '../../subscriptions/subscription.service';
import { buildGrpcServer } from '../grpc.server';

type GrpcHandler = (...args: unknown[]) => unknown;

let capturedHandlers: Record<string, GrpcHandler> = {};

jest.mock('@grpc/grpc-js', () => {
  const original = jest.requireActual('@grpc/grpc-js');
  return {
    ...original,
    Server: jest.fn().mockImplementation(() => ({
      addService: jest.fn((_service: unknown, impl: Record<string, GrpcHandler>) => {
        capturedHandlers = impl;
      }),
    })),
    loadPackageDefinition: jest.fn().mockReturnValue({
      subscription: {
        SubscriptionService: { service: {} },
      },
    }),
  };
});

jest.mock('@grpc/proto-loader', () => ({
  loadSync: jest.fn().mockReturnValue({}),
}));

const TEST_API_KEY = 'test-api-key';

const mockService: jest.Mocked<SubscriptionService> = {
  subscribe: jest.fn(),
  confirm: jest.fn(),
  unsubscribe: jest.fn(),
  getSubscriptions: jest.fn(),
} as unknown as jest.Mocked<SubscriptionService>;

const mockLogger: jest.Mocked<ILogger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as jest.Mocked<ILogger>;

function makeCall(request: object, metadataEntries: Record<string, string[]> = {}) {
  return {
    request,
    metadata: {
      get: (key: string) => metadataEntries[key] ?? [],
    },
  };
}

describe('gRPC Server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedHandlers = {};
    buildGrpcServer({ subscriptionService: mockService, apiKey: TEST_API_KEY, logger: mockLogger });
  });

  describe('subscribe handler', () => {
    it('should call service and return success with valid API key', async () => {
      mockService.subscribe.mockResolvedValue(undefined);
      const callback = jest.fn();
      const call = makeCall(
        { email: 'test@example.com', repo: 'golang/go' },
        { 'x-api-key': [TEST_API_KEY] },
      );

      await capturedHandlers.subscribe(call, callback);

      expect(mockService.subscribe).toHaveBeenCalledWith('test@example.com', 'golang/go');
      expect(callback).toHaveBeenCalledWith(null, {
        message: expect.stringContaining('Subscription successful'),
      });
    });

    it('should return UNAUTHENTICATED when API key is missing', async () => {
      const callback = jest.fn();
      const call = makeCall({ email: 'test@example.com', repo: 'golang/go' });

      await capturedHandlers.subscribe(call, callback);

      expect(mockService.subscribe).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.UNAUTHENTICATED }),
      );
    });

    it('should return UNAUTHENTICATED when API key is wrong', async () => {
      const callback = jest.fn();
      const call = makeCall(
        { email: 'test@example.com', repo: 'golang/go' },
        { 'x-api-key': ['wrong-key'] },
      );

      await capturedHandlers.subscribe(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.UNAUTHENTICATED }),
      );
    });

    it('should return INVALID_ARGUMENT when service throws ValidationError', async () => {
      mockService.subscribe.mockRejectedValue(new ValidationError('Invalid email'));
      const callback = jest.fn();
      const call = makeCall({ email: 'bad', repo: 'golang/go' }, { 'x-api-key': [TEST_API_KEY] });

      await capturedHandlers.subscribe(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.INVALID_ARGUMENT }),
      );
    });

    it('should return NOT_FOUND when service throws NotFoundError', async () => {
      mockService.subscribe.mockRejectedValue(new NotFoundError('Repo not found'));
      const callback = jest.fn();
      const call = makeCall(
        { email: 'test@example.com', repo: 'no/repo' },
        { 'x-api-key': [TEST_API_KEY] },
      );

      await capturedHandlers.subscribe(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.NOT_FOUND }),
      );
    });

    it('should return ALREADY_EXISTS when service throws ConflictError', async () => {
      mockService.subscribe.mockRejectedValue(new ConflictError('Already subscribed'));
      const callback = jest.fn();
      const call = makeCall(
        { email: 'test@example.com', repo: 'golang/go' },
        { 'x-api-key': [TEST_API_KEY] },
      );

      await capturedHandlers.subscribe(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.ALREADY_EXISTS }),
      );
    });

    it('should return RESOURCE_EXHAUSTED when service throws RateLimitError', async () => {
      mockService.subscribe.mockRejectedValue(new RateLimitError(3600));
      const callback = jest.fn();
      const call = makeCall(
        { email: 'test@example.com', repo: 'golang/go' },
        { 'x-api-key': [TEST_API_KEY] },
      );

      await capturedHandlers.subscribe(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.RESOURCE_EXHAUSTED }),
      );
    });

    it('should return INTERNAL when service throws a non-AppError', async () => {
      mockService.subscribe.mockRejectedValue(new Error('Unexpected failure'));
      const callback = jest.fn();
      const call = makeCall(
        { email: 'test@example.com', repo: 'golang/go' },
        { 'x-api-key': [TEST_API_KEY] },
      );

      await capturedHandlers.subscribe(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.INTERNAL, message: 'Internal server error' }),
      );
    });
  });

  describe('confirm handler', () => {
    it('should confirm subscription successfully', async () => {
      mockService.confirm.mockResolvedValue(undefined);
      const callback = jest.fn();
      const call = makeCall({ token: 'validtoken123' });

      await capturedHandlers.confirm(call, callback);

      expect(mockService.confirm).toHaveBeenCalledWith('validtoken123');
      expect(callback).toHaveBeenCalledWith(null, {
        message: 'Subscription confirmed successfully',
      });
    });

    it('should return NOT_FOUND when service throws NotFoundError', async () => {
      mockService.confirm.mockRejectedValue(new NotFoundError('Token not found'));
      const callback = jest.fn();
      const call = makeCall({ token: 'unknowntoken' });

      await capturedHandlers.confirm(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.NOT_FOUND }),
      );
    });

    it('should return INTERNAL when service throws a non-AppError', async () => {
      mockService.confirm.mockRejectedValue(new Error('DB crash'));
      const callback = jest.fn();
      const call = makeCall({ token: 'sometoken' });

      await capturedHandlers.confirm(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.INTERNAL }),
      );
    });
  });

  describe('unsubscribe handler', () => {
    it('should unsubscribe successfully', async () => {
      mockService.unsubscribe.mockResolvedValue(undefined);
      const callback = jest.fn();
      const call = makeCall({ token: 'validtoken456' });

      await capturedHandlers.unsubscribe(call, callback);

      expect(mockService.unsubscribe).toHaveBeenCalledWith('validtoken456');
      expect(callback).toHaveBeenCalledWith(null, { message: 'Unsubscribed successfully' });
    });

    it('should return NOT_FOUND when service throws NotFoundError', async () => {
      mockService.unsubscribe.mockRejectedValue(new NotFoundError('Token not found'));
      const callback = jest.fn();
      const call = makeCall({ token: 'badtoken' });

      await capturedHandlers.unsubscribe(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.NOT_FOUND }),
      );
    });
  });

  describe('getSubscriptions handler', () => {
    const mockSubs = [
      { email: 'test@example.com', repo: 'golang/go', confirmed: true, last_seen_tag: 'v1.22.0' },
    ];

    it('should return subscriptions when API key is in metadata', async () => {
      mockService.getSubscriptions.mockResolvedValue(mockSubs);
      const callback = jest.fn();
      const call = makeCall({ email: 'test@example.com' }, { 'x-api-key': [TEST_API_KEY] });

      await capturedHandlers.getSubscriptions(call, callback);

      expect(mockService.getSubscriptions).toHaveBeenCalledWith('test@example.com');
      expect(callback).toHaveBeenCalledWith(null, {
        subscriptions: [
          {
            email: 'test@example.com',
            repo: 'golang/go',
            confirmed: true,
            lastSeenTag: 'v1.22.0',
          },
        ],
      });
    });

    it('should accept API key from request field when metadata is empty', async () => {
      mockService.getSubscriptions.mockResolvedValue(mockSubs);
      const callback = jest.fn();
      const call = makeCall({ email: 'test@example.com', apiKey: TEST_API_KEY });

      await capturedHandlers.getSubscriptions(call, callback);

      expect(mockService.getSubscriptions).toHaveBeenCalledWith('test@example.com');
      expect(callback).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ subscriptions: expect.any(Array) }),
      );
    });

    it('should return UNAUTHENTICATED when key is invalid', async () => {
      const callback = jest.fn();
      const call = makeCall({ email: 'test@example.com' }, { 'x-api-key': ['wrong'] });

      await capturedHandlers.getSubscriptions(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.UNAUTHENTICATED }),
      );
    });

    it('should map null last_seen_tag to empty string', async () => {
      mockService.getSubscriptions.mockResolvedValue([
        { email: 'test@example.com', repo: 'golang/go', confirmed: true, last_seen_tag: null },
      ]);
      const callback = jest.fn();
      const call = makeCall({ email: 'test@example.com' }, { 'x-api-key': [TEST_API_KEY] });

      await capturedHandlers.getSubscriptions(call, callback);

      const [, response] = callback.mock.calls[0];
      expect(response.subscriptions[0].lastSeenTag).toBe('');
    });

    it('should return empty subscriptions array when none found', async () => {
      mockService.getSubscriptions.mockResolvedValue([]);
      const callback = jest.fn();
      const call = makeCall({ email: 'nobody@example.com' }, { 'x-api-key': [TEST_API_KEY] });

      await capturedHandlers.getSubscriptions(call, callback);

      expect(callback).toHaveBeenCalledWith(null, { subscriptions: [] });
    });

    it('should return INVALID_ARGUMENT when service throws ValidationError', async () => {
      mockService.getSubscriptions.mockRejectedValue(new ValidationError('Invalid email'));
      const callback = jest.fn();
      const call = makeCall({ email: 'bad' }, { 'x-api-key': [TEST_API_KEY] });

      await capturedHandlers.getSubscriptions(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.INVALID_ARGUMENT }),
      );
    });

    it('should return INTERNAL when service throws a non-AppError', async () => {
      mockService.getSubscriptions.mockRejectedValue(new Error('DB crash'));
      const callback = jest.fn();
      const call = makeCall({ email: 'test@example.com' }, { 'x-api-key': [TEST_API_KEY] });

      await capturedHandlers.getSubscriptions(call, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpc.status.INTERNAL }),
      );
    });
  });
});
