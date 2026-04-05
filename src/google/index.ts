import fs from 'fs';
import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const TOKEN_PATH = process.env.GOOGLE_TOKEN_PATH || '.google_token.json';

export function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob';
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment');
  }
  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      oAuth2Client.setCredentials(token);
    }
  } catch (e) {
    // ignore
  }
  return oAuth2Client;
}

export function generateAuthUrl(): string {
  const oAuth2Client = createOAuthClient();
  const scopes = [
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/calendar.events',
  ];
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
}

export async function exchangeCodeAndSave(code: string) {
  const oAuth2Client = createOAuthClient();
  const { tokens } = await oAuth2Client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
  oAuth2Client.setCredentials(tokens);
  return tokens;
}

export async function listCalendars() {
  const auth = createOAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.calendarList.list();
  return res.data.items || [];
}

export async function createCalendarEvent(calendarId: string, summary: string, startISO: string, endISO: string) {
  const auth = createOAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      start: { dateTime: startISO },
      end: { dateTime: endISO },
    },
  });
  return res.data;
}

export async function createTask(tasklistId: string | undefined, title: string, notes?: string) {
  const auth = createOAuthClient();
  const tasks = google.tasks({ version: 'v1', auth });
  const res = await tasks.tasks.insert({
    tasklist: tasklistId || '@default',
    requestBody: {
      title,
      notes,
    },
  } as any);
  return res.data;
}

