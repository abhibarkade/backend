import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { AnalysisRepository } from './analysis.repository';
import { ResumeParserService } from './parsers/resume-parser.service';
import { JdScraperService } from './scraper/jd-scraper.service';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { ANALYSIS_QUEUE } from './analysis.processor';
import { PROMPT_VERSION } from './llm/prompt';
import { AnalysisStatus } from '@prisma/client';

@Injectable()
export class AnalysisService {
  constructor(
    private readonly repo: AnalysisRepository,
    private readonly parser: ResumeParserService,
    private readonly scraper: JdScraperService,
    private readonly config: ConfigService,
    @InjectQueue(ANALYSIS_QUEUE) private readonly queue: Queue,
  ) {}

  async create(file: Express.Multer.File, dto: CreateAnalysisDto, userId?: string) {
    const maxChars = this.config.get<number>('ANALYSIS_MAX_TEXT_CHARS', 50000);
    const resumeText = (await this.parser.parse(file.buffer, file.originalname)).slice(0, maxChars);

    let jdText: string;
    let jdSourceUrl: string | undefined;

    if (dto.inputMode === 'link') {
      jdText = await this.scraper.scrape(dto.jdUrl!);
      jdSourceUrl = dto.jdUrl;
    } else {
      jdText = dto.jdText!;
    }

    // Generate a stable poll ID (client uses this to poll for results)
    const pollId = crypto.randomUUID();

    // Create DB row first so analysisId is available for the job payload
    const analysis = await this.repo.create({
      userId,
      jobId: pollId,
      resumeText,
      resumeFilename: file.originalname,
      jdText,
      jdSourceUrl,
      inputMode: dto.inputMode as any,
      promptVersion: PROMPT_VERSION,
    });

    // Enqueue with full payload including analysisId — no race condition
    await this.queue.add('analyze', {
      analysisId: analysis.id,
      resumeText,
      jdText,
      userId,
    });

    return {
      jobId: pollId,
      status: 'pending',
      pollUrl: `/api/analysis/${pollId}`,
    };
  }

  async getByJobId(jobId: string) {
    const analysis = await this.repo.findByJobId(jobId);
    if (!analysis) throw new NotFoundException('Analysis job not found.');

    if (analysis.status === 'completed') {
      return { jobId: analysis.jobId, status: 'completed', result: analysis.result };
    }
    if (analysis.status === 'failed') {
      return { jobId: analysis.jobId, status: 'failed', error: 'Analysis failed. Please try again.' };
    }
    return { jobId: analysis.jobId, status: analysis.status };
  }

  async listForUser(userId: string, page: number, limit: number, status?: string) {
    const clampedLimit = Math.min(limit, 50);
    return this.repo.findByUser(userId, page, clampedLimit, status as AnalysisStatus | undefined);
  }
}
