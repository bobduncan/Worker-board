// Capabilities must be demonstrated by the bridge, not inferred from a version or model name.
export function enforcementReadiness(value) {
  const missing = []
  if (value?.protocolVersion !== 1) missing.push('compatible routing protocol')
  if (value?.canBlockExecution !== true) missing.push('guarded execution tools')
  if (value?.canObserveActualRoute !== true) missing.push('actual model and effort confirmation')
  if (value?.canSetOtherSession !== true) missing.push('native settings controller')
  if (value?.canAttributeChildren !== true && value?.canDisableChildren !== true) missing.push('child attribution or child execution disabled')
  return { ok: missing.length === 0, missing, why: missing.length === 0 ? null : `Execution held: ${missing.join('; ')} not confirmed.` }
}
