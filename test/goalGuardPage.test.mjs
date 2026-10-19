// B359: the goal guard on the Focus page's run: the failed checks since Go so far, the partner's evaluation, a rebuild
// that waits for the person. The page's own code runs here, cut out of board.js between its marks. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const css = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
Object.assign(this, { focusGuardView })`, made)

const focus = guard => ({ id: 'G2', guard })

test('the run shows the guard: attempts so far, the evaluation, a rebuild for the person; nothing before a failed check', () => {
  assert.equal(made.focusGuardView(focus(null)), null)
  assert.equal(made.focusGuardView({ id: 'G2' }), null)
  assert.equal(made.focusGuardView(focus({ attempts: 0, of: 3, state: 'counting', ask: null })), null)
  const two = made.focusGuardView(focus({ attempts: 2, of: 3, state: 'counting', ask: null }))
  assert.deepEqual([two.tone, two.title], ['counting', 'Checks failed: 2 of 3 attempts'])
  const evaluating = made.focusGuardView(focus({ attempts: 3, of: 3, state: 'evaluating', ask: null }))
  assert.deepEqual([evaluating.tone, evaluating.title], ['evaluating', 'Your partner evaluates the approach'])
  assert.match(evaluating.text, /^3 checks failed since Go: on high effort/)
  const rebuild = made.focusGuardView(focus({ attempts: 3, of: 3, state: 'rebuild', ask: 'Q9' }))
  assert.deepEqual([rebuild.tone, rebuild.title], ['rebuild', 'A rebuild waits for you'])
  assert.match(rebuild.text, /\(Q9\): answer it under Needs your attention\. Nothing is rebuilt before your yes\./)
})

test('the card stands on the run\'s right, above the re-check, in its own colours', () => {
  assert.match(script, /view\.guard = focusGuardView\(focus\)/)
  assert.match(script, /if \(view\.guard !== null && view\.guard !== undefined\) right\.append\(focusGuardCard\(view\.guard\)\)\n\s*if \(view\.recheck/)
  for (const tone of ['counting', 'evaluating', 'rebuild']) assert.match(css, new RegExp(`\.focus-guard\.is-${tone} h3 \{`))
})
