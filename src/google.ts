import fs from 'fs';
import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const TOKEN_PATH = process.env.GOOGLE_TOKEN_PATH || '.google_token.json';

export function create_oauth_client() {
  const client_id     = process.env.GOOGLE_CLIENT_ID;
  const client_secret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect_uri  = process.env.GOOGLE_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob';
  if (!client_id || !client_secret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment');
  }
  const oauth2_client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      oauth2_client.setCredentials(token);
    }
  } catch (e) {
    // ignore
  }
  return oauth2_client;
}

export function generate_auth_url(): string {
  const oauth2_client = create_oauth_client();
  const scopes = [
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/calendar.events',
  ];
  return oauth2_client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
}

export async function exchange_code_and_save(code: string) {
  const oauth2_client = create_oauth_client();
  const { tokens } = await oauth2_client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
  oauth2_client.setCredentials(tokens);
  return tokens;
}

export async function list_calendars() {
  const auth     = create_oauth_client();
  const calendar = google.calendar({ version: 'v3', auth });
  const res      = await calendar.calendarList.list();
  return res.data.items || [];
}

export async function create_calendar_event(calendar_id: string, summary: string, start_iso: string, end_iso: string) {
  const auth     = create_oauth_client();
  const calendar = google.calendar({ version: 'v3', auth });
  const res      = await calendar.events.insert({
    calendarId: calendar_id,
    requestBody: {
      summary,
      start: { dateTime: start_iso },
      end:   { dateTime: end_iso },
    },
  });
  return res.data;
}

export async function create_task(tasklist_id: string | undefined, title: string, notes?: string) {
  const auth  = create_oauth_client();
  const tasks = google.tasks({ version: 'v1', auth });
  const res   = await tasks.tasks.insert({
    tasklist: tasklist_id || '@default',
    requestBody: {
      title,
      notes,
    },
  } as any);
  return res.data;
}
