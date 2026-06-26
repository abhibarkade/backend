import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HistoryStatus, TagVariant } from '@prisma/client';

@Injectable()
export class HistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUser(userId: string, opts: { page: number; limit: number; status?: string; q?: string }) {
    const where: any = { userId };
    if (opts.status) where.status = opts.status as HistoryStatus;
    if (opts.q) {
      where.OR = [
        { role: { contains: opts.q, mode: 'insensitive' } },
        { company: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.historyEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    });
  }

  findOneOwned(id: string, userId: string) {
    return this.prisma.historyEntry.findFirst({ where: { id, userId } });
  }

  update(id: string, data: { status?: HistoryStatus; tagLabel?: string; tagVariant?: TagVariant }) {
    return this.prisma.historyEntry.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.historyEntry.delete({ where: { id } });
  }

  deleteAllByUser(userId: string) {
    return this.prisma.historyEntry.deleteMany({ where: { userId } });
  }
}
