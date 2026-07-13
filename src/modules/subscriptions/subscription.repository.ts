import type { PrismaLike } from '@/shared/outbox';
import type { PrismaClient, Subscription } from '@prisma/client';
import type {
  ISubscriptionRepository,
  SubscriptionWithRepo,
} from './subscription.repository.interface';

export class SubscriptionRepository implements ISubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmailAndRepo(email: string, repoId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({
      where: { email_repoId: { email, repoId } },
    });
  }

  async create(
    data: { email: string; repoId: string; confirmToken: string; unsubscribeToken: string },
    tx?: PrismaLike,
  ): Promise<Subscription> {
    const client = tx ?? this.prisma;
    return client.subscription.create({ data });
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

  async findAllByEmail(email: string): Promise<SubscriptionWithRepo[]> {
    return this.prisma.subscription.findMany({
      where: { email, confirmed: true },
      include: { repo: true },
    });
  }

  async findAllConfirmedByRepoId(repoId: string): Promise<Subscription[]> {
    return this.prisma.subscription.findMany({
      where: { repoId, confirmed: true },
    });
  }
}
