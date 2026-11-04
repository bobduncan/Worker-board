// A look the partner handed to the person that Autopilot keeps for the focus goal's recap (the person's "A", 2026-11-02, the live Q590:
// "Why is he asking me for it. this is autopilot is turned on correct?"; the coordinator the same day: only a hand-over, never a
// worker's look at filing). The ask reads `Route: recap`, its Route section holds the one line below, and it is not blocking (the
// board made it non-blocking, and its step went on). PURE, and imported by the guards, the rest rule and the card, so it names
// nothing of Autopilot's other modules.
//
// The last three kinds of noise (the person's "Yes, clear them", 2026-11-04, the live Q616 "After the step in Q600, reopen the Q600 play
// link", a do the main chat handed on): an own-senses do or look that the main chat or the partner hands to the person, of a step of
// the focus goal, is kept for the recap the same way (its Route line is `handedOnKeptWords`), and counts here as a kept look.

import { valueOf } from './item.mjs'

/** The Route line of a partner's hand-over of a look that Autopilot keeps for the goal's recap instead (the person's "A", 2026-11-02). */
export const HANDED_KEPT_WORDS = 'Your partner hands this to you; Autopilot keeps it for the goal\'s recap'
/**
 * The Route line of a worker's or the main chat's look with pictures of a step of the focus goal that Autopilot keeps for the goal's
 * recap at once (the coordinator's ruling on Autopilot v2, 2026-11-02: an art or map look waits for the recap, never decided by the
 * board's advice or the partner): a kept look as the partner's hand-over is.
 */
export const KEPT_LOOK_WORDS = 'Autopilot keeps this look for the goal\'s recap'
/** Who handed a do or look on to the person, as the Route line of the kept ask names them. */
export const HANDED_ON_WHO = { main: 'the main chat', partner: 'your partner' }
/** The Route line of an own-senses do or look that the main chat or the partner (`by`: 'main' or 'partner') handed on and Autopilot keeps for the recap. */
export const handedOnKeptWords = by => `Kept for the goal's recap: ${HANDED_ON_WHO[by] ?? HANDED_ON_WHO.partner} handed it on`
const HANDED_ON_LINE = /^Kept for the goal's recap: .+ handed it on$/
const KEPT_LINES = [HANDED_KEPT_WORDS, KEPT_LOOK_WORDS]

/**
 * Whether an ask is such a kept look (open or not; the callers ask for open ones): a look routed to the recap whose Route section is a
 * kept line (the partner's hand-over, or since Autopilot v2 a worker's look with pictures), or a look or an own-senses do whose Route
 * section is the hand-on line (`handedOnKeptWords`). It holds no worker (a step is not parked or kept waiting for it) and is no reason for the recap card alone: the card shows it
 * when it has another reason (src/recapCard.mjs).
 */
export function isKeptLook(item) {
  if (item === undefined || item === null || valueOf(item, 'Kind') !== 'ask' || valueOf(item, 'Route') !== 'recap' || valueOf(item, 'Blocking') === 'yes') return false
  const kind = valueOf(item, 'Asks') ?? 'decide'
  const lines = (item.sections?.get('Route') ?? []).map(line => line.trim())
  if (lines.some(line => HANDED_ON_LINE.test(line))) return kind === 'look' || kind === 'do'
  return kind === 'look' && lines.some(line => KEPT_LINES.includes(line))
}
