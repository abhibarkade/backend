import { bootstrapApp, teardownApp, cleanTestData, getApp, getPrisma, getDevToken } from './setup';
import * as supertest from 'supertest';

describe('Auth', () => {
  let request: supertest.Agent;

  beforeAll(async () => {
    await bootstrapApp();
    request = supertest.default(getApp().getHttpServer());
  });

  afterAll(() => teardownApp());

  beforeEach(() => cleanTestData());

  describe('POST /api/auth/dev/login', () => {
    it('returns access_token, refresh_token and userId for the default dev user', async () => {
      const res = await request.post('/api/auth/dev/login').send({}).expect(201);

      expect(res.body.data).toMatchObject({
        userId: '00000000-0000-0000-0000-000000000001',
        email: 'dev@tailor.test',
        expires_in: expect.any(Number),
      });
      expect(res.body.data.access_token).toBeTruthy();
      expect(res.body.data.refresh_token).toBeTruthy();
    });

    it('accepts a custom email and name', async () => {
      const res = await request
        .post('/api/auth/dev/login')
        .send({ email: 'custom@tailor.test', fullName: 'Custom User' })
        .expect(201);

      expect(res.body.data.email).toBe('custom@tailor.test');
    });

    it('creates the user row in the database', async () => {
      await request.post('/api/auth/dev/login').send({}).expect(201);

      const user = await getPrisma().user.findUnique({
        where: { id: '00000000-0000-0000-0000-000000000001' },
      });
      expect(user).not.toBeNull();
      expect(user!.email).toBe('dev@tailor.test');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('issues a new access token when a valid refresh token cookie is sent', async () => {
      const loginRes = await request.post('/api/auth/dev/login').send({}).expect(201);
      const refreshToken = loginRes.body.data.refresh_token;

      const res = await request
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`])
        .expect(200);

      expect(res.body.data.access_token).toBeTruthy();
      expect(res.body.data.expires_in).toBe(900);
    });

    it('returns 401 when no refresh token cookie is present', async () => {
      await request.post('/api/auth/refresh').expect(401);
    });

    it('returns 401 when refresh token is expired or unknown', async () => {
      await request
        .post('/api/auth/refresh')
        .set('Cookie', ['refresh_token=this-does-not-exist'])
        .expect(401);
    });

    it('invalidates the old refresh token after rotation (cannot reuse)', async () => {
      const loginRes = await request.post('/api/auth/dev/login').send({}).expect(201);
      const oldRefresh = loginRes.body.data.refresh_token;

      // First use — OK, issues new token
      await request
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${oldRefresh}`])
        .expect(200);

      // Second use of old token — must be rejected
      await request
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${oldRefresh}`])
        .expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns 204 and clears the cookie', async () => {
      const loginRes = await request.post('/api/auth/dev/login').send({}).expect(201);
      const { access_token, refresh_token } = loginRes.body.data;

      const res = await request
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${access_token}`)
        .set('Cookie', [`refresh_token=${refresh_token}`])
        .expect(204);

      // Cookie must be cleared
      const setCookieHeader = (res.headers['set-cookie'] as unknown) as string[] | undefined;
      expect(
        setCookieHeader?.some((c: string) => c.startsWith('refresh_token=;') || c.includes('Max-Age=0')),
      ).toBe(true);
    });

    it('returns 401 without a bearer token', async () => {
      await request.post('/api/auth/logout').expect(401);
    });

    it('refresh token is invalidated after logout', async () => {
      const loginRes = await request.post('/api/auth/dev/login').send({}).expect(201);
      const { access_token, refresh_token } = loginRes.body.data;

      await request
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${access_token}`)
        .set('Cookie', [`refresh_token=${refresh_token}`])
        .expect(204);

      await request
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${refresh_token}`])
        .expect(401);
    });
  });
});
