import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Inject } from '@nestjs/common';
import { AnalysisRepository } from './analysis.repository';
import type { ILlmService } from './llm/llm.interface';
import { LLM_SERVICE } from './llm/llm.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { PROMPT_VERSION } from './llm/prompt';

export const ANALYSIS_QUEUE = 'analysis';

export interface AnalysisJobData {
  analysisId: string;
  resumeText: string;
  jdText: string;
  userId?: string;
}

@Processor(ANALYSIS_QUEUE)
export class AnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    private readonly analysisRepo: AnalysisRepository,
    private readonly prisma: PrismaService,
    @Inject(LLM_SERVICE) private readonly llm: ILlmService,
  ) {
    super();
  }

  async process(job: Job<AnalysisJobData>) {
    const { analysisId, resumeText, jdText, userId } = job.data;
    this.logger.log(`Processing analysis job ${analysisId}`);

    try {
      await this.analysisRepo.updateStatus(analysisId, 'processing');

      const result = await this.llm.analyze(resumeText, jdText);

      await this.analysisRepo.updateStatus(analysisId, 'completed', {
        result,
        completedAt: new Date(),
        promptVersion: PROMPT_VERSION,
      });

      if (userId) {
        const score = result.overallScore ?? 0;
        await this.prisma.historyEntry.create({
          data: {
            userId,
            analysisId,
            role: result.roleTitle || 'Unknown Role',
            company: result.company || 'Unknown Company',
            location: result.location || null,
            score,
            status: 'not_applied',
            tagLabel: score >= 70 ? 'Strong Fit' : score >= 50 ? 'Possible Fit' : 'Weak Fit',
            tagVariant: score >= 70 ? 'sage' : score >= 50 ? 'amber' : 'clay',
          },
        });
      }

      this.logger.log(`Analysis ${analysisId} completed. Score: ${result.overallScore}`);
    } catch (err: any) {
      this.logger.error(`Analysis ${analysisId} failed: ${err.message}`);
      await this.analysisRepo.updateStatus(analysisId, 'failed', {
        errorMessage: err.message,
        completedAt: new Date(),
      });
      throw err;
    }
  }
}
