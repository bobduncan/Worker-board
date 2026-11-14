// F10 (2026-11-14): the watcher's Windows scheduled task, ONE for the PC and user (it watches every board of boards.json, so a
// second project's setup replaces it rather than adding one; chat 1's review, item 8): registered by `npm run setup` from an XML
// (`schtasks /Create /XML ... /F`: replaced, never doubled), removed by `npm run setup -- --watcher off`, told by `--check`. It runs
// at logon and every 5 minutes, as the logged-on user (InteractiveToken: only while logged on, no password stored), hidden, one
// instance at a time, 4 minutes at most. Its action is `wscript.exe "<home>\watch-boards.vbs"`: a console program as a task's
// action flashes a console in the interactive session, wscript (a GUI program) does not; the four-line script runs
// `node tools/watch-boards.mjs` with window style 0. The .vbs lives in the person's worker-board home (~/.worker-board), never in the
// repository checkout (G5: an untracked file in tools/ makes land.ps1 refuse every landing). The XML is written as UTF-16LE with a
// BOM, as its first line declares and as Task Scheduler exports its own (a UTF-8 file with that line is refused by schtasks:
// "(1,40) switch from current encoding to specified encoding not supported"; chat 1's review, items 1 and 5). `--watcher off` leaves
// a marker in the home that a later plain setup respects; `--watcher on` removes it (item 6).

/** The task's one name on this PC. */
export const TASK_NAME = 'Worker board watcher'
/** The marker `--watcher off` leaves beside the .vbs: a later setup without `--watcher on` leaves the watcher off. */
export const OFF_MARKER = 'watcher-off.json'

/** The task XML's bytes: UTF-16LE with a BOM, as the declaration says. */
export const xmlBytes = text => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(String(text), 'utf16le')])

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

/** The four-line script wscript runs: node, the watcher, window style 0, waiting for it (so the task's one-instance rule and time limit hold). */
export function vbsText({ node, script }) {
  const quoted = text => `""${String(text)}""`
  return [
    "' The worker board's watcher (tools/watch-boards.mjs), run hidden by its scheduled task. Written by npm run setup; not for editing.",
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run "${quoted(node)} ${quoted(script)}", 0, True`,
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
 * The watcher part of setup. `mode`: 'on' (register, replacing), 'off' (delete, and leave the marker), 'check' (say what is);
 * `isExplicit`: `--watcher on` was given (the marker is removed; without it a marker keeps the watcher off). `home` the person's
 * worker-board home (the .vbs, the XML and the marker go there), `node` and `script` the watcher's program and file, `user` the
 * logon name (DOMAIN\user), `run(program, args)` runs a program and answers `{ code, out, err }`, `write(file, bytes)` writes a
 * file (text or a Buffer), `exists(file)` and `remove(file)` for the marker. Answers `{ ok, lines }` and never throws.
 */
export async function setupWatcher({ mode, isExplicit = false, home, node, script, user, run, write, exists = async () => false, remove = async () => {}, read = async () => null, now = Date.now() }) {
  const name = TASK_NAME
  const folder = home.replace(/[\\/]+$/, '')
  const vbs = `${folder}\\watch-boards.vbs`
  const marker = `${folder}\\${OFF_MARKER}`
  const lines = []
  try {
    const asked = await run('schtasks', ['/Query', '/TN', name, '/V', '/FO', 'LIST'])
    const state = asked.code === 0 ? queryWords(asked.out) : { present: false }
    if (mode === 'check') {
      const isOff = await exists(marker)
      lines.push(state.present
        ? `The watcher task "${name}" is registered (${state.status ?? 'state unknown'}; last run ${state.lastRun ?? 'never'}, result ${state.lastResult ?? '?'}); setup would write it again from ${vbs}.`
        : isOff ? `The watcher task "${name}" is not registered and stays off (\`--watcher off\` was given, ${marker}): \`npm run setup -- --watcher on\` turns it on.`
          : `The watcher task "${name}" is not registered: setup would register it (every 5 minutes and at logon, as you, hidden), with ${vbs}.`)
      if (state.present && isOff) lines.push(`The off marker ${marker} is there although the task is registered: \`--watcher off\` removes the task, \`--watcher on\` the marker.`)
      // The registered script: the task's own XML names the .vbs, the .vbs names the watcher; a path that differs from this checkout's is said.
      if (state.present) {
        const xml = await run('schtasks', ['/Query', '/TN', name, '/XML'])
        const registeredVbs = xml.code === 0 ? /"([^"]+\.vbs)"/i.exec(String(xml.out))?.[1] ?? null : null
        const vbsText = registeredVbs === null ? null : await read(registeredVbs)
        const registered = vbsText === null ? null : /""([^"]+\.mjs)""/i.exec(String(vbsText))?.[1] ?? null
        const same = path => String(path ?? '').replace(/\//g, '\\').toLowerCase()
        if (registered === null) lines.push(`The task's script could not be read (${registeredVbs ?? 'its XML names no .vbs'}).`)
        else if (same(registered) !== same(script)) lines.push(`WARNING: the task runs ${registered}, not this checkout's ${script}: run \`npm run setup\` here to point it at this one.`)
        else lines.push(`The task runs this checkout's watcher: ${registered}.`)
      }
      return { ok: true, lines }
    }
    if (mode === 'off') {
      const mark = () => write(marker, JSON.stringify({ at: now, by: 'npm run setup -- --watcher off' }))
      if (!state.present) {
        await mark()
        return { ok: true, lines: [`The watcher task "${name}" was not registered: nothing to remove; it stays off until \`npm run setup -- --watcher on\`.`] }
      }
      const gone = await run('schtasks', ['/Delete', '/TN', name, '/F'])
      // The marker only once the task is really gone: a failed delete leaves the task running and says so, with no marker that says off.
      if (gone.code !== 0) return { ok: false, lines: [`The watcher task "${name}" could not be removed: ${(gone.err || gone.out).trim().split('\n')[0]}`] }
      await mark()
      return { ok: true, lines: [`The watcher task "${name}" is removed (the .vbs in ${home} stays; the boards run on until they stop). It stays off until \`npm run setup -- --watcher on\`.`] }
    }
    if (await exists(marker)) {
      if (!isExplicit) return { ok: true, lines: [`The watcher stays off (\`--watcher off\` was given before, ${marker}): \`npm run setup -- --watcher on\` turns it on again.`] }
      await remove(marker)
    }
    await write(vbs, vbsText({ node, script }))
    const xmlFile = `${folder}\\watch-boards.task.xml`
    await write(xmlFile, xmlBytes(taskXml({ name, vbs, user })))
    const made = await run('schtasks', ['/Create', '/XML', xmlFile, '/TN', name, '/F'])
    if (made.code !== 0) return { ok: false, lines: [`The watcher task "${name}" could not be registered: ${(made.err || made.out).trim().split('\n')[0]}`] }
    lines.push(`The watcher task "${name}" is registered: every 5 minutes and at logon, as ${user}, hidden (wscript, ${vbs}); it starts a board that neither answers nor has a keeper, unless it was stopped on purpose. Find it in Task Scheduler under that name; npm run setup -- --watcher off removes it.`)
    return { ok: true, lines }
  } catch (error) {
    return { ok: false, lines: [`The watcher part of setup stopped: ${error instanceof Error ? error.message : String(error)}`] }
  }
}
