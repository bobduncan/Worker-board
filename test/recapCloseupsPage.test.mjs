// T17.2, the popup's side (the person, 2026-11-04, looking at G60's recap row 7: "i expect that when i promide feedback i get new tailored demo on
// the aspects i asked for.. e.g. a picture of a tall prop that is transparent like i asked for in this case."): a row they sent back whose new try
// is in draws "Your words, up close" first (close-ups before and now, clips that loop), who checked it, and every other picture under "Earlier
// pictures", closed. A row they did not send back draws as before. Made-up garden names only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { demoPage } from '../src/demo.mjs'
import { roundPage, withRound } from '../src/demoFeedback.mjs'
import { sinceMs } from '../src/work/item.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const css = readFileSync(new URL('../public/board.css', import.meta.url), 'utf8')
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const classesOf = node => [...node.children].map(child => child.className.split(' ')[0])
const PATH = 'pictures/g6/recap/demo.json'
const AT = '2026-11-04 10:00'
const SENT_MS = sinceMs(AT)
const MIN = 60_000
const YES = { verdict: 'yes', by: 'Checker', at: '2026-11-04 10:20', why: 'the crystal fades while the wizard stands behind it' }
const CLOSE = { kind: 'closeup', caption: 'The crystal behind the wizard', path: 'after.png', before: 'before.png', box: [120, 64, 48, 40] }
const CLIP = { kind: 'clip', caption: 'The crystal fades', frames: ['f1.png', 'f2.png', 'f3.png'], box: [120, 64, 48, 40], ms: 600 }
const SHOT = { kind: 'final', caption: 'in the game', path: 'whole.png' }
const TARGET = { kind: 'target', caption: 'target', path: 't.png' }

const list = (props = {}) => ({
  goal: 'G6', title: 'The polish', step: 'B7',
  sections: [{ kind: 'open', rows: [
    { title: '1. Lava', note: 'Lava note', pictures: [SHOT, CLOSE] },
    { title: '7. Tall props', note: 'Props note', changed: 'tall props -> they fade for a unit behind them', shows: YES, pictures: [SHOT, TARGET, CLOSE, CLIP], ...props },
  ] }],
})
/** Round 1 at 10:00: Tall props sent back; Lava not decided (it was never sent back: it keeps its pictures as they are). */
const round1 = () => withRound(null, 1, [{ key: '7. Tall props', verdict: 'sent-back', comment: 'tall props fade while a unit stands behind them' }], AT)
const shown = (props, changedAt = SENT_MS + 90 * MIN) => {
  const page = roundPage(demoPage(list(props), 'pictures/g6/recap'), round1(), { changedAt })
  return { ...page, feedback: { ...page.feedback, canSend: page.feedback.making === null && page.feedback.answerable > 0, whyNot: null } }
}
/** What the board answers to a picture: its bytes, so the page makes its image and its crop. */
const bytes = { ok: true, status: 200, blob: async () => new Blob(['x']), json: async () => ({}), text: async () => '' }
const opened = async (give, options = {}) => {
  const page = await openPage({ state: asSent(build([], undefined)), hash: options.hash ?? `demo=${PATH}`, now: options.now ?? null, answers: request => (request.url.startsWith('/api/demo?') ? reply(give) : request.url.startsWith('/api/picture?') ? bytes : reply({})) })
  await settle(10)
  return page
}
/** A link to the recap as the recap card draws it: a click on it opens (and redraws) the popup in place. */
const openAgain = async page => {
  let link = page.document.getElementById('test-demo-link')
  if (link === null) {
    link = page.document.createElement('a')
    link.id = 'test-demo-link'
    link.dataset.demo = PATH
    page.document.body.append(link)
  }
  await page.click('#test-demo-link')
  await settle(10)
}
/** The page's own setInterval, watched: the timers still running (started and not cleared). */
function watchTimers(page) {
  const active = new Set()
  const start = page.window.setInterval
  const stop = page.window.clearInterval
  page.window.setInterval = (run, ms) => { const id = start(run, ms); active.add(id); return id }
  page.window.clearInterval = id => { active.delete(id); stop(id) }
  return active
}
const reduceMotion = page => {
  page.window.matchMedia = query => ({ matches: /prefers-reduced-motion:\s*reduce/.test(query), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
}

test('a row sent back whose new try is in draws "Your words, up close" first, who checked it, and the other pictures in a closed "Earlier pictures (N)"', async () => {
  const page = await opened(shown())
  try {
    const [lava, props] = page.all('.demo-row')
    assert.deepEqual(classesOf(props), ['demo-row-title', 'demo-row-note', 'demo-said', 'demo-changed', 'demo-upclose', 'demo-feedback'], 'right under "What changed": the block, then the buttons')
    const block = props.querySelector('.demo-upclose')
    assert.deepEqual(classesOf(block), ['demo-upclose-title', 'demo-closeup', 'demo-clip', 'demo-checked', 'demo-earlier'])
    assert.equal(words(block.querySelector('.demo-upclose-title')), 'Your words, up close')
    assert.equal(words(block.querySelector('.demo-checked')), 'Checked by Checker: the crystal fades while the wizard stands behind it')
    // The close-up: the spot before their words and now, side by side, each with its words; a click on a side opens that whole picture.
    const sides = [...block.querySelectorAll('.demo-closeup-side')]
    assert.deepEqual(sides.map(side => words(side.querySelector('figcaption'))), ['Before your words', 'Now'])
    assert.deepEqual(sides.map(side => side.querySelector('.picture.demo-crop').dataset.zoom), ['pictures/g6/recap/before.png', 'pictures/g6/recap/after.png'])
    assert.equal(words(block.querySelector('.demo-closeup-caption')), 'The crystal behind the wizard')
    // Everything else, the old whole-screen shots first, is folded away, closed.
    const earlier = block.querySelector('details.demo-earlier')
    assert.equal(earlier.open, false)
    assert.equal(words(earlier.querySelector('summary')), 'Earlier pictures (2)')
    assert.deepEqual([...earlier.querySelectorAll('.picture.demo-picture')].map(one => one.dataset.zoom), ['pictures/g6/recap/t.png', 'pictures/g6/recap/whole.png'])
    assert.equal(props.querySelectorAll('.demo-upclose > .demo-pictures').length, 0)
    // A row they did not send back draws as before: its pictures in order, the close-up as a plain picture of its after picture.
    assert.deepEqual(classesOf(lava), ['demo-row-title', 'demo-row-note', 'demo-pictures', 'demo-feedback'])
    assert.deepEqual([...lava.querySelectorAll('.demo-kind')].map(words), ['YOUR WORDS, UP CLOSE', 'FINAL, IN THE GAME'])
    assert.equal(lava.querySelectorAll('.demo-crop, details').length, 0)
  } finally { await page.close() }
})

test('a row sent back with only close-ups has no folded pictures to count: no "Earlier pictures"; one still being reworked says why and draws no picture', async () => {
  const only = await opened(shown({ pictures: [CLOSE] }))
  try {
    assert.equal(only.all('.demo-earlier').length, 0)
    assert.equal(only.all('.demo-upclose .demo-closeup').length, 1)
  } finally { await only.close() }
  const waiting = await opened(shown({ shows: undefined }))
  try {
    const props = waiting.all('.demo-row').find(one => one.dataset.demoRow === '7. Tall props')
    assert.deepEqual(classesOf(props), ['demo-row-title', 'demo-said', 'demo-reworking'])
    assert.equal(words(props.querySelector('.demo-reworking')), 'Being reworked: the close-up of your words waits for its check')
  } finally { await waiting.close() }
  const no = await opened(shown({ shows: { ...YES, verdict: 'no', why: 'it shows the whole screen' } }))
  try {
    assert.equal(words(no.find('.demo-reworking')), 'Being reworked: the check says it does not show your words yet: it shows the whole screen')
    assert.equal(no.all('.demo-upclose').length, 0)
  } finally { await no.close() }
})

test('a crop scales its box up to the frame, crisp: the picture is as wide as the whole is of the box, moved by the box\'s corner', async () => {
  const page = await opened(shown())
  try {
    // The "Now" side of the close-up: the box [120, 64, 48, 40] of after.png.
    const frame = page.find('.demo-closeup-side.is-after .picture.demo-crop')
    const image = frame.querySelector('img')
    assert.equal(frame.style.aspectRatio, '48 / 40')
    assert.equal(frame.dataset.zoom, 'pictures/g6/recap/after.png', 'a click opens the whole picture')
    assert.equal(frame.classList.contains('is-sized'), false, 'not before the picture is there')
    Object.defineProperty(image, 'naturalWidth', { value: 480 })
    image.dispatchEvent(new page.window.Event('load'))
    assert.deepEqual([image.style.width, image.style.left, image.style.top, frame.classList.contains('is-sized')], ['1000%', '-250%', '-160%', true])
    // A clip with no box (it may have none) is its whole frame, no crop.
    const bare = await opened(shown({ pictures: [{ kind: 'clip', frames: ['a.png', 'b.png'] }] }))
    try {
      assert.equal(bare.all('.demo-clip .demo-crop').length, 0)
      assert.equal(bare.all('.demo-clip-stack > .picture.demo-picture').length, 2)
    } finally { await bare.close() }
    const rule = css.match(/^\.picture\.demo-crop img \{([^}]*)\}/m)?.[1] ?? ''
    assert.match(rule, /image-rendering:\s*pixelated/)
  } finally { await page.close() }
})

test('a clip shows one frame at a time, loops every ms with "1 / N" under it, and a click opens the frame shown', async () => {
  const page = await opened(shown(), { now: Date.now() })
  try {
    const clip = page.find('.demo-clip')
    const on = () => [...clip.querySelectorAll('.demo-clip-stack > .picture')].filter(one => one.classList.contains('is-on')).map(one => one.dataset.zoom)
    assert.equal(clip.querySelectorAll('.demo-clip-stack > .picture').length, 3)
    assert.deepEqual([words(clip.querySelector('.demo-clip-count')), on()], ['1 / 3', ['pictures/g6/recap/f1.png']])
    page.advance(599)
    assert.equal(words(clip.querySelector('.demo-clip-count')), '1 / 3', 'not before the pace')
    page.advance(1)
    assert.deepEqual([words(clip.querySelector('.demo-clip-count')), on()], ['2 / 3', ['pictures/g6/recap/f2.png']])
    page.advance(600)
    assert.deepEqual([words(clip.querySelector('.demo-clip-count')), on()], ['3 / 3', ['pictures/g6/recap/f3.png']])
    page.advance(600)
    assert.deepEqual([words(clip.querySelector('.demo-clip-count')), on()], ['1 / 3', ['pictures/g6/recap/f1.png']], 'it loops')
    // A click on the frame shown is a click on a picture: the picture window opens that frame.
    page.advance(600)
    await page.click('.demo-clip-stack > .picture.is-on')
    assert.ok(page.requests.some(one => one.url === '/api/picture?path=pictures%2Fg6%2Frecap%2Ff2.png'), 'the frame shown, at its own size')
  } finally { await page.close() }
})

test('a clip\'s timer stops on every redraw and when the popup closes: never more than one running, none left behind', async () => {
  const page = await opened(shown(), { hash: '', now: Date.now() })
  try {
    const active = watchTimers(page)
    await openAgain(page)
    assert.equal(active.size, 1, 'one clip, one timer')
    await openAgain(page)
    await openAgain(page)
    assert.equal(active.size, 1, 'a redraw cleared the old timer before it made its own')
    // The old clip is gone from the page and its timer with it: the one on the page still turns.
    assert.equal(page.all('.demo-clip').length, 1)
    page.advance(600)
    assert.equal(words(page.find('.demo-clip-count')), '2 / 3')
    await page.click('[data-close-demo]')
    assert.equal(active.size, 0, 'closing the popup clears it')
    const before = words(page.find('.demo-clip-count'))
    page.advance(5_000)
    assert.equal(words(page.find('.demo-clip-count')), before, 'nothing moves after the popup is closed')
  } finally { await page.close() }
})

test('with reduced motion a clip\'s frames stand side by side, each numbered, and nothing moves', async () => {
  const page = await opened(shown(), { hash: '', now: Date.now() })
  try {
    reduceMotion(page)
    const active = watchTimers(page)
    await openAgain(page)
    const clip = page.find('.demo-clip')
    assert.equal(clip.classList.contains('is-still'), true)
    const frames = [...clip.querySelectorAll('.demo-clip-still')]
    assert.deepEqual(frames.map(one => [one.querySelector('.picture').dataset.zoom, words(one.querySelector('figcaption'))]), [
      ['pictures/g6/recap/f1.png', '1 / 3'], ['pictures/g6/recap/f2.png', '2 / 3'], ['pictures/g6/recap/f3.png', '3 / 3'],
    ])
    assert.equal(clip.querySelectorAll('.demo-clip-stack, .demo-clip-count').length, 0)
    assert.equal(active.size, 0, 'no timer at all')
    page.advance(5_000)
    assert.equal(clip.querySelectorAll('.demo-clip-still').length, 3)
  } finally { await page.close() }
})

test('amber is for what asks the person: the close-up block uses none of it', () => {
  const blocks = [...css.matchAll(/^([^{}\n]*(?:demo-upclose|demo-closeup|demo-crop|demo-clip|demo-checked|demo-earlier)[^{}\n]*)\{([^}]*)\}/gm)]
  assert.ok(blocks.length >= 8, 'the styles are there')
  for (const [, selector, body] of blocks) assert.doesNotMatch(body, /--attn|--waiting|#e3a52b|#c99a2e|#f4c35a|#1d1a10|#f0b53a/i, selector)
})
