// B1274 (F36b, 2026-11-19, the person's yes in chat 1: "yes, build F36 with the clean-up"): the copy-paste mode is gone. Without the
// Workers mod the board's words wait, as for a chat that is not running, and one grey line says what to do; nothing is put on the
// clipboard for the person to paste. This guard keeps it gone: no word is written as 'copied', no paste text is made, and the page
// has no paste bar. Old outbox lines in the 'copied' state are still read as history (the readers stay); none is made any more.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IN_SCOPE = /^(?:server\.mjs|src\/.*\.mjs|public\/.*\.js)$/

/** What the copy-paste mode was made of: a word written as copied, its paste text, the page's paste bar and copied lines. */
export const MODE = {
  'a word written as copied': /\bstate:[^,}]*['"]copied['"]/,
  'the copied switch': /\bisCopied\b/,
  'a paste text made': /pasteText\s*:/,
  'the paste bar': /\b(?:showPaste|pasteLine|copyPaste|copiedLine)\b|paste-note/,
  'a paste answer': /\bpaste\s*\?\?=|\{\s*paste\s*\}/,
}

export function modeLeft(files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(file => IN_SCOPE.test(file)), read = file => readFileSync(join(ROOT, file), 'utf8')) {
  const found = []
  for (const file of files) {
    const lines = read(file).split('\n')
    lines.forEach((line, at) => {
      for (const [what, pattern] of Object.entries(MODE)) if (pattern.test(line)) found.push(`${file}:${at + 1} ${what}: ${line.trim().slice(0, 120)}`)
    })
  }
  return found
}

test('the copy-paste mode is gone: no word is written as copied, no paste text is made, the page has no paste bar', () => {
  assert.deepEqual(modeLeft(), [])
})

test('the guard finds each form of the mode, and leaves the readers of old copied lines and the picture paste alone', () => {
  const sample = {
    'a.mjs': "const message = { ...words, state: isCopied ? 'copied' : 'waiting' }\nawait say({ ...message, pasteText: text })\nshowPaste(result.paste)\npaste ??= { text }\nreturn { paste }",
    'b.mjs': "if (message.state === 'copied') return 'arrived'\nconst pasted = pastedTalk(event.clipboardData?.items)\nconst line = 'Paste it again.'",
  }
  const found = modeLeft(Object.keys(sample), file => sample[file]).map(one => one.split(' ').slice(1).join(' ').split(':')[0])
  assert.deepEqual(found, ['a word written as copied', 'the copied switch', 'a paste text made', 'the paste bar', 'a paste answer', 'a paste answer'])
})

test('without the Workers mod the page says one grey line of what to do', () => {
  const page = readFileSync(join(ROOT, 'public', 'board.js'), 'utf8')
  assert.match(page, /const WITHOUT_MOD = "The Workers mod isn't running here: run setup \(npm\.cmd run setup\) and restart the app\."/)
  assert.match(page, /workers\.withoutMod === true \? \[\{ tone: 'note', text: WITHOUT_MOD \}\]/)
})
