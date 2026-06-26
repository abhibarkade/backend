import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { AnalysisRepository } from './analysis.repository';
import { AnalysisProcessor, ANALYSIS_QUEUE } from './analysis.processor';
import { ResumeParserService } from './parsers/resume-parser.service';
import { JdScraperService } from './scraper/jd-scraper.service';
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: ANALYSIS_QUEUE,
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'fixed', delay: 5000 },
          removeOnComplete: { age: 86400 * 2 },
          removeOnFail: { age: 86400 * 2 },
        },
      }),
      inject: [ConfigService],
    }),
    LlmModule,
  ],
  controllers: [AnalysisController],
  providers: [
    AnalysisService,
    AnalysisRepository,
    AnalysisProcessor,
    ResumeParserService,
    JdScraperService,
  ],
})
export class AnalysisModule {}
