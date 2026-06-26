import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

const CACHE_KEY = 'templates:all';
const CACHE_TTL = 3600;

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async findAll() {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    const templates = await this.prisma.template.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    await this.redis.set(CACHE_KEY, JSON.stringify(templates), 'EX', CACHE_TTL);
    return templates;
  }
}
