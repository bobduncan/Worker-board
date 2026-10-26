// T9.4: a note to the person about a step, an ask or an incident (the supervisor's "asked 3 times" notes among them)
// carries a link to it when it is open: a step or an ask opens its window, an incident the Supervisor section.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const source = script.match(/^function infoTarget\([\s\S]*?^}$/m)?.[0]
const page = {}
vm.runInNewContext(`${source}\nthis.infoTarget = infoTarget`, page)

test('a note about a step or an ask links its window; about an incident, the Supervisor section', () => {
  assert.deepEqual({ ...page.infoTarget('B712') }, { href: '#details=B712', text: 'Open B712' })
  assert.deepEqual({ ...page.infoTarget('Q42') }, { href: '#details=Q42', text: 'Open Q42' })
  assert.deepEqual({ ...page.infoTarget('X80') }, { href: '#supervisor', text: 'Open X80 under Supervisor' })
})

test('a note about nothing, or about something else, has no link', () => {
  assert.equal(page.infoTarget(null), null)
  assert.equal(page.infoTarget(undefined), null)
  assert.equal(page.infoTarget('G60'), null)
  assert.equal(page.infoTarget('B712 and more'), null)
})
