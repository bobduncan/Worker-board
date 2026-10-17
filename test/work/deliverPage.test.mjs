// B300: the reconciler's flags on the page: a lane's flag with its button "Start <chat>", the lines on top, and an old
// blocking ask first under Needs your attention. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'board.js'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = { order: 'newest' }
vm.runInNewContext(`const $ = () => ({ value: order })\n${cut('laneflags')}\n${cut('store')}\n${script.slice(script.indexOf('const newness'), script.indexOf('// order:end'))}\nObject.assign(this, { laneFlags, storeNote, ordered })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

test('a stuck lane gets its line and the button that asks the main chat to start it; a card flag has none', () => {
  const lane = { name: 'Digger', flags: [{ kind: 'stuck', id: 'B1', text: 'B1: Digger holds it but is not running', button: 'Start Digger' }, { kind: 'card', id: 'B9', text: 'Digger\'s card says B9 but B9 is queued', button: null }] }
  assert.deepEqual(plain(page.laneFlags(lane, { main: 'Lead', starting: [] })), [
    { text: 'B1: Digger holds it but is not running', tone: 'problem', button: { label: 'Start Digger', start: 'Digger', isAsked: false } },
    { text: 'Digger\'s card says B9 but B9 is queued', tone: 'warn', button: null },
  ])
  // Asked already: the button says so; without a main chat there is nobody to ask.
  assert.equal(page.laneFlags(lane, { main: 'Lead', starting: [{ chat: 'Digger', at: 1, state: 'waiting' }] })[0].button.isAsked, true)
  assert.equal(page.laneFlags(lane, { main: null })[0].button, null)
  assert.deepEqual(plain(page.laneFlags({ name: 'Digger' }, null)), [])
})

test('the reconciler\'s lines stand on top; a store that cannot be read still comes first', () => {
  assert.deepEqual(plain(page.storeNote({ ok: true, failed: false }, ['B10.md: line 3 is no head line'])), { tone: 'problem', text: 'The work store: B10.md: line 3 is no head line. Such an item is shown as it is and not moved: fix it by hand.' })
  assert.equal(page.storeNote({ ok: false, failed: true, why: 'Unreadable.' }, ['x']).text, 'Unreadable.')
  assert.equal(page.storeNote({ ok: true, failed: false }, []), null)
})

test('an old blocking ask stands first under Needs your attention, whatever the order', () => {
  const needs = [{ id: 'a', at: 3 }, { id: 'b', at: 1, isOld: true }, { id: 'c', at: 2 }]
  assert.deepEqual(plain(page.ordered(needs).map(one => one.id)), ['b', 'a', 'c'])
  page.order = 'oldest'
  assert.deepEqual(plain(page.ordered(needs).map(one => one.id)), ['b', 'c', 'a'])
})
