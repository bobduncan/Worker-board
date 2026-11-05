// Spending counts every chat (2026-11-05): a one-off full count to check the Spending tab against. Every answer of every
// session a board chat ever had (the cards in .claude/chats name them, the cleared ones too) and of their native
// children, once per message id, by chat: today's and the last 7 days' messages and tokens. Read only.
// Usage: node tools/spending-count.mjs <transcripts folder> <project folder> [current sessions as name=session ...]
// The current sessions (the board's state.spendingSubjects) count under their names; every other card's session as
// the collector counts it (src/work/routing/collector.mjs, movedSubjects).
import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { movedSubjects } from '../src/work/routing/collector.mjs'

const [transcripts, project, ...lanesArgs] = process.argv.slice(2)
if (!transcripts || !project) {
  console.error('Usage: node tools/spending-count.mjs <transcripts folder> <project folder> [name=session ...]')
  process.exit(2)
}
const lanes = lanesArgs.map(arg => { const at = arg.lastIndexOf('='); return { name: arg.slice(0, at), session: arg.slice(at + 1) } })
const own = new Set(lanes.map(one => one.session))
const subjects = [...lanes, ...(await movedSubjects(join(project, '.claude', 'chats'))).filter(one => !own.has(one.session))]
const files = []
for (const one of subjects) {
  files.push([join(transcripts, `${one.session}.jsonl`), one.name])
  const children = join(transcripts, one.session, 'subagents')
  if (existsSync(children)) for (const name of readdirSync(children)) if (/^[\w-]+\.jsonl$/.test(name)) files.push([join(children, name), one.name])
}
const now = Date.now(), dayStart = new Date().setHours(0, 0, 0, 0), weekStart = now - 7 * 86400000
const seen = new Map()
for (const [path, chat] of files) {
  if (!existsSync(path)) continue
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
