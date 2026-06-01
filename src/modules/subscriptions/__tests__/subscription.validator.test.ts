import { ValidationError } from '@/shared/errors/app-error';
import { SubscriptionValidator } from '../subscription.validator';

describe('SubscriptionValidator', () => {
  const validator = new SubscriptionValidator();

  it('parses owner/repo slugs', () => {
    expect(validator.parseSlug('golang/go')).toEqual({ owner: 'golang', name: 'go' });
  });

  it('parses GitHub repository URLs', () => {
    expect(validator.parseSlug('https://github.com/nodejs/node')).toEqual({
      owner: 'nodejs',
      name: 'node',
    });
    expect(validator.parseSlug('https://www.github.com/vercel/next.js/releases')).toEqual({
      owner: 'vercel',
      name: 'next.js',
    });
  });

  it('rejects invalid repository formats', () => {
    expect(() => validator.parseSlug('missing-slash')).toThrow(ValidationError);
    expect(() => validator.parseSlug('https://example.com/golang/go')).toThrow(ValidationError);
    expect(() => validator.parseSlug('https://github.com/golang')).toThrow(ValidationError);
  });

  it('validates email addresses', () => {
    expect(() => validator.assertEmail('test@example.com')).not.toThrow();
    expect(() => validator.assertEmail('bad-email')).toThrow(ValidationError);
  });

  it('validates tokens', () => {
    expect(() =>
      validator.assertToken('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ).not.toThrow();
    expect(() => validator.assertToken('short')).toThrow(ValidationError);
  });
});
