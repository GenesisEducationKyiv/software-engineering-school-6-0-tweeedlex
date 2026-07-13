import type { SubscriptionWithRepo } from './subscription.repository.interface';
import type { SubscriptionResponse } from './subscription.types';

export const toSubscriptionResponse = (row: SubscriptionWithRepo): SubscriptionResponse => ({
  email: row.email,
  repo: `${row.repo.owner}/${row.repo.name}`,
  confirmed: row.confirmed,
  last_seen_tag: row.repo.lastSeenTag,
});

export const toSubscriptionResponses = (rows: SubscriptionWithRepo[]): SubscriptionResponse[] =>
  rows.map(toSubscriptionResponse);
