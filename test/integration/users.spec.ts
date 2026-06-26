import { bootstrapApp, teardownApp, cleanTestData, getApp, getPrisma, getDevToken } from './setup';
import * as supertest from 'supertest';

describe('Users', () => {
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

  describe('GET /api/users/me', () => {
    it('returns the authenticated user profile', async () => {
      const res = await request
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: '00000000-0000-0000-0000-000000000001',
        email: 'dev@tailor.test',
        fullName: 'Dev User',
        role: 'user',
      });
      expect(res.body.meta.requestId).toBeTruthy();
      expect(res.body.meta.timestamp).toBeTruthy();
    });

    it('returns 401 without a token', async () => {
      await request.get('/api/users/me').expect(401);
    });

    it('returns 401 with an invalid token', async () => {
      await request
        .get('/api/users/me')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);
    });
  });

  describe('PUT /api/users/me', () => {
    it('updates the full name and persists it in the database', async () => {
      const res = await request
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Updated Name' })
        .expect(200);

      expect(res.body.data.fullName).toBe('Updated Name');

      const dbUser = await getPrisma().user.findUnique({
        where: { id: '00000000-0000-0000-0000-000000000001' },
      });
      expect(dbUser!.fullName).toBe('Updated Name');
    });

    it('trims whitespace from fullName', async () => {
      const res = await request
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: '  Trimmed Name  ' })
        .expect(200);

      expect(res.body.data.fullName).toBe('Trimmed Name');
    });

    it('returns 400 when fullName is empty', async () => {
      const res = await request
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: '' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('returns 400 when fullName exceeds 255 characters', async () => {
      await request
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'A'.repeat(256) })
        .expect(400);
    });

    it('returns 400 when unknown fields are sent (whitelist enforcement)', async () => {
      await request
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Valid', role: 'admin' })
        .expect(400);
    });

    it('returns 401 without a token', async () => {
      await request.put('/api/users/me').send({ fullName: 'X' }).expect(401);
    });
  });

  describe('DELETE /api/users/me', () => {
    it('soft-deletes the user (sets deleted_at) and returns 204', async () => {
      await request
        .delete('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const dbUser = await getPrisma().user.findUnique({
        where: { id: '00000000-0000-0000-0000-000000000001' },
      });
      expect(dbUser!.deletedAt).not.toBeNull();
    });

    it('returns 404 after soft-delete (user is invisible to live queries)', async () => {
      await request
        .delete('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Access token still valid for its 15-min TTL but user is soft-deleted
      await request
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 401 without a token', async () => {
      await request.delete('/api/users/me').expect(401);
    });
  });
});
