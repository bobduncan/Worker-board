// The asset provider for pictures made by the image models behind ElevenLabs (mode "auto"). Its API needs the Pro plan, so
// a key on a lower plan (free, starter, creator) is "needs", with the reason. A plan the answer does not name (a key that
// may not read the plan) is "needs" too: a Pro plan cannot be told from a free one, and Verify must not pass on a guess.

import { KEY_VARIABLE, askPlan, planAnswer } from './elevenlabs-key.mjs'

/** The plans below Pro, which cannot use the image API. */
const BELOW_PRO = ['free', 'starter', 'creator']

export const elevenlabsImages = {
  name: 'elevenlabs-images',
  mode: 'auto',
  kinds: ['visual'],
  keyVariable: KEY_VARIABLE,
  card: { title: 'ElevenLabs Images', line: 'Image models through ElevenLabs', facts: ['API needs the Pro plan'], icon: 'elevenlabs' },
  /** Whether the key is set, ElevenLabs answers it and the plan is Pro or more. It never throws and never puts the key in its answer. */
  async check(tools = {}) {
    return planAnswer(await askPlan(tools), plan => (plan.tier === '' ? 'Plan unknown: Pro needed' : BELOW_PRO.includes(plan.tier) ? 'Needs the Pro plan' : null))
  },
  /** Part C: not made yet: there is no Pro plan to try it with, so a request fails with why and nothing is sent. */
  provide() {
    return { failed: 'ElevenLabs Images is not wired yet' }
  },
}
