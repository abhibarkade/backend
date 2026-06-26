import { bootstrapApp, teardownApp, cleanTestData, getApp, getPrisma, getDevToken, MOCK_ANALYSIS_RESULT } from './setup';
import { MINIMAL_PDF, SAMPLE_JD } from './fixtures/minimal.pdf';
import * as supertest from 'supertest';

const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 10000;

async function pollUntilComplete(
  request: supertest.Agent,
  jobId: string,
  token?: string,
): Promise<supertest.Response> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const req = request.get(`/api/analysis/${jobId}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.expect(200);
    if (res.body.data.status === 'completed' || res.body.data.status === 'failed') {
      return res;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Job ${jobId} did not complete within ${POLL_TIMEOUT_MS}ms`);
}

describe('Analysis', () => {
  let request: supertest.Agent;
  let token: string;

  beforeAll(async () => {
    await bootstrapApp();
    request = supertest.default(getApp().getHttpServer());
  });

  afterAll(() => teardownApp());

  beforeEach(async () => {
    await cleanTestData();
    token = await getDevToken();
  });

  describe('POST /api/analysis (authenticated, paste mode)', () => {
    it('accepts a valid PDF + JD and returns 202 with a jobId', async () => {
      const res = await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      expect(res.body.data).toMatchObject({
        status: 'pending',
        pollUrl: expect.stringContaining('/api/analysis/'),
      });
      expect(res.body.data.jobId).toBeTruthy();
    });

    it('creates an analysis row in the database with status pending', async () => {
      const res = await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      const { jobId } = res.body.data;
      const analysis = await getPrisma().analysis.findUnique({ where: { jobId } });
      expect(analysis).not.toBeNull();
      expect(analysis!.userId).toBe('00000000-0000-0000-0000-000000000001');
      expect(analysis!.inputMode).toBe('paste');
    });

    it('completes the job and returns the LLM result via polling', async () => {
      const submitRes = await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      const { jobId } = submitRes.body.data;
      const pollRes = await pollUntilComplete(request, jobId, token);

      expect(pollRes.body.data.status).toBe('completed');
      expect(pollRes.body.data.result).toMatchObject({
        roleTitle: MOCK_ANALYSIS_RESULT.roleTitle,
        overallScore: MOCK_ANALYSIS_RESULT.overallScore,
      });
    });

    it('persists the completed result in the database', async () => {
      const submitRes = await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      const { jobId } = submitRes.body.data;
      await pollUntilComplete(request, jobId, token);

      const analysis = await getPrisma().analysis.findUnique({ where: { jobId } });
      expect(analysis!.status).toBe('completed');
      expect(analysis!.result).toBeTruthy();
      expect(analysis!.completedAt).not.toBeNull();
    });

    it('auto-creates a history entry after completion for authenticated users', async () => {
      const submitRes = await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      const { jobId } = submitRes.body.data;
      await pollUntilComplete(request, jobId, token);

      const historyEntries = await getPrisma().historyEntry.findMany({
        where: { userId: '00000000-0000-0000-0000-000000000001' },
      });
      expect(historyEntries.length).toBeGreaterThanOrEqual(1);
      expect(historyEntries[0].role).toBe(MOCK_ANALYSIS_RESULT.roleTitle);
      expect(historyEntries[0].score).toBe(MOCK_ANALYSIS_RESULT.overallScore);
    });
  });

  describe('POST /api/analysis (anonymous, paste mode)', () => {
    it('allows submission without a token and returns 202', async () => {
      const res = await request
        .post('/api/analysis')
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      expect(res.body.data.jobId).toBeTruthy();
    });

    it('does NOT create a history entry for anonymous users', async () => {
      const submitRes = await request
        .post('/api/analysis')
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      const { jobId } = submitRes.body.data;
      await pollUntilComplete(request, jobId);

      const historyEntries = await getPrisma().historyEntry.findMany({});
      expect(historyEntries.length).toBe(0);
    });

    it('stores null userId on the analysis row', async () => {
      const submitRes = await request
        .post('/api/analysis')
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      const analysis = await getPrisma().analysis.findUnique({
        where: { jobId: submitRes.body.data.jobId },
      });
      expect(analysis!.userId).toBeNull();
    });
  });

  describe('POST /api/analysis — validation', () => {
    it('returns 400 when inputMode is missing', async () => {
      await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('jdText', SAMPLE_JD)
        .expect(400);
    });

    it('returns 400 when jdText is too short (< 60 chars) in paste mode', async () => {
      await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', 'Too short')
        .expect(400);
    });

    it('returns 400 when resume file is missing', async () => {
      await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(400);
    });

    it('returns 415 when a non-PDF/DOCX file is uploaded', async () => {
      const textBuffer = Buffer.from('this is plain text, not a PDF');
      await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .attach('resume', textBuffer, { filename: 'resume.txt', contentType: 'text/plain' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(415);
    });
  });

  describe('GET /api/analysis/:jobId', () => {
    it('returns 404 for an unknown jobId', async () => {
      await request.get('/api/analysis/nonexistent-job-id').expect(404);
    });

    it('returns pending status immediately after submission', async () => {
      const submitRes = await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      const { jobId } = submitRes.body.data;
      const pollRes = await request
        .get(`/api/analysis/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(['pending', 'processing', 'completed']).toContain(pollRes.body.data.status);
    });
  });

  describe('GET /api/analysis (list)', () => {
    it('returns 401 without a token', async () => {
      await request.get('/api/analysis').expect(401);
    });

    it('returns an empty list when user has no analyses', async () => {
      const res = await request
        .get('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });

    it('returns the user analyses after submission', async () => {
      await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      const res = await request
        .get('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]).toMatchObject({
        jobId: expect.any(String),
        status: expect.stringMatching(/^(pending|processing|completed)$/),
        inputMode: 'paste',
      });
    });

    it('respects pagination (page and limit params)', async () => {
      // Submit 3 analyses
      for (let i = 0; i < 3; i++) {
        await request
          .post('/api/analysis')
          .set('Authorization', `Bearer ${token}`)
          .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
          .field('inputMode', 'paste')
          .field('jdText', SAMPLE_JD)
          .expect(202);
      }

      const res = await request
        .get('/api/analysis?page=1&limit=2')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.length).toBe(2);
    });

    it('does not return other users analyses', async () => {
      // Submit as dev user
      await request
        .post('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      // Submit as anonymous (stored with null userId)
      await request
        .post('/api/analysis')
        .attach('resume', MINIMAL_PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
        .field('inputMode', 'paste')
        .field('jdText', SAMPLE_JD)
        .expect(202);

      const res = await request
        .get('/api/analysis')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Only the authenticated user's record should appear
      const allBelongToUser = res.body.data.every((a: any) => a.userId === undefined || a.userId === '00000000-0000-0000-0000-000000000001');
      expect(allBelongToUser).toBe(true);
    });
  });
});
