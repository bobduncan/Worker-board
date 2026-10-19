// B402: Send answer never looks stuck. The person, 2026-10-19: "clicking send answer gets stuck, nothing happens":
// the answer was saved, but the window stayed open with its button greyed while the whole board was read again.
// Now the window closes the moment the store has the answer and a toast says it went; while it goes the button shows
// a spinner; on an error the window stays open and says why; an ask answered elsewhere closes its open window.
// Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))

const ask = (id, more = {}) => ({
  id: `work:${id}`, workId: id, from: 'Digger', kind: 'input', asks: 'decide', title: 'Box or yew?', question: 'Box or yew?', text: '',
  at: 1000, options: [], advice: null, pictures: [], play: null, of: 'B1', ofTitle: 'Plant the hedge', blocking: true,
  blocks: [], isForm: false, isRefine: false, canAnswer: true, answer: null, ...more,
})

/**
 * The page's calm parts and its sendCalm in a sandbox: `reply(body)` stands for the store (null: saved, else why
 * not), and `log` records what the page did, in order.
 */
function pageWith(needs, reply) {
  const log = []
  const page = {
    board: { needs }, detailsOf: { need: needs[0].id }, detailsShown: 'drawn', calmFocus: null,
    problems: new Map(), sending: new Set(), calmPicks: new Map(), calmWords: new Map(), log,
    everyNeed: state => state.needs,
    findNeed: id => needs.find(one => one.id === id),
    fail: (id, why) => page.problems.set(id, why),
    drawDetails: () => log.push(`draw:${page.sending.size > 0 ? 'sending' : 'idle'}`),
    closeDetails: () => {
      log.push('close')
      page.detailsOf = null
    },
    showToast: words => log.push(`toast:${words}`),
    read: async () => log.push('read'),
    sendWork: async (body, key, options) => {
      log.push(`send:${body.id}${options?.reread === false ? '' : ':reread'}`)
      page.sending.add(key)
      await Promise.resolve()
      page.sending.delete(key)
      const why = reply(body)
      if (why !== null) page.problems.set(key, `Not sent: ${why}`)
      return why
    },
  }
  vm.runInNewContext(`${cut('calm')}\n${cut('calmsend')}\nthis.run = sendCalm\nthis.view = calmSendView\nthis.toastOf = sentToast\nthis.gone = isAnsweredElsewhere
Object.defineProperty(this, 'calmBusy', { get: () => calmBusy })`, page)
  return page
}

test('sent: the window closes before the board is read again, and a toast names the chat', async () => {
  const page = pageWith([ask('Q1')], () => null)
  page.calmPicks.set('work:Q1', 'B')
  await page.run('work:Q1')
  assert.deepEqual(page.log, ['draw:sending', 'send:Q1', 'close', 'toast:Answer sent to Digger', 'read'])
  assert.equal(page.calmPicks.has('work:Q1'), false, 'what was sent is no longer kept')
})

test('several answers: one toast, closed once all went', async () => {
  const page = pageWith([ask('Q1'), ask('Q2', { at: 2000 })], () => null)
  page.calmPicks.set('work:Q1', 'B')
  page.calmWords.set('work:Q2', 'yew')
  await page.run('work:Q1')
  assert.deepEqual(page.log, ['draw:sending', 'send:Q1', 'send:Q2', 'close', 'toast:2 answers sent to Digger', 'read'])
  assert.equal(page.toastOf([ask('Q1', { from: null })]), 'Answer sent to the board')
})

test('an error: the window stays open, says why, and Send works again', async () => {
  const page = pageWith([ask('Q1')], () => 'the board\'s server does not answer')
  page.calmPicks.set('work:Q1', 'B')
  await page.run('work:Q1')
  assert.deepEqual(page.log, ['draw:sending', 'send:Q1', 'draw:idle', 'read'])
  assert.equal(page.problems.get('work:Q1'), 'Not sent: the board\'s server does not answer')
  assert.equal(page.calmPicks.get('work:Q1'), 'B', 'the answer is kept for another Send')
  assert.equal(page.detailsOf.need, 'work:Q1')
  // The window is drawn with the problem in red and the button free again.
  assert.deepEqual({ ...page.view([ask('Q1')], page.sending) }, { text: 'Send answer', isBusy: false, isDisabled: false })
  assert.match(style, /\.calm-answer \.problem \{[^}]*color: #ff8a8a/)
})

test('answered meanwhile elsewhere: nothing to send any more; the toast counts only what went', async () => {
  const page = pageWith([ask('Q1')], () => 'Q1 is answered already.')
  page.calmPicks.set('work:Q1', 'B')
  await page.run('work:Q1')
  assert.deepEqual(page.log, ['draw:sending', 'send:Q1', 'close', 'read'])
  const two = pageWith([ask('Q1'), ask('Q2', { at: 2000 })], body => (body.id === 'Q1' ? 'Q1 is answered already.' : null))
  two.calmPicks.set('work:Q1', 'B')
  two.calmPicks.set('work:Q2', 'A')
  await two.run('work:Q1')
  assert.deepEqual(two.log, ['draw:sending', 'send:Q1', 'send:Q2', 'close', 'toast:Answer sent to Digger', 'read'])
})

test('while the answers go, no refresh closes the window: a later failure still shows in it', async () => {
  const page = pageWith([ask('Q1'), ask('Q2', { at: 2000 })], body => (body.id === 'Q2' ? 'refused (500)' : null))
  page.calmPicks.set('work:Q1', 'B')
  page.calmPicks.set('work:Q2', 'A')
  const busy = []
  page.sendWork = async body => {
    busy.push(`${body.id}:${page.calmBusy}`)
    if (body.id === 'Q2') page.problems.set('work:Q2', 'Not sent: refused (500)')
    return null
  }
  await page.run('work:Q1')
  assert.deepEqual(busy, ['Q1:true', 'Q2:true'])
  assert.equal(page.calmBusy, false, 'free again after the reply')
  assert.equal(page.detailsOf.need, 'work:Q2', 'the window shows the one that did not go')
  const draw = script.slice(script.indexOf('function drawDetails('), script.indexOf('function closeDetails('))
  assert.ok(draw.includes('!calmBusy && isAnsweredElsewhere('))
})

test('while it sends: a spinner on the button, which is never left greyed after a reply', () => {
  const page = pageWith([ask('Q1')], () => null)
  const group = [ask('Q1')]
  assert.deepEqual({ ...page.view(group, new Set(['work:Q1'])) }, { text: 'Sending…', isBusy: true, isDisabled: true })
  assert.deepEqual({ ...page.view(group, new Set(['work:Q9'])) }, { text: 'Send answer', isBusy: false, isDisabled: false })
  const draw = script.slice(script.indexOf('function drawCalm('), script.indexOf('// calmwindow:end'))
  assert.ok(draw.includes('calmSendView(group, sending, calmSendText(group))'))
  assert.ok(draw.includes("el('span', 'calm-spinner')"))
  assert.match(style, /\.calm-spinner \{[^}]*animation: design-turn/)
})

test('an ask answered elsewhere closes its open calm window on the next refresh', () => {
  const page = pageWith([ask('Q1')], () => null)
  assert.equal(page.gone('work:Q1', ask('Q1')), false, 'still open: the window stays')
  assert.equal(page.gone('work:Q1', ask('Q1', { canAnswer: false, answer: { at: 1, text: 'Yew' } })), true, 'answered in its chat or another tab')
  assert.equal(page.gone('work:Q1', undefined), true, 'gone from the board')
  assert.equal(page.gone(undefined, ask('Q1', { canAnswer: false })), false, 'opened as an answered ask: its window stays')
  const draw = script.slice(script.indexOf('function drawDetails('), script.indexOf('function closeDetails('))
  assert.ok(draw.includes('isAnsweredElsewhere(box.dataset.calmAt'))
})

test('a toast element on the page', async () => {
  const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
  assert.match(html, /id="toast"[^>]*role="status"/)
  assert.ok(script.includes('function showToast('))
})
