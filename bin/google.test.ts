import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks so the mocked functions are available to both the mock factory and the tests
const {
  mock_generateAuthUrl,
  mock_exchangeCodeAndSave,
  mock_listCalendars,
  mock_createCalendarEvent,
  mock_createTask,
} = vi.hoisted(() => ({
  mock_generateAuthUrl: vi.fn(),
  mock_exchangeCodeAndSave: vi.fn(),
  mock_listCalendars: vi.fn(),
  mock_createCalendarEvent: vi.fn(),
  mock_createTask: vi.fn(),
}));

// Mock the actual implementation used by the bin script
vi.mock('../src/google', () => ({
  generateAuthUrl: mock_generateAuthUrl,
  exchangeCodeAndSave: mock_exchangeCodeAndSave,
  listCalendars: mock_listCalendars,
  createCalendarEvent: mock_createCalendarEvent,
  createTask: mock_createTask,
}));

describe('bin/google CLI', () => {
  let origArgv: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;
  let origExit: typeof process.exit;

  beforeEach(() => {
    vi.resetModules(); // ensure the CLI module is re-imported each test
    vi.clearAllMocks();

    origArgv = process.argv.slice();
    origLog = console.log;
    origErr = console.error;
    origExit = process.exit;

    console.log = vi.fn();
    console.error = vi.fn();
    // stub process.exit so tests don't terminate
    (process as any).exit = vi.fn();
  });

  afterEach(() => {
    process.argv = origArgv;
    console.log = origLog;
    console.error = origErr;
    (process as any).exit = origExit;
  });

  it('auth-url prints generated url', async () => {
    mock_generateAuthUrl.mockReturnValueOnce('https://auth.example');
    process.argv = ['node', 'bin/google.ts', 'auth-url'];

    await import('./google');
    // allow async IIFE to settle if any
    await new Promise((r) => setImmediate(r));

    expect(mock_generateAuthUrl).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith('https://auth.example');
  });

  it('save-token without code errors and exits', async () => {
    process.argv = ['node', 'bin/google.ts', 'save-token'];
    await import('./google');

    expect(console.error).toHaveBeenCalledWith('Missing auth code');
    expect((process.exit as unknown as jest.Mock | Function)).toHaveBeenCalledWith(1);
  });

  it('save-token with code exchanges and confirms', async () => {
    mock_exchangeCodeAndSave.mockResolvedValueOnce({ access_token: 't' });
    process.argv = ['node', 'bin/google.ts', 'save-token', 'CODE123'];

    await import('./google');
    await new Promise((r) => setImmediate(r));

    expect(mock_exchangeCodeAndSave).toHaveBeenCalledWith('CODE123');
    expect(console.log).toHaveBeenCalledWith('Token saved.');
  });

  it('list-cals prints calendars as JSON', async () => {
    const cals = [{ id: 'cal1', summary: 'Test Calendar' }];
    mock_listCalendars.mockResolvedValueOnce(cals as any);
    process.argv = ['node', 'bin/google.ts', 'list-cals'];

    await import('./google');
    await new Promise((r) => setImmediate(r));

    expect(mock_listCalendars).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(cals, null, 2));
  });

  it('create-event with missing args errors and exits', async () => {
    process.argv = ['node', 'bin/google.ts', 'create-event', 'cal1', 'summary', 'start-only'];
    await import('./google');

    expect(console.error).toHaveBeenCalledWith('Usage: create-event <calendarId> <summary> <startISO> <endISO>');
    expect((process.exit as unknown as jest.Mock | Function)).toHaveBeenCalledWith(1);
  });

  it('create-event with args calls createCalendarEvent and prints result', async () => {
    mock_createCalendarEvent.mockResolvedValueOnce({ id: 'ev-1' });
    process.argv = ['node', 'bin/google.ts', 'create-event', 'cal1', 'Summary', '2026-04-01T00:00:00Z', '2026-04-01T01:00:00Z'];

    await import('./google');
    await new Promise((r) => setImmediate(r));

    expect(mock_createCalendarEvent).toHaveBeenCalledWith('cal1', 'Summary', '2026-04-01T00:00:00Z', '2026-04-01T01:00:00Z');
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({ id: 'ev-1' }, null, 2));
  });

  it('create-task without title errors and exits', async () => {
    process.argv = ['node', 'bin/google.ts', 'create-task', '@default'];
    await import('./google');

    expect(console.error).toHaveBeenCalledWith('Usage: create-task <tasklistId|@default> <title> [notes]');
    expect((process.exit as unknown as jest.Mock | Function)).toHaveBeenCalledWith(1);
  });

  it('create-task with args calls createTask and prints result', async () => {
    mock_createTask.mockResolvedValueOnce({ id: 'task-1' });
    process.argv = ['node', 'bin/google.ts', 'create-task', '@default', 'My Task', 'Some notes'];

    await import('./google');
    await new Promise((r) => setImmediate(r));

    expect(mock_createTask).toHaveBeenCalledWith('@default', 'My Task', 'Some notes');
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({ id: 'task-1' }, null, 2));
  });

  it('no args prints help and exits 0', async () => {
    process.argv = ['node', 'bin/google.ts'];
    await import('./google');

    expect(console.log).toHaveBeenCalled();
    // help path calls process.exit(0)
    expect((process.exit as unknown as jest.Mock | Function)).toHaveBeenCalledWith(0);
  });
});
