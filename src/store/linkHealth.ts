import type { LinkHealthSnapshot, LinkHealthState } from '@/types/linkHealth'
import type { LinkDraft } from './commsConfig'

export type LinkHealthDisplayState = LinkHealthState | 'disabled'

export interface ConfiguredLinkHealth {
  config: LinkDraft
  snapshots: LinkHealthSnapshot[]
  state: LinkHealthDisplayState
}

function aggregateState(snapshots: LinkHealthSnapshot[]): LinkHealthState {
  const states = new Set(snapshots.map((snapshot) => snapshot.state))
  if (states.has('recovering')) return 'recovering'
  if (states.has('suspect')) return 'suspect'
  if (states.has('healthy') && states.has('down')) return 'suspect'
  if (states.has('healthy')) return 'healthy'
  return 'down'
}

function linkKey(name: string, protocol: LinkHealthSnapshot['protocol']) {
  return `${name}\u0000${protocol}`
}

export function mergeConfiguredLinkHealth(
  configuredLinks: LinkDraft[],
  snapshots: LinkHealthSnapshot[],
): ConfiguredLinkHealth[] {
  const snapshotsByLink = new Map<string, LinkHealthSnapshot[]>()
  for (const snapshot of snapshots) {
    const items = snapshotsByLink.get(linkKey(snapshot.linkName, snapshot.protocol)) ?? []
    items.push(snapshot)
    snapshotsByLink.set(linkKey(snapshot.linkName, snapshot.protocol), items)
  }

  return configuredLinks.map((config) => {
    const linkSnapshots = config.enabled
      ? snapshotsByLink.get(linkKey(config.name, config.protocol)) ?? []
      : []
    return {
      config,
      snapshots: linkSnapshots,
      state: config.enabled
        ? linkSnapshots.length > 0
          ? aggregateState(linkSnapshots)
          : 'down'
        : 'disabled',
    }
  })
}
