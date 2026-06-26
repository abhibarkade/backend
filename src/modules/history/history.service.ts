import { Injectable, NotFoundException } from '@nestjs/common';
import { HistoryRepository } from './history.repository';
import { HistoryStatus, TagVariant } from '@prisma/client';

@Injectable()
export class HistoryService {
  constructor(private readonly repo: HistoryRepository) {}

  list(userId: string, page: number, limit: number, status?: string, q?: string) {
    return this.repo.findByUser(userId, { page, limit: Math.min(limit, 50), status, q });
  }

  async update(id: string, userId: string, data: { status?: string; tag?: { label: string; variant: string } }) {
    const entry = await this.repo.findOneOwned(id, userId);
    if (!entry) throw new NotFoundException('History entry not found.');
    return this.repo.update(id, {
      status: data.status as HistoryStatus | undefined,
      tagLabel: data.tag?.label,
      tagVariant: data.tag?.variant as TagVariant | undefined,
    });
  }

  async remove(id: string, userId: string) {
    const entry = await this.repo.findOneOwned(id, userId);
    if (!entry) throw new NotFoundException('History entry not found.');
    await this.repo.delete(id);
  }

  async removeAll(userId: string) {
    await this.repo.deleteAllByUser(userId);
  }
}
