// B155: the Coordinate tab is called Backlog, and at its top it lists the steps finished last, newest first. The page's
// own code is run here, cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const html = await readFile(join(HERE, '..', 'public', 'index.html'), 'utf8')
const style = await readFile(join(HERE, '..', 'public', 'board.css'), 'utf8')
const readme = await readFile(join(HERE, '..', 'README.md'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('tasktimes')}\n${cut('finished')}\nObject.assign(this, { finishedRows })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
const NOW = at(14, 10, 50)
const one = more => ({ key: 'B151', id: 'B151', title: 'A click on a working worker', at: at(14, 10, 27), how: 'report', by: 'Board', ...more })

test('each finished step is one row: when, its id and title, who, and where the time comes from', () => {
  assert.deepEqual(plain(page.finishedRows([one()], NOW)), [{ key: 'B151', code: 'B151', title: 'A click on a working worker', when: '10:27', isRough: false, who: 'Board', how: 'its report to the main chat', took: '' }])
  const rows = plain(page.finishedRows([
    one({ how: 'line', by: 'you' }),
    one({ how: 'seen', at: at(14, 10, 1) }),
    one({ how: 'day', at: at(13, 0, 0), by: null }),
    one({ how: 'line', at: at(13, 0, 30) }),
  ], NOW))
  assert.deepEqual(rows.map(row => [row.when, row.isRough, row.who, row.how]), [
    ['10:27', false, 'you', 'its line in the backlog'],
    // The board saw it ticked: within a minute when it was running, so roughly.
    ['≈ 10:01', true, 'Board', 'the board saw it ticked'],
    // Only the day is known.
    ['13 Oct', true, '—', 'only the day is known'],
    // Another day than today names the day.
    ['13 Oct 00:30', false, 'Board', 'its line in the backlog'],
  ])
  // A step without an id is shown by its title only.
  assert.equal(page.finishedRows([one({ id: null, key: '0:3' })], NOW)[0].code, '')
})

test('the tab is called Backlog, opens at #backlog (and still at #coordinate), and has the list at its top', () => {
  assert.match(html, /data-tab="coordinate">Backlog</)
  assert.ok(html.indexOf('id="finished"') > html.indexOf('class="coordinate-top"') && html.indexOf('id="finished"') < html.indexOf('id="coordinate-list"'))
  assert.match(script, /'#backlog'/)
  assert.match(script, /if \(hash === '#backlog' \|\| hash === '#coordinate'\) return 'coordinate'/)
  assert.ok(style.includes('.finished-row'))
  assert.ok(!/\bCoordinate\b/.test(readme), 'the README names the tab Backlog')
})
