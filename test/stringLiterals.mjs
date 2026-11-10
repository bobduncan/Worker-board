// P7, the review: the guard of the status phrases (test/stepStatus.test.mjs) reads every string a file writes, not its lines: a
// phrase split across `+`, a template's static parts, a code line that starts with `*`, all count; a comment never does. A small
// lexer of JavaScript and TypeScript, enough for the board's own files: strings ('', "", ``, with `${}` read as code again),
// comments (// and /* */) and regular expression literals (a `/` where an expression starts).

const BACKSLASH = String.fromCharCode(92)
/** The characters after which a `/` starts a regular expression, not a division. */
const BEFORE_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', ''])
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof'])
const WORD = /[A-Za-z0-9_$]/

/**
 * The string literals of `text`: `[{ line, text }]`, `line` where it starts (1-based). A template's `${...}` reads as one space
 * (its code is read for strings too). Literals joined by `+` (with only white space and comments between) are one literal, so a
 * phrase split across them is found.
 */
export function stringLiterals(text) {
  const found = []
  let i = 0
  let line = 1

  /** Reads code until the `}` that closes a template's `${` (`inTemplate`), or the end; answers nothing, fills `found`. */
  function code(inTemplate) {
    let last = ''
    let lastWord = ''
    let depth = 0
    // The literal being joined: its parts, its line, and whether a `+` came after its last part.
    let parts = null
    let at = 0
    let joinable = false
    const flush = () => {
      if (parts !== null) found.push({ line: at, text: parts.join('') })
      parts = null
      joinable = false
    }
    const push = (value, from) => {
      if (parts !== null && joinable) {
        parts.push(value)
        joinable = false
      } else {
        flush()
        parts = [value]
        at = from
      }
    }
    while (i < text.length) {
      const c = text[i]
      const next = text[i + 1]
      if (c === '\n') { line += 1; i += 1; continue }
      if (c === ' ' || c === '\t' || c === '\r') { i += 1; continue }
      if (c === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i += 1; continue }
      if (c === '/' && next === '*') {
        i += 2
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') line += 1; i += 1 }
        i += 2
        continue
      }
      if (c === "'" || c === '"') { const from = line; push(quoted(c), from); last = 'str'; lastWord = ''; continue }
      if (c === '`') { const from = line; push(template(), from); last = 'str'; lastWord = ''; continue }
      if (c === '/' && (BEFORE_REGEX.has(last) || REGEX_WORDS.has(lastWord))) {
        flush()
        i += 1
        let inClass = false
        while (i < text.length && text[i] !== '\n') {
          if (text[i] === BACKSLASH) { i += 2; continue }
          if (text[i] === '[') inClass = true
          else if (text[i] === ']') inClass = false
          else if (text[i] === '/' && !inClass) break
          i += 1
        }
        i += 1
        while (/[a-z]/i.test(text[i] ?? '')) i += 1
        last = 'regex'
        lastWord = ''
        continue
      }
      if (c === '+' && last === 'str') { joinable = true; last = '+'; i += 1; continue }
      if (WORD.test(c)) {
        let word = ''
        while (i < text.length && WORD.test(text[i])) { word += text[i]; i += 1 }
        flush()
        last = 'word'
        lastWord = word
        continue
      }
      if (c === '{') depth += 1
      if (c === '}') {
        if (inTemplate && depth === 0) { flush(); i += 1; return }
        depth -= 1
      }
      if (last !== '+') flush()
      last = c === ')' || c === ']' ? 'word' : c
      lastWord = ''
      i += 1
    }
    flush()
  }

  function quoted(quote) {
    let value = ''
    i += 1
    while (i < text.length && text[i] !== quote) {
      if (text[i] === BACKSLASH) { value += text[i + 1] ?? ''; i += 2; continue }
      if (text[i] === '\n') line += 1
      value += text[i]
      i += 1
    }
    i += 1
    return value
  }

  function template() {
    let value = ''
    i += 1
    while (i < text.length && text[i] !== '`') {
      if (text[i] === BACKSLASH) { value += text[i + 1] ?? ''; i += 2; continue }
      if (text[i] === '$' && text[i + 1] === '{') {
        i += 2
        code(true)
        value += ' '
        continue
      }
      if (text[i] === '\n') line += 1
      value += text[i]
      i += 1
    }
    i += 1
    return value
  }

  code(false)
  return found
}
