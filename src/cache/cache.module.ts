import { Global, Module } from '@nestjs/common';
import { InMemoryCacheService } from './in-memory-cache.service';

@Global()
@Module({
  providers: [InMemoryCacheService],
  exports: [InMemoryCacheService],
})
export class CacheModule {}
