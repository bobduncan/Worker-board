// T9.3 part 1: the Design tab's part "Asset providers": one line per kind of asset, the kind, its provider, and "works"
// or why it does not. The page reads `state.providers`; the part is quiet, and only a provider that does not work is in
// the attention colour. The page's own code is run here, cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const markup = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = script.slice(script.indexOf('// providers:start'), script.indexOf('// providers:end'))
const page = {}
vm.runInNewContext(`${cut}\nObject.assign(this, { providerLines })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const providers = [
  { kind: 'visual', provider: 'codex', mode: 'auto', ok: false, why: 'Codex not found' },
  { kind: 'music', provider: 'person-suno', mode: 'person', ok: true, why: 'you make it in Suno' },
  { kind: 'sound effect', provider: 'sound-library', mode: 'pick', ok: true, why: 'The sound library folder "sound-library" holds sounds' },
]

test('the lines of "Asset providers": the kind, the provider, "works" or the why; the attention tone only for one that does not work', () => {
  assert.deepEqual(plain(page.providerLines(providers)), [
    { kind: 'visual', provider: 'codex', text: 'Codex not found', tone: 'attention' },
    { kind: 'music', provider: 'person-suno', text: 'works', tone: 'quiet' },
    { kind: 'sound effect', provider: 'sound-library', text: 'works', tone: 'quiet' },
  ])
  // A provider that does not work and says no why still says that; one the board did not know has no name.
  assert.deepEqual(plain(page.providerLines([{ kind: 'visual', provider: null, ok: false, why: '' }])), [{ kind: 'visual', provider: 'none', text: 'does not work', tone: 'attention' }])
  // A board that sends none (an older server, the demo) shows no lines.
  for (const none of [undefined, null, [], 'nonsense']) assert.deepEqual(plain(page.providerLines(none)), [], String(none))
})

test('the Design tab has the part "Asset providers" under "Ideas so far", hidden until the board sends providers', () => {
  const tab = markup.slice(markup.indexOf('id="view-design"'), markup.indexOf('<dialog class="details"'))
  assert.ok(tab.indexOf('Ideas so far') >= 0 && tab.indexOf('Asset providers') > tab.indexOf('id="design-strip"'))
  assert.match(tab, /<section class="panel design-providers" id="design-providers"[^>]* hidden>\s*<h2 id="design-providers-title">Asset providers<\/h2>\s*<ul class="provider-list" id="design-provider-list"><\/ul>/)
  // It is drawn with the rest of the tab, from the state.
  assert.match(script, /drawDesignStrip\(design, view, main\)\n {2}drawProviders\(\)\n\}/)
  assert.match(script, /providerLines\(board\?\.providers\)/)
})

test('drawing the part: a line per kind, shown only when there are lines', () => {
  const start = script.indexOf('function drawProviders() {')
  const code = script.slice(start, script.indexOf('\n}\n', start) + 3)
  const draw = board => {
    const parts = { 'design-providers': { hidden: true, children: [] }, 'design-provider-list': { hidden: true, children: [] } }
    const sandbox = {
      board,
      providerLines: page.providerLines,
      $: id => parts[id],
      el: (tag, className = '', text = null) => ({ tag, className, text, children: [], append(...kids) { this.children.push(...kids) } }),
      fill: (parent, children) => Object.assign(parent, { children }),
      once: (key, data, run) => run(),
    }
    vm.runInNewContext(`${code}
this.run = drawProviders`, sandbox)
    sandbox.run()
    return parts
  }
  const parts = draw({ providers })
  assert.equal(parts['design-providers'].hidden, false)
  assert.deepEqual(parts['design-provider-list'].children.map(row => [row.tag, row.className, row.children.map(cell => [cell.className, cell.text])]), [
    ['li', 'provider-line', [['provider-kind', 'visual'], ['provider-name', 'codex'], ['provider-state is-attention', 'Codex not found']]],
    ['li', 'provider-line', [['provider-kind', 'music'], ['provider-name', 'person-suno'], ['provider-state is-quiet', 'works']]],
    ['li', 'provider-line', [['provider-kind', 'sound effect'], ['provider-name', 'sound-library'], ['provider-state is-quiet', 'works']]],
  ])
  for (const board of [{}, { providers: [] }, null]) assert.equal(draw(board)['design-providers'].hidden, true, JSON.stringify(board))
})

test('the part is quiet: the attention colour is only for a provider that does not work', () => {
  const rules = style.split('\n').filter(line => /provider-|design-providers/.test(line))
  assert.ok(rules.length >= 4)
  const attention = rules.filter(line => /var\(--warn\)|var\(--waiting\)|#ff|amber|gold|orange|red/i.test(line))
  assert.equal(attention.length, 1)
  assert.match(attention[0], /^\.provider-state\.is-attention \{/)
  assert.match(rules.find(line => line.startsWith('.provider-state.is-quiet')), /color: var\(--muted\)/)
})
