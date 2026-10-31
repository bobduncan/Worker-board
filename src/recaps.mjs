// B878 (X116: B821 waited for the person's verdict in G60's recap, the board read it as stuck, and nothing closed it): the goal
// recaps (goal demos, src/demo.mjs) whose parts name the steps they show, and where each part stands with the person. A step
// whose part waits for their verdict waits as planned (resultCheck.mjs `reviewWaitOf` kind 'recap'); their Approve closes it
// and their Send back names it to the partner (server.mjs `demoFeedbackNow`).
//
// The recaps are found in the picture folders, as roles/partner.md "The goal demo" places them: `<folder>/<goal id>/<any>/demo.json`
// (or `<folder>/<goal id>/demo.json`) for each open goal of the map, and every open goal's `Demo:` line that names a .json.

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { roundsOf, standOf } from './demoFeedback.mjs'
import { parseGoals } from './goals.mjs'
import { readDemo, shownFolders, shownRoots } from './pictures.mjs'
import { sinceMs } from './work/item.mjs'

/** The demo.json files of the open goals in the goal map's text: paths in the shown folders, each once. */
export async function recapFiles(config, goalsText) {
  if (typeof goalsText !== 'string' || typeof config?.project !== 'string') return []
  const open = parseGoals(goalsText).nodes.filter(node => node.state !== 'done')
  const ids = new Set(open.map(node => node.id.toLowerCase()))
  const names = async folder => (await readdir(join(config.project, ...folder.split('/')), { withFileTypes: true }).catch(() => [])).filter(one => one.isDirectory()).map(one => one.name)
  const found = open.map(node => String(node.demo ?? '').split(' · ')[0].trim().replace(/\\/g, '/')).filter(path => /\.json$/i.test(path))
  for (const folder of shownFolders(config)) {
    for (const goal of (await names(folder)).filter(name => ids.has(name.toLowerCase()))) {
      if ((await readdir(join(config.project, ...folder.split('/'), goal)).catch(() => [])).includes('demo.json')) found.push(`${folder}/${goal}/demo.json`)
      for (const sub of await names(`${folder}/${goal}`)) {
        const entries = await readdir(join(config.project, ...folder.split('/'), goal, sub)).catch(() => [])
        if (entries.includes('demo.json')) found.push(`${folder}/${goal}/${sub}/demo.json`)
      }
    }
  }
  return [...new Set(found)]
}

/**
 * The recaps as the board keeps them for a tick: `[{ path, goal, parts: [{ key, title, steps }], rounds, changedAt }]`, from
 * every recap file a part of which names a step (a demo without step ids changes nothing); `changedAt`, when demo.json was
 * last written (ms): the partner writes it again with the new tries. A file the board cannot read is left out.
 */
export async function readRecaps(config, goalsText) {
  const recaps = []
  for (const path of await recapFiles(config, goalsText)) {
    const found = await readDemo(config.project, shownRoots(config), path)
    if (found === null || found.why !== undefined) continue
    const parts = found.base.sections.flatMap(section => section.rows).filter(row => row.steps.length > 0).map(row => ({ key: row.key, title: row.title, steps: row.steps }))
    const changedAt = await stat(found.file).then(info => info.mtimeMs, () => null)
    if (parts.length > 0) recaps.push({ path, goal: found.base.goal, parts, rounds: roundsOf(found.feedback), changedAt })
  }
  return recaps
}

/**
 * Pure: where each step a recap part names stands with the person, `[{ step, goal, path, key, title, verdict, at }]`:
 * verdict null while they have not judged the part, 'sent-back' (`at`, ms, their Send) when the last round sent it back and
 * the demo was not written since (`changedAt` a minute after the Send or later: the new try waits for their verdict, null).
 * An approved part is left out: its steps are closed by the Approve (or wait as any other step, when that did not take).
 */
export function recapWaitsOf(recaps) {
  return (Array.isArray(recaps) ? recaps : []).flatMap(recap => {
    const stand = standOf(recap.rounds ?? [])
    const sent = new Map((recap.rounds ?? []).map(round => [round.n, sinceMs(round.at)]))
    return recap.parts.flatMap(part => {
      const said = stand.get(part.key)
      if (said?.verdict === 'approved') return []
      const back = said?.verdict === 'sent-back' ? sent.get(said.round) ?? null : null
      // The Send is stamped to its minute: a demo written in a later minute holds the partner's new try.
      const tried = Number.isFinite(back) && Number.isFinite(recap.changedAt) && recap.changedAt >= back + 60_000
      const verdict = said?.verdict === 'sent-back' && !tried ? 'sent-back' : null
      const at = verdict === null ? null : back
      return part.steps.map(step => ({ step, goal: recap.goal, path: recap.path, key: part.key, title: part.title, verdict, at }))
    })
  })
}

