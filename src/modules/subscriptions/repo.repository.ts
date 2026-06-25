import type { PrismaClient, Repo } from '@prisma/client';
import type { IRepoRepository } from './subscription.repository.interface';

export class RepoRepository implements IRepoRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findOrCreate(owner: string, name: string): Promise<Repo> {
    return this.prisma.repo.upsert({
      where: { owner_name: { owner, name } },
      create: { owner, name },
      update: {},
    });
  }

  async findDistinctConfirmed(): Promise<Repo[]> {
    return this.prisma.repo.findMany({
      where: { subscriptions: { some: { confirmed: true } } },
    });
  }

  async updateLastSeenTag(repoId: string, tag: string): Promise<void> {
    await this.prisma.repo.update({ where: { id: repoId }, data: { lastSeenTag: tag } });
  }
}
