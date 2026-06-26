import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalysisStatus, InputMode } from '@prisma/client';

@Injectable()
export class AnalysisRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    userId?: string;
    jobId: string;
    resumeText?: string;
    resumeFilename?: string;
    jdText: string;
    jdSourceUrl?: string;
    inputMode: InputMode;
    promptVersion: string;
  }) {
    return this.prisma.analysis.create({ data });
  }

  findByJobId(jobId: string) {
    return this.prisma.analysis.findUnique({ where: { jobId } });
  }

  updateStatus(id: string, status: AnalysisStatus, extras?: Record<string, any>) {
    return this.prisma.analysis.update({ where: { id }, data: { status, ...extras } });
  }

  findByUser(userId: string, page: number, limit: number, status?: AnalysisStatus) {
    const where: any = { userId };
    if (status) where.status = status;
    return this.prisma.analysis.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        jobId: true,
        status: true,
        resumeFilename: true,
        inputMode: true,
        promptVersion: true,
        createdAt: true,
        completedAt: true,
      },
    });
  }
}
