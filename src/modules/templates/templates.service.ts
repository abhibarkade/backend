import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InMemoryCacheService } from '../../cache/in-memory-cache.service';

const CACHE_KEY = 'templates:all';
const CACHE_TTL = 3600;

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: InMemoryCacheService,
  ) {}

  async findAll() {
    const cached = await this.cache.get(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    const templates = await this.prisma.template.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    await this.cache.set(CACHE_KEY, JSON.stringify(templates), 'EX', CACHE_TTL);
    return templates;
  }
}
