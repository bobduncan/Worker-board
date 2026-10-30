// B775: the evidence the obsolete check hands the Advisor, gathered by code, per open item: its step's state and last words,
// the commits that name its step (every repository the board knows), its chat in the list and
// what that chat does, and whether the board restarted since. Facts only: the Advisor judges. `run` is git's (the folders.mjs
// runner: arguments → text, null when it fails); nothing here writes.

import { basename } from 'node:path'

import { valueOf } from './item.mjs'
import { stamp } from './migrate.mjs'

const STEP = /^B\d+$/
const LINE_CHARS = 220
const COMMITS = 3
const day = ms => stamp(ms)
const cut = (text, max = LINE_CHARS) => {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}
const plain = (name, prefix) => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}

/**
 * The commits of `repos` (`[{ dir, base }]`) whose message names `id` as a word, newest first, at most a few, each with its day
 * and whether it came before or after the item was made (`at`, ms): a step built before its question was asked is as obsolete
 * as one built after. `["20ceb5f 2026-10-26 (after it was made) on main of lava-tactics: Terraces holes"]`. A repository that
 * cannot be read counts for none.
 */
export async function commitsNaming(id, at, { repos, run }) {
  const found = []
  const named = new RegExp(`(?<![\\w-])${id}(?![\\w-])`)
  for (const repo of repos) {
    const log = await run(['-C', repo.dir, 'log', repo.base, '--no-merges', '-n', '60', '--fixed-strings', `--grep=${id}`, '--format=%h%x09%cs%x09%ct%x09%s'])
    for (const row of String(log ?? '').split('\n')) {
      const [hash, date, seconds, ...subject] = row.split('\t')
      // The id as a word, not inside another (B1 is not B12).
      if (hash === '' || hash === undefined || !named.test(subject.join('\t'))) continue
      const when = Number(seconds) * 1000
      found.push({ when, line: `${hash} ${date} (${Number.isFinite(at) && when < at ? 'before' : 'after'} it was made) on ${repo.base} of ${basename(repo.dir)}: ${cut(subject.join(' '), 80)}` })
    }
  }
  return found.sort((a, b) => b.when - a.when).slice(0, COMMITS).map(one => one.line)
}

/** The step an item is about: a refine question's or an ask's `of`, an incident's step subject; null when it names none. */
const stepOf = one => (STEP.test(one.of ?? '') ? one.of : null)

/**
 * `Map<id, [line]>` of the open items (`openItemsOf`'s rows). `items` the store's items, `lanes` the chats of the list
 * (`[{ name, state, task, isRunning }]`), `board` `{ startedAt }` of this board, `mod` the installed Workers mod version.
 */
export async function obsoleteEvidence(open, { items, lanes = [], prefix = '', repos = [], run = async () => null, board = null, mod = null }) {
  const evidence = new Map()
  const commits = new Map()
  for (const one of open) {
    const lines = []
    const step = stepOf(one)
    const item = items.get(one.id)
    if (one.kind === 'incident') {
      const seen = Number(valueOf(item, 'Count')) || 1
      lines.push(`incident ${valueOf(item, 'State')}: ${valueOf(item, 'Source') ?? 'sweep'} saw it ${seen} time${seen === 1 ? '' : 's'}, first ${valueOf(item, 'First seen') ?? '?'}, last ${valueOf(item, 'Last seen') ?? '?'}`)
      const evidenceLine = valueOf(item, 'Evidence')
      if (evidenceLine !== null) lines.push(`what was seen last: ${cut(evidenceLine, 140)}`)
    } else {
      lines.push(`asked ${Number.isFinite(one.at) ? day(one.at) : '?'}${one.owner === null ? '' : ` by ${one.owner}`}${valueOf(item, 'Blocking') === 'yes' ? ', blocks its step' : ''}`)
    }
    const stepItem = step === null ? undefined : items.get(step)
    if (step !== null) {
      if (stepItem === undefined) lines.push(`${step} is not in the store`)
      else {
        const owner = valueOf(stepItem, 'Owner')
        lines.push(`${step} is ${valueOf(stepItem, 'State')}${owner === null ? '' : `, ${owner}'s`} since ${valueOf(stepItem, 'Since') ?? '?'}`)
        const last = (stepItem.sections?.get('History') ?? []).filter(entry => entry.trim() !== '').at(-1)
        if (last !== undefined) lines.push(`${step} last History: ${cut(last.replace(/^-\s+/, ''), 150)}`)
      }
    }
    // The commits that name its step, before or after the item was made (an incident: its fix step, else the subject step).
    const named = step ?? (STEP.test(valueOf(item, 'Fix') ?? '') ? valueOf(item, 'Fix') : null)
    if (named !== null) {
      const key = `${named}@${one.at}`
      if (!commits.has(key)) commits.set(key, await commitsNaming(named, one.at, { repos, run }).catch(() => []))
      const found = commits.get(key)
      lines.push(found.length === 0 ? `no commit names ${named}` : `${found.length === COMMITS ? 'latest ' : ''}${found.length} commit${found.length === 1 ? '' : 's'} naming ${named}: ${found.join(' | ')}`)
    }
    // Its chat: in the list or gone, and what it does.
    const chat = one.owner ?? (one.kind === 'incident' ? valueOf(item, 'Subject') : null)
    if (chat !== null && !STEP.test(chat)) {
      const lane = lanes.find(known => plain(known.name, prefix) === plain(chat, prefix))
      if (lane !== undefined || one.owner !== null) {
        lines.push(lane === undefined ? `${chat} is not in the list of chats` : `${chat} is in the list${lane.state ? `, ${lane.state}` : ''}${lane.task ? `: ${cut(lane.task, 80)}` : ''}${lane.isRunning === false ? ' (not running)' : ''}`)
      }
    }
    if (board !== null && Number.isFinite(board.startedAt) && Number.isFinite(one.at) && board.startedAt > one.at) lines.push(`the board restarted ${day(board.startedAt)}, after it was made${mod === null ? '' : `; Workers mod ${mod} is installed`}`)
    evidence.set(one.id, lines.slice(0, 8).map(line => cut(line)))
  }
  return evidence
}
