import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.test before anything else — must be first import
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import { LLM_SERVICE } from '../../src/modules/analysis/llm/llm.interface';
import type { AnalysisResult } from '../../src/modules/analysis/llm/llm.interface';
import { ResumeParserService } from '../../src/modules/analysis/parsers/resume-parser.service';

export { supertest };

let app: INestApplication;
let prisma: PrismaService;
let redis: import('ioredis').default;

export const MOCK_ANALYSIS_RESULT: AnalysisResult = {
  roleTitle: 'Senior Software Engineer',
  company: 'Acme Corp',
  location: 'Remote',
  source: 'Applied via paste',
  overallScore: 82,
  stats: { strongMatches: 12, gapsFound: 2, atsCoverage: 78 },
  issues: [
    {
      id: 'issue-1',
      variant: 'amber',
      tag: 'keyword',
      headline: 'Missing Kubernetes mention',
      description: 'The JD emphasises K8s experience. Not mentioned in resume.',
      priority: 1,
      action: 'Add Kubernetes to your skills section.',
    },
  ],
  keywords: [
    { label: 'Node.js', status: 'have' },
    { label: 'TypeScript', status: 'have' },
    { label: 'Kubernetes', status: 'missing' },
  ],
  rewrites: [
    {
      before: 'Worked on backend services.',
      after: 'Designed and shipped 3 microservices handling 50K req/s using Node.js and TypeScript.',
    },
  ],
};

export async function bootstrapApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(LLM_SERVICE)
    .useValue({
      analyze: jest.fn().mockResolvedValue(MOCK_ANALYSIS_RESULT),
    })
    .overrideProvider(ResumeParserService)
    .useValue({
      parse: jest.fn().mockResolvedValue(
        'John Doe | Software Engineer\nNode.js TypeScript PostgreSQL Redis Docker AWS\n5 years experience building distributed systems.',
      ),
    })
    .compile();

  // AppModule already registers: ValidationPipe, HttpExceptionFilter,
  // TransformInterceptor, LoggingInterceptor, JwtAuthGuard, RolesGuard via APP_* tokens.
  // Only add things that the app bootstrap (main.ts) does but AppModule doesn't:
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());

  await app.init();

  prisma = moduleRef.get(PrismaService);
  // Get Redis directly for cache busting in cleanTestData
  redis = new (require('ioredis').default)(process.env.REDIS_URL || 'redis://localhost:6379');

  return app;
}

export function getApp(): INestApplication {
  return app;
}

export function getPrisma(): PrismaService {
  return prisma;
}

export async function teardownApp(): Promise<void> {
  await redis?.quit();
  await app?.close();
}

/** Wipe tables and caches between tests */
export async function cleanTestData(): Promise<void> {
  await prisma.historyEntry.deleteMany({});
  await prisma.analysis.deleteMany({});
  await prisma.oAuthAccount.deleteMany({});
  await prisma.user.deleteMany({
    where: { id: { not: '00000000-0000-0000-0000-000000000001' } },
  });
  // Ensure dev user always exists and is restored to clean state
  await prisma.user.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    create: { id: '00000000-0000-0000-0000-000000000001', email: 'dev@tailor.test', fullName: 'Dev User', role: 'user' },
    update: { fullName: 'Dev User', deletedAt: null, email: 'dev@tailor.test' },
  });
  // Bust templates Redis cache so template tests see fresh DB state
  await redis.del('templates:all');
  // Flush stale BullMQ jobs so they don't interfere with test assertions
  const keys = await redis.keys('bull:analysis:*');
  if (keys.length > 0) await redis.del(...keys);
}

/** Log in as the default dev user and return the bearer token */
export async function getDevToken(): Promise<string> {
  const res = await supertest.default(app.getHttpServer())
    .post('/api/auth/dev/login')
    .send({})
    .expect(201);
  return res.body.data.access_token;
}
