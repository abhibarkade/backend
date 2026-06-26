import { bootstrapApp, teardownApp, cleanTestData, getApp, getPrisma, getDevToken } from './setup';
import * as supertest from 'supertest';

async function seedTemplate(prisma: ReturnType<typeof getPrisma>, overrides: Partial<{
  name: string; isActive: boolean; sortOrder: number;
}> = {}) {
  return prisma.template.create({
    data: {
      icon: '🧪',
      iconVariant: 'sage',
      name: overrides.name || 'Test Template',
      description: 'A template for testing purposes.',
      uses: 42,
      sampleJd: 'This is a sample job description for the test template with enough content here.',
      sortOrder: overrides.sortOrder ?? 0,
      isActive: overrides.isActive ?? true,
    },
  });
}

describe('Templates', () => {
  let request: supertest.Agent;
  let token: string;

  beforeAll(async () => {
    await bootstrapApp();
    request = supertest.default(getApp().getHttpServer());
  });

  afterAll(() => teardownApp());

  beforeEach(async () => {
    await cleanTestData();
    await getPrisma().template.deleteMany({});
    token = await getDevToken();
  });

  describe('GET /api/templates', () => {
    it('is a public endpoint — responds 200 without a token', async () => {
      await seedTemplate(getPrisma());
      await request.get('/api/templates').expect(200);
    });

    it('returns an empty array when there are no active templates', async () => {
      const res = await request.get('/api/templates').expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });

    it('returns active templates sorted by sortOrder', async () => {
      await seedTemplate(getPrisma(), { name: 'Second', sortOrder: 2 });
      await seedTemplate(getPrisma(), { name: 'First', sortOrder: 1 });

      const res = await request.get('/api/templates').expect(200);

      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].name).toBe('First');
      expect(res.body.data[1].name).toBe('Second');
    });

    it('excludes inactive templates', async () => {
      await seedTemplate(getPrisma(), { name: 'Active One', isActive: true });
      await seedTemplate(getPrisma(), { name: 'Inactive One', isActive: false });

      const res = await request.get('/api/templates').expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe('Active One');
    });

    it('returns expected template fields', async () => {
      await seedTemplate(getPrisma());

      const res = await request.get('/api/templates').expect(200);
      const t = res.body.data[0];

      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('icon');
      expect(t).toHaveProperty('iconVariant');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('description');
      expect(t).toHaveProperty('uses');
      expect(t).toHaveProperty('sampleJd');
      expect(t).toHaveProperty('sortOrder');
    });

    it('wraps response in the standard { data, meta } envelope', async () => {
      await seedTemplate(getPrisma());

      const res = await request.get('/api/templates').expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toMatchObject({
        requestId: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('responds even when authenticated (token ignored — public route)', async () => {
      await seedTemplate(getPrisma());

      const res = await request
        .get('/api/templates')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.length).toBe(1);
    });
  });
});
