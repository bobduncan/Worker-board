// B930 (X131, X109): a worker that stopped its own background work, in the shapes the Claude app writes (a made-up chat, not a
// copy of one). Two commands sent to the background (15:30:05, 15:57:17 CET), each stopped by the chat's own TaskStop
// (15:52:23, 16:16:58); the app writes no notification for a stopped task. Then the step's report at 16:17:00, and the
// board's hand-over clears from 16:17:06 to 16:23:54, the last of which failed on the board's own 5-second time-out.

import { answer, assistant, user } from './lines.mjs'

/** A time on 2 Nov 2026 in CET (UTC+1). */
export const cet = (h, m, s = 0) => Date.UTC(2026, 10, 2, h - 1, m, s)

const FOLDER = 'C:\\made-up\\tasks'
/** The app's answer to a command sent to the background. */
export const launchAnswer = id => `Command running in background with ID: ${id}. Output is being written to: ${FOLDER}\\${id}.output. You will be notified when it completes — do not poll that file or sleep while waiting.`
/** The app's answer to a TaskStop that stopped a task. */
export const stopAnswer = (id, command = 'powershell -NoProfile -File watch-cpu.ps1 -minutes 60') => JSON.stringify({ message: `Successfully stopped task: ${id} (${command})`, task_id: id, task_type: 'local_bash', command })

/** A command sent to the background: the call and its answer. */
export const launched = (at, call, id) => [
  assistant(at - 1000, 'tool_use', [{ type: 'tool_use', id: call, name: 'PowerShell', input: { command: 'watch-cpu.ps1', run_in_background: true } }]),
  user(at, [{ tool_use_id: call, type: 'tool_result', content: launchAnswer(id), is_error: false }]),
]
/** The chat's own TaskStop of a task: the call and its answer. */
export const stopped = (at, call, id, { isError = false } = {}) => [
  assistant(at - 1000, 'tool_use', [{ type: 'tool_use', id: call, name: 'TaskStop', input: { task_id: id } }]),
  user(at, [{ tool_use_id: call, type: 'tool_result', content: isError ? `No task found with ID: ${id}` : stopAnswer(id), ...(isError ? { is_error: true } : {}) }]),
]

/** The real case's transcript: two launches, two stops, no notification, the report's answer. */
export const stoppedTwice = () => [
  ...launched(cet(15, 30, 5), 'toolu_watch1', 'bb65oc2x2'),
  ...stopped(cet(15, 52, 23), 'toolu_stop1', 'bb65oc2x2'),
  ...launched(cet(15, 57, 17), 'toolu_watch2', 'bvr2wx5br'),
  ...stopped(cet(16, 16, 58), 'toolu_stop2', 'bvr2wx5br'),
  answer(cet(16, 17, 0), 'B917 is reported.'),
]

/** The step's report (in review), the moment the clear became owed. */
export const REPORTED_AT = cet(16, 16, 0)
/** When the board sent its 34 clears, 16:17:06 to 16:23:54 (the outbox of 2 Nov): 33 refused, the last timed out. */
export const CLEARS_AT = ('16:17:06 16:17:12 16:17:22 16:17:32 16:17:51 16:17:59 16:18:06 16:18:22 16:18:32 16:18:42 16:18:52 16:19:03 '
  + '16:19:13 16:19:23 16:19:33 16:19:47 16:20:02 16:20:14 16:20:22 16:20:32 16:21:10 16:21:21 16:21:31 16:21:42 16:22:01 16:22:11 '
  + '16:22:22 16:22:42 16:22:52 16:23:03 16:23:21 16:23:32 16:23:49 16:23:54').split(' ').map(time => cet(...time.split(':').map(Number)))
/** The mod's words for a clear the board refused for background work (HTTP 409). */
export const REFUSED_WHY = 'its conversation could not be saved as a log (Background work it started is still running: its answer would come into a cleared conversation. (HTTP 409))'
/** The mod's words for a clear whose save-log the board did not answer within 5 seconds. */
export const TIMED_OUT_WHY = 'its conversation could not be saved as a log (The worker board did not answer (timed out after 5 s): nothing was recorded. Try again in a moment. If it still does not answer in a minute, tell the Supe'
