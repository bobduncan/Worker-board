// The trial's gap 3 (2026-10-24): a question waited on the Overview while the user was on the Vision tab and missed it.
// The top bar now says on every tab how many wait for you, and a new question shows a notice with Open it. The words
// and which questions are new run here without the page (cut out of board.js); made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// waits:start'), script.indexOf('// waits:end'))}\nObject.assign(this, { waitsWords, freshWaiting, noticeWords })`, made)

test('the top bar says how many wait for you, on every tab, and nothing when none do', () => {
  assert.equal(made.waitsWords(0), null)
  assert.equal(made.waitsWords(1), '1 waits for you')
  assert.equal(made.waitsWords(3), '3 wait for you')
  assert.match(html, /<button class="waits-button" id="waits-for-you" type="button"[^>]*hidden>/)
  assert.ok(html.indexOf('id="waits-for-you"') < html.indexOf('</nav>'), 'it stands in the top bar')
})

test('only a question that came after the page opened is new: the ones there at the start are no notice', () => {
  const first = made.freshWaiting(null, [{ id: 'work:Q2', from: 'Partner', title: 'P1: What kind?' }])
  assert.deepEqual([[...first.seen], first.fresh.length], [['work:Q2'], 0])
  const next = made.freshWaiting(first.seen, [{ id: 'work:Q2', from: 'Partner', title: 'P1: What kind?' }, { id: 'work:Q4', from: 'Main', title: 'May I change a setting?' }])
  assert.deepEqual(Array.from(next.fresh, one => one.id), ['work:Q4'])
  // Seen once is seen: an answered question that comes back is no new notice.
  assert.deepEqual(made.freshWaiting(next.seen, [{ id: 'work:Q4', from: 'Main', title: 'x' }]).fresh, [])
  assert.equal(made.noticeWords({ from: 'Main', title: 'May I change a setting?' }), 'New question from Main: May I change a setting?')
  assert.equal(made.noticeWords({ from: null, title: 'Pick one' }), 'New question: Pick one')
  assert.match(html, /id="ask-notice"/)
})
