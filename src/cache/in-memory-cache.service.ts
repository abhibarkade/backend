import { Injectable, OnModuleDestroy } from '@nestjs/common';
import NodeCache from 'node-cache';

@Injectable()
export class InMemoryCacheService implements OnModuleDestroy {
  private readonly store = new NodeCache({ useClones: false });

  async get(key: string): Promise<string | null> {
    return this.store.get<string>(key) ?? null;
  }

  async set(key: string, value: string, _ex: 'EX', ttlSeconds: number): Promise<void> {
    this.store.set(key, value, ttlSeconds);
  }

  async del(...keys: string[]): Promise<void> {
    this.store.del(keys);
  }

  pipeline() {
    const ops: Array<() => void> = [];
    const self = this;
    return {
      del(key: string) {
        ops.push(() => self.store.del(key));
        return this;
      },
      set(key: string, value: string, _ex: 'EX', ttlSeconds: number) {
        ops.push(() => self.store.set(key, value, ttlSeconds));
        return this;
      },
      async exec(): Promise<null[]> {
        ops.forEach((op) => op());
        return ops.map(() => null);
      },
    };
  }

  onModuleDestroy() {
    this.store.close();
  }
}
