// The asset provider for music made by ElevenLabs (Eleven Music, mode "auto"): whole tracks from a description. Part A only
// knows whether it can work now, with the same key and plan question as the other ElevenLabs providers.

import { KEY_VARIABLE, askPlan, planAnswer } from './elevenlabs-key.mjs'

export const elevenlabsMusic = {
  name: 'elevenlabs-music',
  mode: 'auto',
  kinds: ['music'],
  keyVariable: KEY_VARIABLE,
  card: { title: 'ElevenLabs Music', line: 'Whole tracks from a description', facts: ['Licensed for commercial use', '~900 credits a minute'], icon: 'elevenlabs' },
  /** Whether the key is set and ElevenLabs answers it (see elevenlabs.mjs). It never throws and never puts the key in its answer. */
  async check(tools = {}) {
    return planAnswer(await askPlan(tools))
  },
}
