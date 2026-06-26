import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { AnalysisRepository } from './analysis.repository';
import { AnalysisProcessor } from './analysis.processor';
import { ResumeParserService } from './parsers/resume-parser.service';
import { JdScraperService } from './scraper/jd-scraper.service';
import { LlmModule } from './llm/llm.module';
import { InMemoryQueueService } from '../../queue/in-memory-queue.service';
import { AnalysisJobData } from './analysis.processor';

@Module({
  imports: [LlmModule],
  controllers: [AnalysisController],
  providers: [
    AnalysisService,
    AnalysisRepository,
    AnalysisProcessor,
    ResumeParserService,
    JdScraperService,
    {
      provide: InMemoryQueueService,
      useFactory: () => new InMemoryQueueService<AnalysisJobData>(),
    },
  ],
})
export class AnalysisModule {}
