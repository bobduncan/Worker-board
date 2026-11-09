// Reactive board, brief P4a (the person, 2026-11-09: "it tries to react directly to the CHAT instead of code just submitting an
// item in a queue and then waiting for the chat to pick it up"): ONE CLICK IS ONE SERVER ACTION. The input is stored and its word
// queued in one action, idempotent by a click id; the click's record carries its word's id or `not sent: <why>, HH:MM`, and a
// retry by the same id queues the word once more and never writes the input twice. Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { NEVER_VIA, brainstormClickOf, clickIdOf, clickLedger, hhmm, oneClick, retryClick } from '../src/clicks.mjs'
import { interventionsOf } from '../src/stability.mjs'
import { keepPersonAction } from '../src/work/api.mjs'

const AT = new Date(2026, 10, 9, 14, 7).getTime()
const PATH = '.claude/brainstorms/2026-11-09-lanterns.md'

/** The ports of one click: the input it writes, the words it queues (a queue that can be made to fail), and its log. */
function ports({ failQueue = null } = {}) {
  const made = { written: [], queued: [], logged: [] }
  return {
    made,
    ledger: clickLedger(),
    now: () => AT,
    write: async () => {
      made.written.push('input')
      return { ok: true, result: { path: PATH, n: 1 } }
    },
    sayBody: result => ({ to: 'Advisor', command: 'brainstorm-answer', thread: result.path, n: result.n }),
    say: async body => {
      if (failQueue !== null) throw new Error(failQueue)
      made.queued.push(body)
      return { ok: true, message: { id: `word-${made.queued.length}`, ...body } }
    },
    log: async entry => { made.logged.push(entry) },
  }
}
const click = (p, id = 'click-0001', more = {}) => oneClick({ ledger: p.ledger, click: id, via: 'brainstorm-answer', action: 'answer', key: PATH, route: '/api/brainstorm', now: p.now, write: p.write, sayBody: p.sayBody, say: p.say, log: p.log, ...more })

test('a click stores its input and queues exactly one word, and says its id', async () => {
  const p = ports()
  const done = await click(p)
  assert.equal(done.ok, true)
  assert.deepEqual(p.made.written, ['input'])
  assert.deepEqual(p.made.queued, [{ to: 'Advisor', command: 'brainstorm-answer', thread: PATH, n: 1 }])
  assert.equal(done.result.said, 'word-1')
  assert.equal(done.result.click, 'click-0001')
  assert.equal(done.result.path, PATH)
  assert.equal(done.result.notSent, undefined)
})

test('the same click id twice gives one input and one word: the second answers the first result', async () => {
  const p = ports()
  const first = await click(p)
  const again = await click(p)
  assert.deepEqual(p.made.written, ['input'])
  assert.equal(p.made.queued.length, 1)
  assert.equal(again.result.said, first.result.said)
  assert.equal(again.result.again, true)
  assert.equal(p.made.logged.length, 1, 'one log line for the click')
  // A double click that arrives while the first still runs waits for it.
  const q = ports()
  const [a, b] = await Promise.all([click(q, 'click-0002'), click(q, 'click-0002')])
  assert.equal(q.made.queued.length, 1)
  assert.equal(a.result.said, b.result.said)
  // Another click id is another click.
  await click(p, 'click-0003')
  assert.equal(p.made.queued.length, 2)
})

test('a failed queue keeps the input and stores "not sent: <why>, HH:MM"; the record is what the cards draw their Retry from', async () => {
  const p = ports({ failQueue: 'the outbox is locked' })
  const done = await click(p)
  assert.equal(done.ok, true, 'the input stands: the click is no refusal')
  assert.deepEqual(p.made.written, ['input'])
  assert.equal(done.result.notSent, 'the outbox is locked')
  assert.equal(done.result.notSentAt, '14:07')
  assert.equal(hhmm(AT), '14:07')
  assert.equal(done.result.said, undefined)
  assert.deepEqual(await p.ledger.unsent(), [{ click: 'click-0001', via: 'brainstorm-answer', key: PATH, route: '/api/brainstorm', why: 'the outbox is locked', at: '14:07' }])
  // A refused queue (a chat on the board that does not take it) says its reason the same way.
  const q = ports()
  q.say = async () => ({ ok: false, status: 409, why: 'That is not the answer the brainstorm waits for.' })
  const refused = await click(q)
  assert.equal(refused.result.notSent, 'That is not the answer the brainstorm waits for.')
  // And no word to type (the ask has no id): nothing is queued, the input stands.
  const none = ports()
  none.sayBody = () => null
  assert.equal((await click(none)).result.notSent, 'there is no word for it')
})

test('a write the board refuses records nothing: the same click id is free for another try', async () => {
  const p = ports()
  p.write = async () => ({ ok: false, status: 409, why: 'The brainstorm is over.' })
  const done = await click(p)
  assert.deepEqual([done.ok, done.status, done.why], [false, 409, 'The brainstorm is over.'])
  assert.equal(p.made.queued.length, 0)
  assert.equal(await p.ledger.get('click-0001'), null)
  assert.equal(p.made.logged.length, 0)
})

test('the retry of a "not sent" click reuses its id: the word is queued once, the input is not written again', async () => {
  const p = ports({ failQueue: 'the outbox is locked' })
  await click(p)
  // The queue works again; the card's Retry sends the click id only.
  let failing = true
  p.say = async body => {
    if (failing) throw new Error('the outbox is locked')
    p.made.queued.push(body)
    return { ok: true, message: { id: 'word-late', ...body } }
  }
  const again = await retryClick({ ledger: p.ledger, click: 'click-0001', now: p.now, say: p.say, log: p.log })
  assert.equal(again.result.notSent, 'the outbox is locked', 'still not sent: the record stands')
  failing = false
  const retried = await retryClick({ ledger: p.ledger, click: 'click-0001', now: p.now, say: p.say, log: p.log })
  assert.equal(retried.result.said, 'word-late')
  assert.equal(retried.result.path, PATH, 'the first write\'s result comes back')
  assert.deepEqual(p.made.written, ['input'], 'the input was written once')
  assert.equal(p.made.queued.length, 1)
  assert.deepEqual(await p.ledger.unsent(), [])
  // The page's own call again with the same id (its answer never came): the same retry, the input is not written a second time.
  const q = ports({ failQueue: 'the outbox is locked' })
  await click(q, 'click-0010')
  q.say = async body => {
    q.made.queued.push(body)
    return { ok: true, message: { id: 'word-again', ...body } }
  }
  const resent = await click(q, 'click-0010')
  assert.equal(resent.result.said, 'word-again')
  assert.deepEqual(q.made.written, ['input'], 'a second call with the same id wrote no second input')
  assert.equal(q.made.queued.length, 1)
  // The same id once more: the first result, no second word.
  await retryClick({ ledger: p.ledger, click: 'click-0001', now: p.now, say: p.say, log: p.log })
  assert.equal(p.made.queued.length, 1)
  assert.equal((await retryClick({ ledger: p.ledger, click: 'never-seen', now: p.now, say: p.say })).status, 404)
  assert.equal(p.made.logged.length, 1, 'one log line for the click, retries included')
})

test('one line per click in the actions log with its own via, never pause-all or resume-all', async () => {
  const p = ports()
  await click(p)
  assert.deepEqual(p.made.logged, [{ via: 'brainstorm-answer', action: 'answer', id: PATH, click: 'click-0001' }])
  for (const via of NEVER_VIA) assert.throws(() => click(ports(), 'click-0009', { via }), /never logs as/)
  // The line on disk: the click id beside via and action.
  const dir = await mkdtemp(join(tmpdir(), 'clicks-'))
  try {
    const file = join(dir, 'actions.jsonl')
    await keepPersonAction(file, { via: 'talk-send', action: 'answer', id: PATH, click: 'click-0001' }, AT)
    await keepPersonAction(file, { via: 'work', action: 'answer', id: 'Q1' }, AT)
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(lines, [{ at: AT, by: 'person', via: 'talk-send', action: 'answer', id: PATH, click: 'click-0001' }, { at: AT, by: 'person', via: 'work', action: 'answer', id: 'Q1' }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('interventionsOf counts a click once, by its click id: a retry is the same hand', () => {
  const day = '2026-11-09'
  const at = new Date(2026, 10, 9, 10, 0).getTime()
  // A resume-all with no pause of the person's before it is an intervention; its retry logged again with the same id is not a second.
  const lines = [{ at, by: 'person', via: 'say', action: 'resume-all', click: 'click-7000' }, { at: at + 5000, by: 'person', via: 'say', action: 'resume-all', click: 'click-7000' }]
  const found = interventionsOf({ actions: lines, day })
  assert.equal(found.interventions.filter(one => one.kind === 'resume-all').length, 1)
  // Lines of the page's clicks (a brainstorm answer) are no intervention at all.
  const clicks = [{ at, by: 'person', via: 'brainstorm-answer', action: 'answer', id: PATH, click: 'click-0001' }]
  assert.deepEqual(interventionsOf({ actions: clicks, day }).interventions, [])
})

test('the ledger keeps its records in a file, merged by click id, and reads them back; a torn line is skipped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clicks-'))
  try {
    const file = join(dir, 'clicks.jsonl')
    const first = clickLedger({ file })
    await oneClick({ ledger: first, click: 'click-1111', via: 'brainstorm-wrap', key: PATH, route: '/api/brainstorm', now: () => AT, write: async () => ({ ok: true, result: { path: PATH } }), sayBody: () => ({ command: 'brainstorm-wrap' }), say: async () => { throw new Error('locked') } })
    await first.put({ ...(await first.get('click-1111')), word: 'word-9', notSent: undefined })
    const reopened = clickLedger({ file: join(dir, 'clicks.jsonl') })
    assert.equal((await reopened.get('click-1111')).word, 'word-9', 'the last line of a click wins')
    assert.deepEqual(await reopened.unsent(), [])
    await (await import('node:fs/promises')).appendFile(file, '{"click":"torn')
    assert.equal((await clickLedger({ file }).get('click-1111')).word, 'word-9')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('click ids: eight to 64 letters, digits, - and _; anything else is no id', () => {
  assert.equal(clickIdOf({}), null)
  assert.equal(clickIdOf({ click: '123e4567-e89b-12d3-a456-426614174000' }), '123e4567-e89b-12d3-a456-426614174000')
  for (const bad of ['short', 'has space here', 'x'.repeat(65), 7, '../etc/passwd']) assert.equal(clickIdOf({ click: bad }), false, String(bad))
})

test('every brainstorm click names its word, its via and its card; the commands that send nothing are no click', () => {
  const to = 'Advisor'
  const word = (body, result = {}) => brainstormClickOf(body).word(result, to)
  assert.deepEqual(word({ command: 'answer', path: PATH, n: 2, key: 'A' }), { to, command: 'brainstorm-answer', thread: PATH, n: 2 })
  assert.deepEqual(word({ command: 'skip', path: PATH, n: 2 }), { to, command: 'brainstorm-answer', thread: PATH, n: 2 })
  assert.deepEqual(word({ command: 'back', path: PATH, n: 2, to: 1 }), { to, command: 'brainstorm-answer', thread: PATH, n: 2 })
  assert.deepEqual(word({ command: 'wrap', path: PATH }), { to, command: 'brainstorm-wrap', thread: PATH })
  assert.deepEqual(word({ command: 'understood', path: PATH, yes: true }), { to, command: 'brainstorm-understood', thread: PATH })
  assert.deepEqual(word({ command: 'understood', path: PATH, words: 'the gate too' }), { to, command: 'brainstorm-not-quite', thread: PATH })
  assert.deepEqual(word({ command: 'start', title: 'T', opening: 'O' }, { path: PATH }), { to, command: 'brainstorm', thread: PATH })
  assert.deepEqual(word({ command: 'change', path: PATH, text: 'add the pond' }), { to, command: 'brainstorm-change', thread: PATH, text: 'add the pond' })
  assert.deepEqual(word({ command: 'again', path: PATH, word: { command: 'brainstorm-answer', n: 1 } }), { to, command: 'brainstorm-answer', thread: PATH, n: 1 })
  assert.deepEqual(brainstormClickOf({ command: 'answer', path: PATH, n: 1, via: 'talk-send' }).via, 'talk-send')
  assert.deepEqual(['answer', 'wrap', 'understood', 'start', 'change', 'again'].map(command => brainstormClickOf({ command, path: PATH, yes: true, kind: command === 'start' ? 'change' : undefined, word: { command: 'brainstorm' } }).via), ['brainstorm-answer', 'brainstorm-wrap', 'brainstorm-understood', 'change-goal-start', 'brainstorm-change', 'brainstorm-again'])
  assert.equal(brainstormClickOf({ command: 'discard', path: PATH }), null)
  assert.equal(brainstormClickOf({ command: 'create', path: PATH }), null)
  assert.equal(brainstormClickOf({ command: 'again', path: PATH, word: { command: 'stop' } }), null, 'only a brainstorm word is typed again')
})
