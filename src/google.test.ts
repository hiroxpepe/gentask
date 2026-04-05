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

  it('generateAuthUrl returns url', async () => {
    const mod = await import('./google');
    const url = mod.generateAuthUrl();
    expect(typeof url).toBe('string');
    expect(url.startsWith('http')).toBe(true);
  });

  it('exchangeCodeAndSave writes token file', async () => {
    const mod = await import('./google');
    const tokens = await mod.exchangeCodeAndSave('code');
    expect(tokens).toHaveProperty('access_token');
    expect(fs.existsSync(tmpToken)).toBe(true);
  });

  it('listCalendars returns array', async () => {
    const mod = await import('./google');
    const items = await mod.listCalendars();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('id');
  });

  it('createTask returns task', async () => {
    const mod = await import('./google');
    const res = await mod.createTask(undefined, 'Title', 'notes');
    expect(res).toHaveProperty('id');
    expect(res).toHaveProperty('title');
  });
});
