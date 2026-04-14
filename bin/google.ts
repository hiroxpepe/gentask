#!/usr/bin/env node
import { generate_auth_url, exchange_code_and_save, list_calendars, create_calendar_event, create_task } from '../src/google';

(async function(){
  const [, , cmd, ...args] = process.argv;
  try {
    if (cmd === 'auth-url') {
      console.log(generate_auth_url());
    } else if (cmd === 'save-token') {
      const code = args[0];
      if (!code) { console.error('Missing auth code'); process.exit(1); }
      await exchange_code_and_save(code);
      console.log('Token saved.');
    } else if (cmd === 'list-cals') {
      const cals = await list_calendars();
      console.log(JSON.stringify(cals, null, 2));
    } else if (cmd === 'create-event') {
      const [calendar_id, summary, start, end] = args;
      if (!calendar_id || !summary || !start || !end) {
        console.error('Usage: create-event <calendarId> <summary> <startISO> <endISO>');
        process.exit(1);
      }
      const ev = await create_calendar_event(calendar_id, summary, start, end);
      console.log(JSON.stringify(ev, null, 2));
    } else if (cmd === 'create-task') {
      const [tasklist_id, title, notes] = args;
      if (!title) {
        console.error('Usage: create-task <tasklistId|@default> <title> [notes]');
        process.exit(1);
      }
      const result = await create_task(tasklist_id, title, notes);
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('Commands: auth-url, save-token <code>, list-cals, create-event <calendarId> <summary> <startISO> <endISO>, create-task <tasklistId|@default> <title> [notes]');
      process.exit(0);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();

