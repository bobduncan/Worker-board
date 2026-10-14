// B157: a task window says in a few lines what was asked and what the answer is, with the details folded away. The
// page's own code is run here, cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\nObject.assign(this, { shortTask })`, page)

test('the short task is the main chat\'s first line without its frame: what is asked, not who asks or how long', () => {
  assert.equal(page.shortTask('Task from Game - Main: B201, a zebracorn that sings at dawn. About 1 hour 30 minutes.\n\nWhy: the person asked.'), 'A zebracorn that sings at dawn.')
  assert.equal(page.shortTask('Two tasks from Game - Main: B12 and then B13, the quokkaberry maps. About 2 h.'), 'B12 and then B13, the quokkaberry maps.')
  assert.equal(page.shortTask('Next task from Game - Main: B7: the narwhal bridge. About 45 minutes'), 'The narwhal bridge.')
  // A first line without that frame stays as it is: the person's own words, typed in the chat.
  assert.equal(page.shortTask('make the zebracorn sing louder\nand at dusk too'), 'Make the zebracorn sing louder')
})

test('an "In short:" line wins; without a message the step\'s title, then the card\'s topic', () => {
  assert.equal(page.shortTask('Task from Game - Main: B201, a long first line about many things at once. About 3 h.\nIn short: the zebracorn sings.'), 'The zebracorn sings.')
  assert.equal(page.shortTask(null, 'zebracorn songs at dawn', 'songs'), 'Zebracorn songs at dawn')
  assert.equal(page.shortTask('', null, 'songs'), 'Songs')
  assert.equal(page.shortTask(null), '')
})

test('a long task is cut, so the window\'s two lines hold it', () => {
  const long = page.shortTask(`Task from Game - Main: B201, ${'a zebracorn sings '.repeat(30)}. About 1 h.`)
  assert.equal(long.length, 220)
  assert.ok(long.endsWith('…'))
})
