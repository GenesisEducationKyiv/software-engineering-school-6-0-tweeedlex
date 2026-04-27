import type { PrismaClient, Repo, Subscription } from '@prisma/client';
import type { SubscriptionResponse } from './subscription.types';

export type SubscriptionWithRepo = Subscription & { repo: Repo };

export class SubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmailAndRepo(email: string, repoId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({
      where: { email_repoId: { email, repoId } },
    });
  }

  async create(data: {
    email: string;
    repoId: string;
    confirmToken: string;
    unsubscribeToken: string;
  }): Promise<Subscription> {
    return this.prisma.subscription.create({ data });
  }

  async findByConfirmToken(token: string): Promise<SubscriptionWithRepo | null> {
    return this.prisma.subscription.findUnique({
      where: { confirmToken: token },
      include: { repo: true },
    });
  }

  async findByUnsubscribeToken(token: string): Promise<SubscriptionWithRepo | null> {
    return this.prisma.subscription.findUnique({
      where: { unsubscribeToken: token },
      include: { repo: true },
    });
  }

  async confirmSubscription(id: string): Promise<void> {
    await this.prisma.subscription.update({
      where: { id },
      data: { confirmed: true, confirmToken: null },
    });
  }

  async deleteSubscription(id: string): Promise<void> {
    await this.prisma.subscription.delete({ where: { id } });
  }

  async findAllByEmail(email: string): Promise<SubscriptionResponse[]> {
    const subs = await this.prisma.subscription.findMany({
      where: { email, confirmed: true },
      include: { repo: true },
    });

    return subs.map((sub) => ({
      email: sub.email,
      repo: `${sub.repo.owner}/${sub.repo.name}`,
      confirmed: sub.confirmed,
      last_seen_tag: sub.repo.lastSeenTag,
    }));
  }

  async findOrCreateRepo(owner: string, name: string): Promise<Repo> {
    return this.prisma.repo.upsert({
      where: { owner_name: { owner, name } },
      create: { owner, name },
      update: {},
    });
  }

  async findAllConfirmedByRepoId(repoId: string): Promise<Subscription[]> {
    return this.prisma.subscription.findMany({
      where: { repoId, confirmed: true },
    });
  }

  async findDistinctConfirmedRepos(): Promise<Repo[]> {
    return this.prisma.repo.findMany({
      where: {
        subscriptions: {
          some: { confirmed: true },
        },
      },
    });
  }

  async updateRepoLastSeenTag(repoId: string, tag: string): Promise<void> {
    await this.prisma.repo.update({
      where: { id: repoId },
      data: { lastSeenTag: tag },
    });
  }
}
