import { bootstrapApp, teardownApp, cleanTestData, getApp, getPrisma, getDevToken } from './setup';
import { MINIMAL_PDF, SAMPLE_JD } from './fixtures/minimal.pdf';
import * as supertest from 'supertest';

const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

async function seedHistoryEntry(prisma: ReturnType<typeof getPrisma>, overrides: Partial<{
  userId: string; role: string; company: string; score: number; status: any;
}> = {}) {
  return prisma.historyEntry.create({
    data: {
      userId: overrides.userId || DEV_USER_ID,
      role: overrides.role || 'Frontend Engineer',
      company: overrides.company || 'Acme Corp',
      location: 'Remote',
      score: overrides.score ?? 75,
      status: overrides.status || 'not_applied',
      tagLabel: 'Strong Fit',
      tagVariant: 'sage',
    },
  });
}

describe('History', () => {
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

  describe('GET /api/history', () => {
    it('returns 401 without a token', async () => {
      await request.get('/api/history').expect(401);
    });

    it('returns an empty array when user has no history', async () => {
      const res = await request
        .get('/api/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });

    it('returns history entries for the authenticated user', async () => {
      await seedHistoryEntry(getPrisma());

      const res = await request
        .get('/api/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0]).toMatchObject({
        role: 'Frontend Engineer',
        company: 'Acme Corp',
        score: 75,
        status: 'not_applied',
      });
    });

    it('returns multiple entries ordered by createdAt desc', async () => {
      await seedHistoryEntry(getPrisma(), { role: 'First Job', company: 'Co A' });
      await new Promise((r) => setTimeout(r, 10));
      await seedHistoryEntry(getPrisma(), { role: 'Second Job', company: 'Co B' });

      const res = await request
        .get('/api/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data[0].role).toBe('Second Job');
      expect(res.body.data[1].role).toBe('First Job');
    });

    it('supports full-text search via ?q=', async () => {
      await seedHistoryEntry(getPrisma(), { role: 'Backend Engineer', company: 'TechCorp' });
      await seedHistoryEntry(getPrisma(), { role: 'Designer', company: 'Creative Co' });

      const res = await request
        .get('/api/history?q=backend')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].role).toBe('Backend Engineer');
    });

    it('filters by status', async () => {
      await seedHistoryEntry(getPrisma(), { status: 'applied' });
      await seedHistoryEntry(getPrisma(), { status: 'not_applied' });

      const res = await request
        .get('/api/history?status=applied')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe('applied');
    });

    it('paginates results', async () => {
      for (let i = 0; i < 5; i++) {
        await seedHistoryEntry(getPrisma(), { role: `Job ${i}`, company: 'Co' });
      }

      const res = await request
        .get('/api/history?page=1&limit=3')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.length).toBe(3);
    });

    it('does not return other users entries (IDOR protection)', async () => {
      // Create a second user and their history
      const otherUser = await getPrisma().user.create({
        data: { email: 'other@tailor.test', fullName: 'Other User' },
      });
      await seedHistoryEntry(getPrisma(), { userId: otherUser.id, role: 'Secret Job' });

      // Create our dev user's entry
      await seedHistoryEntry(getPrisma());

      const res = await request
        .get('/api/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].role).not.toBe('Secret Job');
    });
  });

  describe('PUT /api/history/:id', () => {
    it('updates the status of an entry', async () => {
      const entry = await seedHistoryEntry(getPrisma());

      const res = await request
        .put(`/api/history/${entry.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'applied' })
        .expect(200);

      expect(res.body.data.status).toBe('applied');

      const dbEntry = await getPrisma().historyEntry.findUnique({ where: { id: entry.id } });
      expect(dbEntry!.status).toBe('applied');
    });

    it('updates the tag label and variant', async () => {
      const entry = await seedHistoryEntry(getPrisma());

      const res = await request
        .put(`/api/history/${entry.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tag: { label: 'Dream Job', variant: 'sage' } })
        .expect(200);

      expect(res.body.data.tagLabel).toBe('Dream Job');
      expect(res.body.data.tagVariant).toBe('sage');
    });

    it('returns 404 when entry does not exist', async () => {
      await request
        .put('/api/history/00000000-0000-0000-0000-000000000099')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'applied' })
        .expect(404);
    });

    it('returns 404 when entry belongs to another user (IDOR — same status as not-found)', async () => {
      const otherUser = await getPrisma().user.create({
        data: { email: 'other2@tailor.test', fullName: 'Other' },
      });
      const entry = await seedHistoryEntry(getPrisma(), { userId: otherUser.id });

      await request
        .put(`/api/history/${entry.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'applied' })
        .expect(404);
    });

    it('returns 401 without a token', async () => {
      const entry = await seedHistoryEntry(getPrisma());
      await request.put(`/api/history/${entry.id}`).send({ status: 'applied' }).expect(401);
    });
  });

  describe('DELETE /api/history/:id', () => {
    it('deletes the entry and returns 204', async () => {
      const entry = await seedHistoryEntry(getPrisma());

      await request
        .delete(`/api/history/${entry.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const dbEntry = await getPrisma().historyEntry.findUnique({ where: { id: entry.id } });
      expect(dbEntry).toBeNull();
    });

    it('returns 404 for a non-existent entry', async () => {
      await request
        .delete('/api/history/00000000-0000-0000-0000-000000000099')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 for another user entry (IDOR)', async () => {
      const otherUser = await getPrisma().user.create({
        data: { email: 'other3@tailor.test', fullName: 'Other' },
      });
      const entry = await seedHistoryEntry(getPrisma(), { userId: otherUser.id });

      await request
        .delete(`/api/history/${entry.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      // Entry must still exist in DB — we didn't delete the wrong user's data
      const dbEntry = await getPrisma().historyEntry.findUnique({ where: { id: entry.id } });
      expect(dbEntry).not.toBeNull();
    });
  });

  describe('DELETE /api/history (bulk clear)', () => {
    it('deletes all history entries for the authenticated user and returns 204', async () => {
      await seedHistoryEntry(getPrisma(), { role: 'Job A' });
      await seedHistoryEntry(getPrisma(), { role: 'Job B' });

      await request
        .delete('/api/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const remaining = await getPrisma().historyEntry.findMany({
        where: { userId: DEV_USER_ID },
      });
      expect(remaining.length).toBe(0);
    });

    it('does not delete entries belonging to other users', async () => {
      const otherUser = await getPrisma().user.create({
        data: { email: 'other4@tailor.test', fullName: 'Other' },
      });
      await seedHistoryEntry(getPrisma(), { userId: otherUser.id });
      await seedHistoryEntry(getPrisma());

      await request
        .delete('/api/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const otherEntries = await getPrisma().historyEntry.findMany({
        where: { userId: otherUser.id },
      });
      expect(otherEntries.length).toBe(1);
    });

    it('returns 401 without a token', async () => {
      await request.delete('/api/history').expect(401);
    });
  });
});
