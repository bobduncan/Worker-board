// The Brainstorm screen's list (the person, 2026-10-31: "i want to split these brainstorms whats currently open/active and
// whats already closed. per topic also reevaluate when the last interaction was because i feel a lot of older topics might
// still be open otherwise"): three groups (Active, Older still open, Closed), each row's word with its age, a stopped talk
// in a quiet grey with "Type it to your partner again" as its main button, a quiet "Close it" for an old open talk, and
// the Closed line the board (or the person by hand) writes. The Product owner's card under the Advisor's. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { brainstormsState, closeThread, editThread, parseThread, strandedQuestions } from '../src/brainstorm.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'
import { talkPartnerOf } from '../src/talkPartner.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const [script, css] = await Promise.all([readFile(join(ROOT, 'public', 'board.js'), 'utf8'), readFile(join(ROOT, 'public', 'board.css'), 'utf8')])
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// brainstorm:start'), script.indexOf('// brainstorm:end'))}
Object.assign(this, { brainstormCardView, brainstormListView, brainstormPartnerView, brainstormStatusOf })`, made)
const view = Object.fromEntries(Object.entries(made).map(([name, fn]) => [name, (...args) => JSON.parse(JSON.stringify(fn(...args) ?? null))]))

const MIN = 60_000
const NOW = new Date(2026, 9, 31, 12, 0).getTime()
const at = (day, hour, minute) => new Date(2026, 9, day, hour, minute).getTime()
const head = (title, started, state = 'running') => `# Brainstorm: ${title}\nGoal: new\nStarted: ${started} · State: ${state}\nOpening: Where should the lanterns go?\n\n`
const q1 = time => `## Q1 (${time})\nWhere first?\nContext: Most visitors come in by the gate.\n- A: By the gate (advised)\n- B: By the pond\n`
const a1 = time => `Answer (${time}): A\n`
const PROPOSAL = '\n## Proposal (09:20)\nDecided:\n- the gate first\nGoals:\n- [ ] Lanterns by the gate — under top — Done when: a visitor finds the gate at night\nSteps:\n- [ ] Make a lantern sprite — Main decides — about 1 h\nNote: most visitors come in by the gate.\nCreated (09:30): G10; B40; left out: nothing\n'
/** The exact line the person's chat wrote by hand under five old talks on 2026-10-31. */
const BY_HAND = 'Closed (2026-10-31 11:45): by the person, as one of five old open talks'
const idle = { name: 'Advisor', role: 'advisor', isRunning: true, state: 'free', doingNow: null, on: null, next: [] }
const one = (path, text, mtime) => ({ path: `.claude/brainstorms/${path}.md`, text, at: mtime })
const threadsOf = list => brainstormsState(list, '.claude/brainstorms').threads

const FRESH = one('fresh', `${head('Fresh', '2026-10-31 10:50')}${q1('10:55')}${a1('11:00')}`, at(31, 11, 0))
const FRESH_NOW = one('fresh-now', `${head('Just answered', '2026-10-31 11:40')}${q1('11:45')}${a1('11:50')}`, at(31, 11, 50))
const OLD = one('old', `${head('Old', '2026-10-25 09:00')}${q1('09:05')}${a1('09:10')}`, at(25, 9, 10))
const ASKS = one('asks', `${head('Asks you', '2026-10-24 09:00')}${q1('09:05')}`, at(24, 9, 5))
const MADE = one('made', `${head('Made', '2026-10-30 09:00')}${q1('09:05')}${a1('09:10')}${PROPOSAL}`, at(30, 9, 30))
const DROPPED = one('dropped', `${head('Dropped', '2026-10-20 09:00', 'discarded')}${q1('09:05')}`, at(20, 9, 5))
const SHUT = one('shut', `${head('Shut', '2026-10-25 09:00', 'done')}${q1('09:05')}${a1('09:10')}\n${BY_HAND}\n`, at(31, 11, 45))

// ---------------------------------------------------------------------------------------------------------------------
// A stopped talk

test('a talk "thinks" only while the last move is under 30 minutes old; with no word queued or taken it stops, in a quiet grey', () => {
  const [fresh] = threadsOf([FRESH_NOW])
  assert.equal(view.brainstormStatusOf(fresh, idle, NOW).word, 'your partner is thinking', '10 minutes after the answer')
  const [old] = threadsOf([FRESH])
  assert.deepEqual(view.brainstormStatusOf(old, idle, NOW), { word: 'stopped · nothing sent', tone: 'stopped' })
  const card = view.brainstormPartnerView(old, idle, NOW)
  assert.deepEqual([card.kind, card.headline], ['stopped', 'Stopped · nothing sent'])
  // A word queued or taken for it keeps it waiting or thinking, however old the move.
  const queued = { ...idle, next: [{ kind: 'brainstorm-answer', thread: old.path, stand: { kind: 'queued', since: NOW - 50 * MIN } }] }
  assert.equal(view.brainstormStatusOf(old, queued, NOW).word, 'waiting for your partner')
  const taken = { ...idle, state: 'working', next: [{ kind: 'brainstorm-answer', thread: old.path, stand: { kind: 'taken', since: NOW - 50 * MIN } }] }
  assert.equal(view.brainstormStatusOf(old, taken, NOW).word, 'your partner is thinking')
  // Without the state's time the rule cannot tell: as before.
  assert.equal(view.brainstormStatusOf(old, idle).word, 'your partner is thinking')
  assert.match(css, /\.brainstorm-status\.is-stopped \{ color: #7d8797; \}/)
})

/** The page over the made-up garden's state, its clock at NOW, with the threads given. */
function pageState(threads, advisor = {}) {
  const state = asSent({ ...build([], undefined, undefined, { threadTexts: threads }), goalsEdit: { canWrite: true } })
  const changed = { ...state, readAt: NOW, advisor: { ...state.advisor, isRunning: true, ...advisor } }
  return { ...changed, talkPartner: talkPartnerOf(changed) }
}
async function open(threads, { answers, advisor } = {}) {
  const page = await openPage({ state: pageState(threads, advisor), answers })
  await page.click('[data-tab="advice"]')
  await page.click('[data-advisor-pane="brainstorm"]')
  return page
}

test('a stopped talk\'s card offers "Type it to your partner again" as its main button, which types the word again', async () => {
  const page = await open([FRESH], { answers: () => reply({}) })
  try {
    const card = page.find('.brainstorm-waiting')
    assert.equal(card.className, 'brainstorm-box brainstorm-waiting is-stopped')
    assert.equal(page.text('.brainstorm-wait-line'), 'Stopped · nothing sent')
    assert.equal(page.text('.brainstorm-again'), 'Type it to your partner again')
    await page.click('.brainstorm-again')
    assert.deepEqual(page.sent('/api/say').map(one => [one.body.command, one.body.to, one.body.n]), [['brainstorm-answer', 'Advisor', 1]])
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// The three groups, each row with its age

test('the list in three groups, the newest first in each: Active, Older still open, Closed', () => {
  const list = view.brainstormListView(threadsOf([OLD, MADE, ASKS, DROPPED, SHUT, FRESH]), idle, NOW)
  assert.deepEqual(list.active.map(row => row.title), ['Fresh', 'Asks you'], 'within 3 days, or waiting on the person however old')
  assert.deepEqual(list.older.map(row => row.title), ['Old'])
  assert.deepEqual(list.closed.map(row => row.title), ['Shut', 'Made', 'Dropped'])
  assert.deepEqual(list.running.map(row => row.title), ['Fresh', 'Asks you', 'Old'])
  assert.deepEqual(list.done.map(row => row.title), ['Shut', 'Made', 'Dropped'])
})

test('each row\'s word is followed by its age: the latest of the start, a question, an answer, the proposal, Created and Closed', () => {
  const list = view.brainstormListView(threadsOf([OLD, MADE, ASKS, DROPPED, SHUT, FRESH]), idle, NOW)
  const words = Object.fromEntries([...list.active, ...list.older, ...list.closed].map(row => [row.title, row.word]))
  assert.deepEqual(words, {
    Fresh: 'stopped · 1 h ago',
    'Asks you': 'your turn · 7 days ago',
    Old: 'stopped · 6 days ago',
    Shut: 'closed · 15 min ago',
    Made: 'created · 1 day ago',
    Dropped: 'discarded · 11 days ago',
  })
  // The file's own time is the fallback for a thread whose head says no start.
  const [bare] = threadsOf([one('bare', '# Brainstorm: Bare\nGoal: new\nOpening: words\n\n', NOW - 3 * 60 * MIN)])
  assert.equal(view.brainstormListView([bare], idle, NOW).active[0].word, 'stopped · 3 h ago')
})

test('a running thread whose proposal was created counts as closed', () => {
  const [made] = threadsOf([MADE])
  assert.equal(made.state, 'running')
  const list = view.brainstormListView([made], idle, NOW)
  assert.deepEqual([list.active.length, list.older.length, list.closed.map(row => row.word)], [0, 0, ['created · 1 day ago']])
})

test('the page draws the three groups under their quiet names', async () => {
  const page = await open([OLD, MADE, FRESH])
  try {
    assert.deepEqual(page.all('.brainstorm-group').map(one => one.textContent), ['Active', 'Older, still open', 'Closed'])
    assert.deepEqual(page.all('.brainstorm-row b').map(one => one.textContent), ['Fresh', 'Old', 'Made'])
    assert.deepEqual(page.all('.brainstorm-row small').map(one => one.textContent), ['stopped · 1 h ago', 'stopped · 6 days ago', 'created · 1 day ago'])
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// Close it

test('an old open talk\'s "…" menu holds a quiet "Close it" beside Discard; it sets the thread done through /api/brainstorm', async () => {
  const page = await open([OLD], { answers: () => reply({ ok: true, result: {} }) })
  try {
    await page.click('.brainstorm-menu-button')
    const items = page.all('.brainstorm-menu-list .brainstorm-menu-item').map(one => one.textContent)
    assert.deepEqual(items.slice(-2), ['Close it', 'Discard'])
    await page.click('[data-brainstorm-act="close"]')
    assert.deepEqual(page.sent('/api/brainstorm').map(one => one.body), [{ command: 'close', path: OLD.path }])
  } finally { await page.close() }
  // An active talk has none.
  const fresh = await open([FRESH])
  try {
    await fresh.click('.brainstorm-menu-button')
    assert.ok(!fresh.all('.brainstorm-menu-list .brainstorm-menu-item').some(one => one.textContent === 'Close it'))
  } finally { await fresh.close() }
})

function fakeFs(files) {
  return {
    files,
    readFile: async path => {
      if (!(path in files)) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return Buffer.from(files[path], 'latin1')
    },
    writeFile: async (path, bytes, options) => {
      if (options?.flag === 'wx' && path in files) throw Object.assign(new Error('there'), { code: 'EEXIST' })
      files[path] = Buffer.from(bytes).toString('latin1')
    },
    rename: async (from, to) => { files[to] = files[from]; delete files[from] },
    rm: async path => { delete files[path] },
    mkdir: async () => {},
    access: async path => { if (!(path in files)) throw new Error('gone') },
    readdir: async () => [],
  }
}

test('Close it: the thread is done with no proposal, and the board writes "Closed (HH:MM): by the person" at its end', async () => {
  const closed = closeThread(OLD.text, '12:00')
  assert.equal(closed.ok, true)
  assert.match(closed.text, /State: done/)
  assert.match(closed.text, /\n\nClosed \(12:00\): by the person\n$/)
  const parsed = parseThread(closed.text)
  assert.deepEqual([parsed.state, parsed.proposal, parsed.closed, parsed.problems], ['done', null, { at: '12:00', by: 'by the person' }, []])
  assert.equal(closeThread(closed.text, '12:01').ok, false, 'one that is over is not closed again')
  // Through the brainstorm route's own way, on the board that writes.
  const file = 'D:/work/studio/talks/old.md'
  const fs = fakeFs({ [file]: Buffer.from(OLD.text, 'utf8').toString('latin1') })
  const done = await editThread({ command: 'close', path: 'talks/old.md' }, { canWrite: true, dir: 'D:/work/studio/talks', folder: 'talks', goalsFile: 'D:/work/studio/goals.md', historyDir: 'D:/work/studio/history', now: NOW, fs })
  assert.equal(done.ok, true)
  assert.match(Buffer.from(fs.files[file], 'latin1').toString('utf8'), /Closed \(12:00\): by the person\n$/)
})

test('the Closed line the person\'s chat wrote by hand is read as the thread\'s close, with its day, and counts as its last move', () => {
  const parsed = parseThread(SHUT.text)
  assert.deepEqual(parsed.closed, { at: '2026-10-31 11:45', by: 'by the person, as one of five old open talks' })
  assert.deepEqual(parsed.problems, [], 'no odd line')
  const [shut] = threadsOf([{ ...SHUT, at: at(25, 9, 10) }])
  const list = view.brainstormListView([shut], idle, NOW)
  assert.equal(list.closed[0].word, 'closed · 15 min ago', 'its own day and time, whatever the file says')
  assert.match(list.closed[0].tip, /closed 2026-10-31 11:45: by the person, as one of five old open talks/)
  assert.deepEqual(view.brainstormCardView(shut, idle, NOW).closed, { at: '2026-10-31 11:45', by: 'by the person, as one of five old open talks' })
  // A talk the person closed asks nothing more: its open question is not told as stranded.
  const open = parseThread(`${head('Shut', '2026-10-25 09:00', 'done')}${q1('09:05')}\n${BY_HAND}\n`)
  assert.equal(open.closed.at, '2026-10-31 11:45')
  assert.deepEqual(strandedQuestions(threadsOf([one('shut-open', `${head('Shut', '2026-10-25 09:00', 'done')}${q1('09:05')}\n${BY_HAND}\n`, NOW)])), [])
  assert.equal(strandedQuestions(threadsOf([one('done-open', `${head('Done', '2026-10-25 09:00', 'done')}${q1('09:05')}`, NOW)])).length, 1, 'one done without the line still is')
})

// ---------------------------------------------------------------------------------------------------------------------
// The Product owner's card

/** The source of a top-level function of board.js, by its name. */
function source(name) {
  const start = script.search(new RegExp(`^function ${name}[(]`, 'm'))
  assert.ok(start >= 0, `${name} is not in board.js`)
  const lines = script.slice(start).split('\n')
  return lines.slice(0, lines.findIndex((line, index) => index > 0 && line.startsWith('}')) + 1).join('\n')
}

test('the Product owner\'s card under the Advisor\'s: its role, what it is on, the talks waiting and its held setting', () => {
  const card = {}
  vm.runInNewContext(`${source('ownerCardView')}\nObject.assign(this, { ownerCardView })`, card)
  assert.equal(card.ownerCardView(null), null)
  const owner = { name: 'Product owner', state: 'working', doingNow: 'Brainstorm: Q2', on: { kind: 'brainstorm-answer', title: 'Lanterns', thread: 'x.md', since: NOW }, next: [{ stand: { kind: 'queued' } }, { stand: { kind: 'taken' } }], setting: { model: 'opus', effort: 'medium', isSet: true } }
  assert.deepEqual(JSON.parse(JSON.stringify(card.ownerCardView(owner))), { name: 'Product owner', label: 'Product owner', now: 'Talk: Lanterns', note: 'takes your talks first: brainstorms, goal changes, the Focus page\'s talk', waiting: 1, setting: { text: 'Opus · medium', isSet: true } })
  assert.equal(card.ownerCardView({ ...owner, state: 'free', on: null, next: [] }).now, null)
  assert.ok(source('drawAdvisorLane').includes('const owner = drawOwnerCard(state)'))
})
