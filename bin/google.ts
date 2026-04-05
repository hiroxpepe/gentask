#!/usr/bin/env node
import { generateAuthUrl, exchangeCodeAndSave, listCalendars, createCalendarEvent, createTask } from '../src/google/index';

(async function(){
  const [, , cmd, ...args] = process.argv;
  try {
    if (cmd === 'auth-url') {
      console.log(generateAuthUrl());
    } else if (cmd === 'save-token') {
      const code = args[0];
      if (!code) { console.error('Missing auth code'); process.exit(1); }
      await exchangeCodeAndSave(code);
      console.log('Token saved.');
    } else if (cmd === 'list-cals') {
      const cals = await listCalendars();
      console.log(JSON.stringify(cals, null, 2));
    } else if (cmd === 'create-event') {
      const [calendarId, summary, start, end] = args;
      if (!calendarId || !summary || !start || !end) {
        console.error('Usage: create-event <calendarId> <summary> <startISO> <endISO>');
        process.exit(1);
      }
      const ev = await createCalendarEvent(calendarId, summary, start, end);
      console.log(JSON.stringify(ev, null, 2));
    } else if (cmd === 'create-task') {
      const [tasklistId, title, notes] = args;
      if (!title) {
        console.error('Usage: create-task <tasklistId|@default> <title> [notes]');
        process.exit(1);
      }
      const result = await createTask(tasklistId, title, notes);
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

