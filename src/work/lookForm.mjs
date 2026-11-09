// The form of a look kept for the recap (the person, 2026-11-08, about Q692: "i want to better understand what it's asking me and do not
// have misleading titles or images. not too much text either, context, problem"): four short labelled lines in the look's text. PURE; the
// work API (the refusal), the recap round (a `form` on each kept look) and the tests read it here, so the page and the server agree.

const LABELS = [['context', /^context\s*:\s*(.*)$/i], ['problem', /^problem\s*:\s*(.*)$/i], ['approve', /^approve\s*:\s*(.*)$/i], ['sendBack', /^send\s+back\s*:\s*(.*)$/i]]

/** The four lines of a look's text, `{ context, problem, approve, sendBack, rest }`: a missing one is null, `rest` the other lines in order. */
export function lookFormOf(text) {
  const all = Array.isArray(text) ? text : String(text ?? '').split('\n')
  const form = { context: null, problem: null, approve: null, sendBack: null, rest: [] }
  for (const raw of all) {
    const said = String(raw ?? '').replace(/\s+/g, ' ').trim()
    if (said === '') continue
    const bare = said.replace(/\*\*/g, '')
    const found = LABELS.find(([key, pattern]) => form[key] === null && pattern.test(bare))
    if (found === undefined) form.rest.push(said)
    else form[found[0]] = bare.match(found[1])[1].trim()
  }
  return form
}

/** Whether all four lines are there and say something. */
export const isLookForm = form => form !== null && form !== undefined && ['context', 'problem', 'approve', 'sendBack'].every(key => typeof form[key] === 'string' && form[key] !== '')

/** The board's refusal of a look kept for the recap that lacks the form (409). */
export const LOOK_FORM_WHY = 'A look for the recap needs four short lines in its text: "Context: <what changed or where>", "Problem: <what is wrong now>", "Approve: <what stays>", "Send back: <what a later step changes>", and pictures and a Play link of the very place it asks about (not the step\'s general evidence). Write it so, and ask again.'

/** The refusal with the form filled in with the chat's own words, as a block to copy: one retry fixes it. `step`: `{ id, title }` or null. */
export function lookFormRefusal({ step, text }) {
  const cut = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const words = (text ?? []).slice(1).filter(one => !/^\s*(context|problem|approve|send back)\s*:/i.test(one)).join(' ')
  const own = cut(words === '' ? text?.[0] : words, 160)
  const block = [`Context: ${step === null || step === undefined ? 'what this look is about' : cut(`${step.id} ${step.title}`, 160)}`, `Problem: ${own}`, 'Approve: keep it as it is', 'Send back: a later step changes it']
  return `${LOOK_FORM_WHY}\n\nCopy this into the look's text and correct it:\n${block.join('\n')}\n\nThen put the picture and Play link of the very place it asks about with it.`
}
