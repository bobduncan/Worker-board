// A quick, read-only reader of data/spending.json (B1049: chats grepped the one-line ~24 MB file and an orphaned grep.exe held it open).
// Reads the file once with one readFile (never a stream, never kept open) and prints the Spending tab's numbers, by the board's own routingSummary.
// Usage: node tools/spending-read.mjs [<spending.json>] [--days N | --day YYYY-MM-DD] [--by chat|day|model|phase] [--json]
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { routingSummary } from '../src/work/routing/metrics.mjs'

const usage = 'Usage: node tools/spending-read.mjs [<spending.json>] [--days N | --day YYYY-MM-DD] [--by chat|day|model|phase] [--json]'
const groupOf = { chat: 'chats', day: 'daily', model: 'models', phase: 'phases' }
const fail = (line, code = 1) => { console.error(line); process.exit(code) }
const args = process.argv.slice(2)
let file = null, days = 7, day = null, by = 'chat', json = false
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--json') json = true
  else if (a === '--days') { days = Number(args[++i]); if (!Number.isFinite(days) || days <= 0) fail(`--days needs a positive number. ${usage}`, 2) }
  else if (a === '--day') { day = args[++i]; if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '') || Number.isNaN(Date.parse(day))) fail(`--day needs YYYY-MM-DD. ${usage}`, 2) }
  else if (a === '--by') { by = args[++i]; if (!groupOf[by]) fail(`--by is chat, day, model or phase. ${usage}`, 2) }
  else if (a.startsWith('--')) fail(`Unknown option ${a}. ${usage}`, 2)
  else if (file === null) file = a
  else fail(usage, 2)
}
file ??= join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'spending.json')
let ledger
try { ledger = JSON.parse(await readFile(file, 'utf8')) }
catch (error) { fail(`Cannot read the spending ledger ${file}: ${error.code ?? error.message}`) }
const events = Array.isArray(ledger?.events) ? ledger.events : fail(`Not a spending ledger (no events list): ${file}`)
// A day is a UTC day, as the Spending tab's daily groups are.
const picked = day === null ? events : events.filter(e => new Date(e.sourceAt).toISOString().slice(0, 10) === day)
const summary = routingSummary({ events: picked, folded: ledger.folded, outcomes: [], now: Date.now(), days: day === null ? days : null })
const groups = summary[groupOf[by]]
const money = n => `$${n.toFixed(2)}`
const row = (name, g) => `${name}  messages ${g.messages}  cost ${money(g.low)}-${money(g.high)}  tokens in ${g.input} cacheW ${g.cacheWrite} cacheR ${g.cacheRead} out ${g.output}`
if (json) console.log(JSON.stringify({ period: day ?? `last ${days} days`, by, messages: summary.messages, knownCost: summary.knownCost, tokens: summary.tokens, groups }, null, 2))
else {
  console.log(`Spending ${day ?? `last ${days} days`}, by ${by} (API-equivalent estimate)`)
  for (const g of groups) console.log(row(g.key, g))
  const t = summary.tokens
  console.log(`TOTAL  messages ${summary.messages}  cost ${money(summary.knownCost.low)}-${money(summary.knownCost.high)}  tokens in ${t.input ?? 0} cacheW ${t.cacheWrite ?? 0} cacheR ${t.cacheRead ?? 0} out ${t.output ?? 0}${summary.unknownCostMessages ? `  (${summary.unknownCostMessages} messages without a price)` : ''}`)
}
