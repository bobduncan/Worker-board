// Spending counts every chat (2026-11-05): a one-off full count to check the Spending tab against. Every answer of every
// session in the project's transcripts folder (the cards in .claude/chats name the board's, the cleared ones too; the
// app's titles name the rest) and of their children and workflow agents, once per message id, by chat: today's and the
// last 7 days' messages and tokens. Read only.
// Usage: node tools/spending-count.mjs <transcripts folder> <project folder> [app sessions folder] [name=session ...]
// The current sessions (the board's state.spendingSubjects) count under their names; every other session as the
// collector counts it (src/work/routing/collector.mjs: movedSubjects, appTitles, sessionFiles).
import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { appTitles, movedSubjects, sessionFiles } from '../src/work/routing/collector.mjs'

const [transcripts, project, appSessions, ...lanesArgs] = process.argv.slice(2)
if (!transcripts || !project) {
  console.error('Usage: node tools/spending-count.mjs <transcripts folder> <project folder> [app sessions folder] [name=session ...]')
  process.exit(2)
}
const titles = appSessions && existsSync(appSessions) ? await appTitles(appSessions) : new Map()
const titleOf = session => titles.get(session) ?? null
const lanes = lanesArgs.map(arg => { const at = arg.lastIndexOf('='); return { name: arg.slice(0, at), session: arg.slice(at + 1) } })
const own = new Set(lanes.map(one => one.session))
const claimed = (await movedSubjects(join(project, '.claude', 'chats'), new Map(), titleOf)).filter(one => !own.has(one.session))
const known = new Set([...own, ...claimed.map(one => one.session)])
const others = readdirSync(transcripts).filter(name => /^[\w-]+\.jsonl$/.test(name)).map(name => name.slice(0, -6)).filter(session => !known.has(session))
  .map(session => ({ session, name: titleOf(session) ?? 'Earlier chat' }))
const files = []
for (const one of [...lanes, ...claimed, ...others]) for (const file of (await sessionFiles(transcripts, one.session)).files) if (file.size !== null) files.push([file.path, one.name])
const now = Date.now(), dayStart = new Date().setHours(0, 0, 0, 0), weekStart = now - 7 * 86400000
const seen = new Map()
for (const [path, chat] of files) {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (!line.includes('"type":"assistant"')) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    const id = entry?.message?.id
    if (entry?.type !== 'assistant' || typeof id !== 'string') continue
    const usage = entry.message.usage ?? {}
    const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
    const was = seen.get(id)
    if (was === undefined) seen.set(id, { chat, at: Date.parse(entry.timestamp), tokens })
    else was.tokens = Math.max(was.tokens, tokens)
  }
}
const table = from => {
  const rows = {}
  for (const one of seen.values()) {
    if (!(one.at >= from && one.at <= now)) continue
    const row = rows[one.chat] ??= { messages: 0, tokens: 0 }
    row.messages++
    row.tokens += one.tokens
  }
  return rows
}
console.log(JSON.stringify({ files: files.length, today: table(dayStart), week: table(weekStart) }, null, 2))
