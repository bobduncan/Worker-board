// T20, the page's side (the person, 2026-11-02, with a screenshot of a 47-hour-old "Open the recap and try it" card: "if autopilot is
// turned on, the outstanding, needing for attentions get reevaluated and possible resolved if autopilot would answer them. I also
// miss that the product owner should give me a ping that the current goal needs to be evaluated. there should be no close/done
// button for that just a link"; the mock autopilot-attention/mock.png, "Yes, both"): in Needs your attention the Product owner's
// recap card (while verdicts wait: the goal's words, one link, no close) and under it the dashed "Autopilot cleared n" line with
// its Undo (the board's `autopilotCleared`, and the work action `autopilot-undo`). Made-up garden project.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'

const script = readFileSync(new URL('../public/board.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../public/board.css', import.meta.url), 'utf8')
const HOUR = 60 * MIN
const PATH = 'pictures/g6/recap/demo.json'
const ON = { ...parseConfig('{"autopilot":true}', {}), project: 'C:\\garden' }
const words = node => node.textContent.replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------------------------------------------------------------
// The pure views, as the page runs them (the marked region of board.js, with the page's own cutWords).

const cutLine = script.split('\n').find(line => line.startsWith('const cutWords = '))
assert.ok(cutLine, 'the page has its cutWords')
const views = vm.runInNewContext(`const HOUR = ${HOUR}\n${cutLine}\n${script.slice(script.indexOf('// recapready:start'), script.indexOf('// recapready:end'))}
;({ recapAttentionView, clearedLineView, CLEARED_SHOWN_MS })`, {})
const plain = value => JSON.parse(JSON.stringify(value))
const { recapAttentionView, clearedLineView } = views

const card = (more = {}) => ({ goal: 'G60', open: { path: PATH }, count: 3, isBuilt: true, tiles: [], outside: [], ...more })

test('the card\'s view: null while no verdict waits; else the goal\'s words, the recap card\'s own line, and one link that opens the recap', () => {
  for (const none of [null, undefined, card({ count: 0 }), {}]) assert.equal(recapAttentionView(none, { id: 'G60', title: 'How we build good maps' }), null)
  assert.deepEqual(plain(recapAttentionView(card(), { id: 'G60', title: 'How we build good maps' })), {
    goal: 'G60', count: 3, heading: 'G60 · How we build good maps: your recap is ready · 3 verdicts wait',
    line: 'Everything is built. Judge each part: approve it, or send it back with a note.', open: { label: 'Open the recap →', target: { path: PATH } },
  })
  assert.equal(recapAttentionView(card({ count: 1 }), { id: 'G60', title: 'Maps' }).heading, 'G60 · Maps: your recap is ready · 1 verdict waits')
  assert.equal(recapAttentionView(card({ isBuilt: false }), { id: 'G60', title: 'Maps' }).line, 'Judge what is ready: approve it, or send it back with a note.')
  // Without a title, or with another goal's title, only the id; without both, the recap card's own words.
  assert.equal(recapAttentionView(card(), { id: 'G60', title: ' ' }).heading, 'G60: your recap is ready · 3 verdicts wait')
  assert.equal(recapAttentionView(card(), { id: 'G7', title: 'Not this goal' }).heading, 'G60: your recap is ready · 3 verdicts wait')
  assert.equal(recapAttentionView(card({ goal: null }), null).heading, 'Your recap is ready · 3 verdicts wait')
  // A step or an ask opens as the Focus page's card does; nowhere to open: no link (never a dead arrow).
  assert.deepEqual(plain(recapAttentionView(card({ open: { step: 'B2' } }), null).open), { label: 'Open the recap →', target: { step: 'B2' } })
  assert.equal(recapAttentionView(card({ open: null }), null).open, null)
})

test('the line\'s view: hidden when empty, undone, older than 24 hours or without a time; its words cut short, three named, the rest counted', () => {
  const item = (id, title, how, why) => ({ id, title, how, why })
  const cleared = (items, more = {}) => ({ at: NOW - 2 * HOUR, items, undoneAt: null, ...more })
  const two = [item('Q569', 'Open the recap and try it', 'closed', "it's live now"), item('Q578', 'Is 68 good enough', 'recap', 'moved into your recap')]
  assert.deepEqual(plain(clearedLineView(cleared(two), NOW)).words, '✓ Autopilot cleared 2: "Open the recap and try it" (obsolete: it\'s live now) · "Is 68 good enough" (moved into your recap)')
  for (const [why, line] of [
    ['none', null], ['not an object', 'x'], ['no items', cleared([])], ['items not a list', cleared('Q1')], ['no time', cleared(two, { at: null })],
    ['undone', cleared(two, { undoneAt: NOW - HOUR })], ['exactly 24 hours old', cleared(two, { at: NOW - 24 * HOUR })], ['older', cleared(two, { at: NOW - 30 * HOUR })],
  ]) assert.equal(clearedLineView(line, NOW), null, why)
  assert.equal(clearedLineView(cleared(two, { at: NOW - 24 * HOUR + MIN }), NOW).count, 2, 'a minute inside the day still shows')
  assert.equal(clearedLineView(cleared(two, { undoneAt: undefined }), NOW).count, 2, 'a board that sends no undoneAt: not undone')
  // Cut at 40 characters, each of the title and the why, at a word edge, with an ellipsis; "obsolete: " said once.
  const long = clearedLineView(cleared([item('Q1', 'Is the second block of the garden good enough to approve as it is now', 'closed', 'obsolete: the garden block was rebuilt and approved already at 70')]), NOW)
  const [, title, why] = /: "(.*)" \((.*)\)$/.exec(long.words)
  assert.ok(title.length <= 41 && title.endsWith('…'), title)
  assert.ok(why.startsWith('obsolete: ') && !why.startsWith('obsolete: obsolete') && why.length <= 'obsolete: '.length + 41 && why.endsWith('…'), why)
  // The first three are named; the rest are counted, and all stay in the tooltip.
  const five = Array.from({ length: 5 }, (_, at) => item(`Q${at + 1}`, `Ask ${at + 1}`, 'recap', ''))
  const many = clearedLineView(cleared(five), NOW)
  assert.equal(many.words, '✓ Autopilot cleared 5: "Ask 1" (moved into your recap) · "Ask 2" (moved into your recap) · "Ask 3" (moved into your recap) · and 2 more')
  assert.equal(many.title.split('\n').length, 5)
  assert.match(many.title, /^Q1 Ask 1 \(moved into your recap\)\nQ2 /)
  // A closed item whose why is empty still says why; an item without a title names its id.
  assert.equal(clearedLineView(cleared([item('Q9', '', 'closed', '')]), NOW).words, '✓ Autopilot cleared 1: "Q9" (obsolete)')
})

// ---------------------------------------------------------------------------------------------------------------------
// The page

/** The garden goal with `count` work blocks, each one task (B1, B2, ...), in its run. */
const goals = count => ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: you walk it at night', '    Goal definition: calm',
  '    Goal definition agreed: 2026-10-18 10:00', ...Array.from({ length: count }, (_, at) => `    Part: Block ${at + 1} · about 1 h · steps B${at + 1} · done when: line ${at + 1}`), '    How agreed: 2026-10-18 11:00', ''].join('\n')
const task = n => parseItem(`Id: B${n}\nKind: step\nTitle: Task B${n}\nState: review\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n\n## Context\n  Recap verdict: waits (Q${n})\n`)
const askFor = n => parseItem(`Id: Q${n}\nKind: ask\nTitle: Approve block ${n} at 64 of 75?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 40 * MIN)}\nFiled: ${NOW - 40 * MIN}\nAsks: look\nBlocking: no\nOf: B${n}\nRoute: recap\n`)
/** A plain open question of the person (a Do), to stand beside the card. */
const plainAsk = parseItem(`Id: Q40\nKind: ask\nTitle: Mark B851 done on the board\nState: open\nOwner: Main\nSince: ${sinceOf(NOW - 47 * HOUR)}\nFiled: ${NOW - 47 * HOUR}\nAsks: do\nBlocking: no\n`)
const recap = count => ({ path: PATH, goal: 'G6', parts: Array.from({ length: count }, (_, at) => ({ key: `Block ${at + 1}`, title: `Block ${at + 1}`, steps: [`B${at + 1}`] })), rounds: [], changedAt: null })
/** The state the board sends while `count` blocks wait in the recap (their tasks in review, their asks routed to it; Autopilot on). */
const waiting = (count, extra = []) => asSent(build(
  [...Array.from({ length: count }, (_, at) => task(at + 1)), ...Array.from({ length: count }, (_, at) => askFor(at + 1)), ...extra],
  undefined, goals(count), { recaps: [recap(count)], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON },
))
/** The state while nothing waits for a verdict (no recap card), one plain question open. */
const quiet = () => asSent(build([plainAsk], undefined, goals(1), { recaps: [], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON }))
const CLEARED = { at: NOW - 2 * HOUR, items: [{ id: 'Q569', title: 'Open the recap and try it', how: 'closed', why: "it's live now" }, { id: 'Q578', title: 'Is 68 good enough', how: 'recap', why: 'moved into your recap' }], undoneAt: null }

test('the card: first in Needs your attention, as the mock has it: Product owner, "Your recap", the goal\'s words, the line and one link; it counts as one', async () => {
  const state = waiting(3, [plainAsk])
  assert.equal(state.recapCard.count, 3)
  const page = await openPage({ state })
  try {
    const cards = page.all('#needs > article')
    assert.equal(cards[0], page.find('#needs .is-recap-ready'), 'the first card')
    assert.equal(page.all('#needs .is-recap-ready').length, 1)
    assert.equal(page.text('#needs .is-recap-ready .need-top'), '★Product ownerYour recap')
    assert.equal(page.text('#needs .is-recap-ready h4'), 'G6 · Garden: your recap is ready · 3 verdicts wait')
    assert.equal(page.text('#needs .is-recap-ready p'), 'Everything is built. Judge each part: approve it, or send it back with a note.')
    const open = page.find('#needs .is-recap-ready .recap-attention-open')
    assert.deepEqual([open.tagName, open.textContent, open.dataset.demo, open.getAttribute('href')], ['A', 'Open the recap →', PATH, `#demo=${encodeURIComponent(PATH)}`])
    // No Done, no close, no tick, no answer form: the card holds one link and nothing to press.
    assert.equal(page.all('#needs .is-recap-ready button, #needs .is-recap-ready input, #needs .is-recap-ready textarea').length, 0)
    assert.equal(page.all('#needs .is-recap-ready a').length, 1)
    // The count: the card and the plain question (the recap's own asks wait in the recap, not as cards).
    assert.equal(page.text('#needs-count'), String(1 + page.all('#needs .need:not(.is-recap-ready)').filter(one => !one.classList.contains('is-answered')).length))
    assert.ok(page.all('#needs .need').some(one => one.textContent.includes('Mark B851 done on the board')))
    assert.equal(page.all('#needs .empty').length, 0, '"Nothing waits for you" is not said while the card shows')
  } finally { await page.close() }
})

test('the card: its link opens the recap in place, as the Focus page\'s card does', async () => {
  const demo = { goal: 'G6', title: 'Garden', intro: 'x', step: null, followUp: null, sections: [{ kind: 'reached', band: 'REACHED', verdict: 'Reached', intro: [], items: [], rows: [1, 2, 3].map(n => ({ key: `Block ${n}`, steps: [`B${n}`], title: `Block ${n}`, note: '', pictures: [] })) }] }
  const page = await openPage({ state: waiting(3), answers: request => (request.url.startsWith('/api/demo?') ? reply(demo) : reply({})) })
  try {
    await page.click('#needs .recap-attention-open')
    await settle(10)
    assert.deepEqual(page.requests.filter(one => one.url.startsWith('/api/demo?')).map(one => one.url), [`/api/demo?path=${encodeURIComponent(PATH)}`])
    assert.doesNotMatch(page.window.location.hash, /demo/, 'opened in place: the address names no demo')
    assert.equal(page.all('#needs .is-recap-ready').length, 1, 'the card stays: it leaves only when no verdict waits')
  } finally { await page.close() }
})

test('the card goes by itself: no card while no verdict waits (the plain question alone), and 1 verdict reads "1 verdict waits"', async () => {
  const none = await openPage({ state: quiet() })
  try {
    assert.equal(none.all('#needs .is-recap-ready').length, 0)
    assert.equal(none.text('#needs-count'), '1')
  } finally { await none.close() }
  const one = await openPage({ state: waiting(1) })
  try {
    assert.equal(one.text('#needs .is-recap-ready h4'), 'G6 · Garden: your recap is ready · 1 verdict waits')
    assert.equal(one.text('#needs-count'), '1', 'the card alone')
  } finally { await one.close() }
  // It comes and goes with the state, in the page that is open (the board is read again every few seconds).
  let state = waiting(2)
  const live = await openPage({ state: () => state })
  try {
    assert.equal(live.all('#needs .is-recap-ready').length, 1)
    state = quiet()
    await live.reread()
    assert.equal(live.all('#needs .is-recap-ready').length, 0)
  } finally { await live.close() }
})

test('the line: dashed, under the card, the mock\'s words; Undo posts autopilot-undo and the line is gone once the board says undone', async () => {
  let state = { ...waiting(3, [plainAsk]), autopilotCleared: CLEARED }
  const page = await openPage({ state: requests => (requests.some(one => one.url === '/api/work') ? { ...state, autopilotCleared: { ...CLEARED, undoneAt: NOW + MIN } } : state) })
  try {
    // Autopilot's own quiet line stays on top of the panel; the recap card is the first card, the dashed line right under it.
    const stack = page.all('#needs > *').filter(one => !one.classList.contains('autopilot-line'))
    assert.deepEqual(stack.slice(0, 2).map(one => one.className.split(' ')[0]), ['need', 'autopilot-cleared'], 'right under the recap card')
    assert.equal(stack[0].classList.contains('is-recap-ready'), true)
    assert.equal(words(page.find('.autopilot-cleared .autopilot-cleared-words')), '✓ Autopilot cleared 2: "Open the recap and try it" (obsolete: it\'s live now) · "Is 68 good enough" (moved into your recap)')
    assert.equal(page.find('.autopilot-cleared').title, "Q569 Open the recap and try it (obsolete: it's live now)\nQ578 Is 68 good enough (moved into your recap)")
    const undo = page.find('.autopilot-cleared .autopilot-undo')
    assert.deepEqual([undo.tagName, undo.textContent, undo.disabled], ['BUTTON', 'Undo', false])
    assert.equal(page.text('#needs-count'), String(page.all('#needs .need').filter(one => !one.classList.contains('is-answered')).length), 'the line is information: it is never counted')
    await page.click('.autopilot-undo')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'autopilot-undo' }])
    assert.equal(page.all('.autopilot-cleared').length, 0, 'read again: undone, so the line is gone')
    assert.equal(page.all('#needs .is-recap-ready').length, 1, 'the card is untouched by an Undo')
  } finally { await page.close() }
})

test('the line: a press shows at once and cannot be sent twice; a refusal says why under the line and the line stays', async () => {
  const state = { ...waiting(2), autopilotCleared: CLEARED }
  let release = null
  const page = await openPage({ state, answers: request => (request.url === '/api/work' ? new Promise(done => { release = () => done(reply('Undone already.', 409)) }) : reply({})) })
  try {
    page.find('.autopilot-undo').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    assert.deepEqual([page.text('.autopilot-undo'), page.find('.autopilot-undo').disabled], ['Undoing…', true], 'sending: at once, greyed')
    page.find('.autopilot-undo').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    assert.equal(page.sent('/api/work').length, 1, 'a greyed Undo sends nothing more')
    release()
    await settle(10)
    assert.equal(page.text('.autopilot-undo'), 'Undo')
    assert.equal(page.text('.autopilot-cleared .problem'), 'Not sent: Undone already.')
    assert.equal(page.all('.autopilot-cleared').length, 1, 'refused: the line stays')
  } finally { await page.close() }
})

test('the line is hidden: undone, older than a day (by the board\'s own clock), without items, or from a board that sends none; with no card and no question it stands beside "Nothing waits"', async () => {
  const hidden = [
    ['undone', { ...CLEARED, undoneAt: NOW - MIN }],
    ['a day old', { ...CLEARED, at: NOW - 25 * HOUR }],
    ['no items', { ...CLEARED, items: [] }],
    ['null', null],
  ]
  for (const [why, autopilotCleared] of hidden) {
    const page = await openPage({ state: { ...waiting(2), autopilotCleared } })
    try { assert.equal(page.all('.autopilot-cleared').length, 0, why) } finally { await page.close() }
  }
  const absent = await openPage({ state: waiting(2) })
  try { assert.equal(absent.all('.autopilot-cleared').length, 0, 'no field at all') } finally { await absent.close() }
  // Only the line: nothing else waits, the panel still says so.
  const alone = await openPage({ state: { ...asSent(build([], undefined, goals(1), { config: ON })), autopilotCleared: CLEARED } })
  try {
    assert.equal(alone.all('.autopilot-cleared').length, 1)
    assert.equal(alone.text('#needs .empty'), 'Nothing waits for you.')
    assert.equal(alone.all('#needs .is-recap-ready').length, 0)
  } finally { await alone.close() }
})

test('the colours: the card is the attention colour, the line is quiet (dashed, muted, never amber)', () => {
  const rule = selector => css.split('\n').find(line => line.startsWith(`${selector} {`)) ?? ''
  assert.match(rule('.need.is-recap-ready'), /var\(--attn-line\)[^}]*var\(--attn\)[^}]*var\(--attn-bg\)/)
  assert.match(rule('.recap-attention-open'), /background: var\(--attn\)/)
  const line = rule('.autopilot-cleared')
  assert.match(line, /border: 1px dashed var\(--line\)/)
  assert.match(line, /color: var\(--muted\)/)
  assert.doesNotMatch(css.split('\n').filter(one => /^\.autopilot-cleared/.test(one)).join('\n'), /attn|waiting|warn|amber|#e3a52b|#f6b93b|#ff7a59/)
})
