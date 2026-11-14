// F10 (2026-11-14): the watcher's Windows scheduled task, one per user and project: registered by `npm run setup` from an XML
// (`schtasks /Create /XML ... /F`: replaced, never doubled), removed by `npm run setup -- --watcher off`, told by `--check`. It runs
// at logon and every 5 minutes, as the logged-on user (InteractiveToken: only while logged on, no password stored), hidden, one
// instance at a time, 4 minutes at most. Its action is `wscript.exe "<home>\watch-boards.vbs"`: a console program as a task's
// action flashes a console in the interactive session, wscript (a GUI program) does not; the four-line script runs
// `node tools/watch-boards.mjs` with window style 0. The .vbs lives in the person's worker-board home (~/.worker-board), never in the
// repository checkout (G5: an untracked file in tools/ makes land.ps1 refuse every landing).

import { basename } from 'node:path'

/** The task's name for a project folder: "Worker board watcher (<folder name>)". */
export const taskNameFor = project => `Worker board watcher (${basename(String(project ?? '').replace(/[\\/]+$/, '')) || 'board'})`

const xmlText = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The task's XML: logon and every 5 minutes, the user's interactive token, hidden, one instance, 4 minutes at most. */
export function taskXml({ name, vbs, user, author = 'worker-board setup' }) {
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    `  <RegistrationInfo><Author>${xmlText(author)}</Author><Description>${xmlText(`${name}: starts the worker board again when an app update or a crash ended it (tools/watch-boards.mjs).`)}</Description></RegistrationInfo>`,
    '  <Triggers>',
    `    <LogonTrigger><Enabled>true</Enabled><UserId>${xmlText(user)}</UserId><Delay>PT1M</Delay></LogonTrigger>`,
    '    <TimeTrigger><Enabled>true</Enabled><StartBoundary>2026-01-01T00:00:00</StartBoundary><Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>',
    '  </Triggers>',
    `  <Principals><Principal id="Author"><UserId>${xmlText(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`,
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>true</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle><WakeToRun>false</WakeToRun>',
    '    <ExecutionTimeLimit>PT4M</ExecutionTimeLimit><Priority>7</Priority>',
    '  </Settings>',
    `  <Actions Context="Author"><Exec><Command>wscript.exe</Command><Arguments>//B //Nologo "${xmlText(vbs)}"</Arguments></Exec></Actions>`,
    '</Task>',
    '',
  ].join('\r\n')
}

/** The four-line script wscript runs: node, the watcher, window style 0, no wait. */
export function vbsText({ node, script }) {
  const quoted = text => `""${String(text)}""`
  return [
    "' The worker board's watcher (tools/watch-boards.mjs), run hidden by its scheduled task. Written by npm run setup; not for editing.",
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run "${quoted(node)} ${quoted(script)}", 0, False`,
    'Set shell = Nothing',
    '',
  ].join('\r\n')
}

/** What `schtasks /Query /V /FO LIST` says of the task, in a few words: `{ present, status, lastRun, lastResult }`. */
export function queryWords(output) {
  const text = String(output ?? '')
  if (text.trim() === '') return { present: false }
  const field = name => new RegExp(`^${name}:\\s*(.*)$`, 'mi').exec(text)?.[1]?.trim() ?? null
  return { present: true, status: field('Status'), lastRun: field('Last Run Time'), lastResult: field('Last Result') }
}

/**
 * The watcher part of setup. `mode`: 'on' (register, replacing), 'off' (delete), 'check' (say what is). `home` the person's
 * worker-board home (the .vbs goes there), `node` and `script` the watcher's program and file, `project` the board's project,
 * `user` the logon name (DOMAIN\user), `run(program, args)` runs a program and answers `{ code, out, err }`, `write(file, text)`
 * writes a file. Answers `{ ok, lines }` and never throws.
 */
export async function setupWatcher({ mode, home, node, script, project, user, run, write, now = Date.now() }) {
  const name = taskNameFor(project)
  const vbs = `${home.replace(/[\\/]+$/, '')}\\watch-boards.vbs`
  const lines = []
  try {
    const asked = await run('schtasks', ['/Query', '/TN', name, '/V', '/FO', 'LIST'])
    const state = asked.code === 0 ? queryWords(asked.out) : { present: false }
    if (mode === 'check') {
      lines.push(state.present
        ? `The watcher task "${name}" is registered (${state.status ?? 'state unknown'}; last run ${state.lastRun ?? 'never'}, result ${state.lastResult ?? '?'}); setup would write it again from ${vbs}.`
        : `The watcher task "${name}" is not registered: setup would register it (every 5 minutes and at logon, as you, hidden), with ${vbs}.`)
      return { ok: true, lines }
    }
    if (mode === 'off') {
      if (!state.present) return { ok: true, lines: [`The watcher task "${name}" was not registered: nothing to remove.`] }
      const gone = await run('schtasks', ['/Delete', '/TN', name, '/F'])
      if (gone.code !== 0) return { ok: false, lines: [`The watcher task "${name}" could not be removed: ${(gone.err || gone.out).trim().split('\n')[0]}`] }
      return { ok: true, lines: [`The watcher task "${name}" is removed (the .vbs in ${home} stays; the boards run on until they stop).`] }
    }
    await write(vbs, vbsText({ node, script }))
    const xmlFile = `${home.replace(/[\\/]+$/, '')}\\watch-boards.task.xml`
    await write(xmlFile, taskXml({ name, vbs, user }))
    const made = await run('schtasks', ['/Create', '/XML', xmlFile, '/TN', name, '/F'])
    if (made.code !== 0) return { ok: false, lines: [`The watcher task "${name}" could not be registered: ${(made.err || made.out).trim().split('\n')[0]}`] }
    lines.push(`The watcher task "${name}" is registered: every 5 minutes and at logon, as ${user}, hidden (wscript, ${vbs}); it starts a board that neither answers nor has a keeper, unless it was stopped on purpose. Find it in Task Scheduler under that name; npm run setup -- --watcher off removes it.`)
    return { ok: true, lines }
  } catch (error) {
    return { ok: false, lines: [`The watcher part of setup stopped: ${error instanceof Error ? error.message : String(error)}`] }
  }
}
