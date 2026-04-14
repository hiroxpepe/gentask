import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpToken = path.join(os.tmpdir(), 'gentask_test_token.json');

vi.mock('googleapis', () => {
  class OAuth2 {
    constructor(clientId: any, clientSecret: any, redirectUri: any) {}
    generateAuthUrl(opts: any) { return 'https://mock-auth-url'; }
    async getToken(code: any) { return { tokens: { access_token: 'a', refresh_token: 'r' } }; }
    setCredentials(t: any) {}
  }
  const calendar = (opts: any) => ({
    calendarList: { list: async () => ({ data: { items: [{ id: 'cal1', summary: 'Mock Calendar' }] } }) },
    events: { insert: async ({ calendarId, requestBody }: any) => ({ data: { id: 'ev1', summary: requestBody.summary } }) },
  });
  const tasks = (opts: any) => ({
    tasks: { insert: async ({ tasklist, requestBody }: any) => ({ data: { id: 't1', title: requestBody.title } }) },
  });
  return { google: { auth: { OAuth2 }, calendar, tasks } };
});

describe('google wrapper', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_TOKEN_PATH = tmpToken;
    try { if (fs.existsSync(tmpToken)) fs.unlinkSync(tmpToken); } catch {}
  });

  afterEach(() => {
    try { if (fs.existsSync(tmpToken)) fs.unlinkSync(tmpToken); } catch {}
  });

  it('generate_auth_url returns url', async () => {
    const mod = await import('./google');
    const url = mod.generate_auth_url();
    expect(typeof url).toBe('string');
    expect(url.startsWith('http')).toBe(true);
  });

  it('exchange_code_and_save writes token file', async () => {
    const mod = await import('./google');
    const tokens = await mod.exchange_code_and_save('code');
    expect(tokens).toHaveProperty('access_token');
    expect(fs.existsSync(tmpToken)).toBe(true);
  });

  it('list_calendars returns array', async () => {
    const mod = await import('./google');
    const items = await mod.list_calendars();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('id');
  });

  it('create_task returns task', async () => {
    const mod = await import('./google');
    const res = await mod.create_task(undefined, 'Title', 'notes');
    expect(res).toHaveProperty('id');
    expect(res).toHaveProperty('title');
  });
});
