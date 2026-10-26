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

/**
 * Opens the page. `state` is what GET /api/state answers (a function of the requests so far works too);
 * `answers(request)` answers any other request, by default 200 `{}`. A request is `{ url, method, headers, body }` with
 * the body already parsed from JSON. `hash` is the address after #.
 * Returns the page's `window` and `document`, the `requests` made, `click`, `change`, `type`, `text` and `close`.
 */
export async function openPage({ state, answers = () => reply({}), hash = '' } = {}) {
  const window = new Window({ url: `http://127.0.0.1:4310/${hash === '' ? '' : `#${hash}`}`, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, errorCapture: 'processLevel' } })
  const { document } = window
  document.write(html.replace(/<script[^>]*><\/script>/g, '').replace('{{token}}', TOKEN).replace('{{page}}', 'test'))
  const requests = []
  window.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: typeof init.body === 'string' ? JSON.parse(init.body) : (init.body ?? null) }
    requests.push(request)
    if (request.url === '/api/state') return reply(typeof state === 'function' ? state(requests) : state)
    return answers(request)
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
