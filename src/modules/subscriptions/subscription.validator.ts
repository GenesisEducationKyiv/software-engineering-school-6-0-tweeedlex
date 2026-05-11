import { ValidationError } from '@/shared/errors/app-error';
import {
  isValidEmail,
  isValidRepoFormat,
  isValidToken,
  parseRepo,
} from '@/shared/utils/validation';

export class SubscriptionValidator {
  assertRepoSlug(slug: string): void {
    if (!isValidRepoFormat(slug))
      throw new ValidationError('Invalid repository format. Expected: owner/repo');
  }
  assertEmail(email: string): void {
    if (!isValidEmail(email)) throw new ValidationError('Invalid email address');
  }
  assertToken(token: string): void {
    if (!isValidToken(token)) throw new ValidationError('Invalid token format');
  }
  parseSlug(slug: string): { owner: string; name: string } {
    this.assertRepoSlug(slug);
    return parseRepo(slug);
  }
}
