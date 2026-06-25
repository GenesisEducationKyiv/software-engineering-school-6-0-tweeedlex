import type { Repo, Subscription } from '@prisma/client';
export type SubscriptionWithRepo = Subscription & { repo: Repo };

export interface ISubscriptionRepository {
  findByEmailAndRepo(email: string, repoId: string): Promise<Subscription | null>;
  create(data: {
    email: string;
    repoId: string;
    confirmToken: string;
    unsubscribeToken: string;
  }): Promise<Subscription>;
  findByConfirmToken(token: string): Promise<SubscriptionWithRepo | null>;
  findByUnsubscribeToken(token: string): Promise<SubscriptionWithRepo | null>;
  confirmSubscription(id: string): Promise<void>;
  deleteSubscription(id: string): Promise<void>;
  findAllByEmail(email: string): Promise<SubscriptionWithRepo[]>;
  findAllConfirmedByRepoId(repoId: string): Promise<Subscription[]>;
}

export interface IRepoRepository {
  findOrCreate(owner: string, name: string): Promise<Repo>;
  findDistinctConfirmed(): Promise<Repo[]>;
  updateLastSeenTag(repoId: string, tag: string): Promise<void>;
}
