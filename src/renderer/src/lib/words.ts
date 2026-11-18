import { useStore } from '../store'

/** Plain-language labels for Creator mode; engineering terms in Developer mode. */
const WORDS = {
  creator: {
    newFeature: 'Start a change',
    feature: 'Change',
    features: 'Changes',
    openProject: 'Open project',
    changesTab: 'What changed',
    shipTab: 'Review',
    processesTab: 'Running',
    logsTab: 'Problems',
    setupTab: 'Setup',
    commit: 'Save progress',
    checks: 'Check changes',
    submit: 'Submit for review',
    checkAndSubmit: 'Check & submit',
    merge: 'Approve and apply',
    deploy: 'Go live',
    stages: { coding: 'Build', testing: 'Preview', pr: 'In review', merged: 'Approved', deployed: 'Live' },
    migration: 'Update data structure',
    whatShouldWeBuild: 'What would you like to create or change?',
    buildHint: 'Describe it in your own words. Spindle builds it in a safe copy of your project that you can preview before anyone reviews it.'
  },
  developer: {
    newFeature: 'New feature',
    feature: 'Feature',
    features: 'Features',
    openProject: 'Add project',
    changesTab: 'Changes',
    shipTab: 'Ship',
    processesTab: 'Processes',
    logsTab: 'Logs',
    setupTab: 'Setup',
    commit: 'Commit',
    checks: 'Run checks',
    submit: 'Open pull request',
    checkAndSubmit: 'Checks & PR',
    merge: 'Merge',
    deploy: 'Deploy',
    stages: { coding: 'Code', testing: 'Test', pr: 'PR & CI', merged: 'Merge', deployed: 'Deploy' },
    migration: 'Migration',
    whatShouldWeBuild: 'What should we build?',
    buildHint: 'Describe the feature. It gets its own branch, worktree, local site and database, and the agent starts right away.'
  }
} as const

export type Words = (typeof WORDS)['creator'] | (typeof WORDS)['developer']

export function useWords(): Words {
  const mode = useStore((s) => s.settings?.mode ?? 'creator')
  return WORDS[mode]
}

export function useIsCreator(): boolean {
  return useStore((s) => (s.settings?.mode ?? 'creator') === 'creator')
}
