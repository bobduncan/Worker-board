// B415 (place 5 of docs/robustness-2026-10.md): the board's page in a DOM, to be clicked by a test. index.html and
// board.js are loaded in happy-dom with a fake `fetch`; a test hands over the state the board would send, clicks, types
// and reads the page and the requests it made. Nothing here matches the page's source text.
// How to write a test with it: test/README-page-tests.md.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Window } from 'happy-dom'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const [html, script] = await Promise.all([readFile(join(PUBLIC, 'index.html'), 'utf8'), readFile(join(PUBLIC, 'board.js'), 'utf8')])
export const TOKEN = 'test-token'

/** A fake answer of the board: JSON for 200, else the words of a refusal. */
export function reply(body, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text }
}

/** Lets the page's promises and zero-second timers run: a click's request, then the redraw after its answer. */
export const settle = (turns = 5) => new Promise(done => {
  let left = turns
  const next = () => (--left <= 0 ? done() : setTimeout(next, 0))
  setTimeout(next, 0)
})

/** The page's `Date` and timers on a clock that only `advance` moves; timers run in the order of their time. */
function fakeClock(window, start) {
  let at = start
  let next = 1
  const timers = new Map()
  const RealDate = window.Date
  window.Date = class extends RealDate {
    constructor(...given) { super(...(given.length === 0 ? [at] : given)) }
    static now() { return at }
  }
  const add = (run, ms, every) => { const id = next++; timers.set(id, { run, due: at + Math.max(0, Number(ms) || 0), every }); return id }
  window.setTimeout = (run, ms) => add(run, ms, null)
  window.setInterval = (run, ms) => add(run, ms, Math.max(1, Number(ms) || 1))
  window.clearTimeout = id => { timers.delete(id) }
  window.clearInterval = window.clearTimeout
  return {
    advance(ms) {
      const end = at + ms
      for (;;) {
        const [id, timer] = [...timers].filter(([, one]) => one.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0] ?? []
        if (timer === undefined) break
        at = Math.max(at, timer.due)
        if (timer.every === null) timers.delete(id)
        else timer.due += timer.every
        timer.run()
      }
      at = end
    },
  }
}

/**
 * Opens the page. `state` is what GET /api/state answers (a function of the requests so far works too);
 * `answers(request)` answers any other request, by default 200 `{}`. A request is `{ url, method, headers, body }` with
 * the body already parsed from JSON. `hash` is the address after #. `now` (a number of milliseconds) gives the page a fake
 * clock: its `Date` reads that time and its timers (`setTimeout`, `setInterval`) run only when `page.advance(ms)` moves the
 * clock on, so a test of a wait, a pause or an age never waits for real.
 * Returns the page's `window` and `document`, the `requests` made, `click`, `change`, `type`, `advance`, `text` and `close`.
 */
export async function openPage({ state, answers = () => reply({}), hash = '', now = null } = {}) {
  const window = new Window({ url: `http://127.0.0.1:4310/${hash === '' ? '' : `#${hash}`}`, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, errorCapture: 'processLevel' } })
  const { document } = window
  document.write(html.replace(/<script[^>]*><\/script>/g, '').replace('{{token}}', TOKEN).replace('{{page}}', 'test'))
  const clock = now === null ? null : fakeClock(window, now)
  const requests = []
  window.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: typeof init.body === 'string' ? JSON.parse(init.body) : (init.body ?? null) }
    requests.push(request)
    if (request.url === '/api/state') return reply(typeof state === 'function' ? state(requests) : state)
    // A request the page gives up on (its AbortController) ends as a fetch does: it rejects with an AbortError.
    const given = Promise.resolve(answers(request))
    if (!init.signal) return given
    return Promise.race([given, new Promise((_done, fail) => {
      const stop = () => fail(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
      if (init.signal.aborted) stop()
      else init.signal.addEventListener('abort', stop, { once: true })
    })])
  }
  // The page's own constants, so a test never copies them (MIN, STATES): read from inside the page after it ran.
  window.eval(`${script}
;globalThis.__pageConstants = { MIN, HOUR, STATES, KINDS }`)
  await settle()
  const page = {
    window,
    document,
    requests,
    /** MIN, HOUR, STATES and KINDS as the page defines them. */
    constants: window.__pageConstants,
    /** The requests to one address, optionally of one `action` in their body. */
    sent: (url, action = null) => requests.filter(one => one.url === url && one.method === 'POST' && (action === null || one.body?.action === action)),
    /** A real click on the first element the selector finds; the page's handlers see it bubble. */
    async click(selector) {
      const node = page.find(selector)
      node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      await settle()
    },
    /** The person ticks or unticks a checkbox. */
    async change(selector, checked) {
      const node = page.find(selector)
      node.checked = checked
      node.dispatchEvent(new window.Event('change', { bubbles: true }))
      await settle()
    },
    /** The person types into a field: its value, then the `input` event the page listens to. */
    async type(selector, text) {
      const node = page.find(selector)
      node.value = text
      node.dispatchEvent(new window.Event('input', { bubbles: true }))
      await settle()
    },
    /** Moves the fake clock on by `ms` (only for a page opened with `now`): the timers due run in their order, then the page settles. */
    async advance(ms) {
      if (clock === null) throw new Error('This page has no fake clock: open it with openPage({ now })')
      clock.advance(ms)
      await settle()
    },
    find(selector) {
      const node = document.querySelector(selector)
      if (node === null) throw new Error(`The page has nothing that matches ${selector}`)
      return node
    },
    all: selector => [...document.querySelectorAll(selector)],
    text: selector => page.find(selector).textContent,
    /** The page asks the board again, as it does every few seconds. */
    reread: async () => { await page.click('#refresh'); },
    async close() {
      await window.happyDOM.abort()
      await window.happyDOM.close()
    },
  }
  return page
}

/** The page's own MIN, HOUR, STATES and KINDS, read once, for the fixtures that build a state in the page's time. */
export const PAGE = await (async () => {
  const page = await openPage({ state: {} })
  try { return page.constants } finally { await page.close() }
})()
