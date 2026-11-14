// F17 (chat 1, 2026-11-14, the person's yes): the scheduled wake courier (tools/wake-courier.md) is a task of the Claude app that only a model
// can make: code cannot create a scheduled task (the app's create_scheduled_task is a tool for a chat's model). Setup therefore makes it
// clear what to ask for on a new PC: `npm run setup` (and `-- --check`) prints these lines. PURE.

/** The task's name, as chat 1 made it on 2026-11-14. */
export const COURIER_TASK = 'Worker board wake courier'
/** Its prompt file, in the board's folder. */
export const COURIER_PROMPT = 'tools/wake-courier.md'

/** The lines setup prints about the courier task. */
export function courierLines() {
  return [
    `The wake courier (scheduled task "${COURIER_TASK}"): while the Claude app refuses the board's own sends, it wakes the sleeping chats.`,
    `  Its prompt is ${COURIER_PROMPT}; it runs every 10 minutes, on the cheapest model (Haiku), in Auto mode.`,
    '  Setup cannot make it: code cannot create a scheduled task. Ask a chat once on this PC: "create the scheduled task '
      + `${COURIER_TASK} with create_scheduled_task, every 10 minutes, cheapest model, Auto mode, its prompt from ${COURIER_PROMPT}".`,
    '  It costs nothing when nothing is due (an empty list, or 404 on a board without the courier route, ends its run).',
  ]
}
