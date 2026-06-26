import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Queue from 'better-queue';

export interface QueueTask<T = unknown> {
  data: T;
}

type TaskHandler<T> = (task: QueueTask<T>) => Promise<void>;

@Injectable()
export class InMemoryQueueService<T = unknown> implements OnModuleDestroy {
  private readonly logger = new Logger(InMemoryQueueService.name);
  private queue: Queue<QueueTask<T>>;

  init(handler: TaskHandler<T>, options: { concurrency?: number; maxRetries?: number; retryDelay?: number } = {}) {
    this.queue = new Queue<QueueTask<T>>(
      (task, cb) => {
        handler(task)
          .then(() => cb(null))
          .catch((err) => cb(err));
      },
      {
        concurrent: options.concurrency ?? 3,
        maxRetries: options.maxRetries ?? 3,
        retryDelay: options.retryDelay ?? 5000,
        filo: false,
      },
    );

    this.queue.on('task_failed', (taskId: string, err: unknown) => {
      this.logger.error(`Queue task ${taskId} failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  add(data: T): void {
    this.queue.push({ data });
  }

  onModuleDestroy() {
    this.queue?.destroy?.(() => {});
  }
}
