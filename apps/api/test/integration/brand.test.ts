import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../setup/test-app.js';

/** What the signed-out screens may show: the customer's name and logo, without a session. */
describe('public brand', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
  });
  afterAll(async () => {
    await ctx.close();
  });

  const brand = async () =>
    (await ctx.app.inject({ method: 'GET', url: '/api/v1/brand' })).json<{
      data: { name: string | null; logoUrl: string | null };
    }>().data;

  it('answers with no logo and no placeholder name on a fresh stack', async () => {
    expect(await brand()).toEqual({ name: null, logoUrl: null });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/brand/logo' })).statusCode).toBe(
      404,
    );
  });

  it('serves the uploaded logo to someone who is not signed in', async () => {
    await ctx.app.storage.put('branding/test.png', Buffer.from('png-bytes'), 'image/png');
    const before = (await ctx.app.settings.getAll()).branding;
    await ctx.app.settings.patch({ branding: { ...before, logoKey: 'branding/test.png' } }, null);

    const { logoUrl } = await brand();
    expect(logoUrl).toMatch(/^\/api\/v1\/brand\/logo\?v=[0-9a-f]{12}$/);
    const res = await ctx.app.inject({ method: 'GET', url: logoUrl ?? '' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body).toBe('png-bytes');
  });
});
