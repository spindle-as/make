import { useState } from 'react'
import { act, useStore } from '../store'
import { Button, Modal, Toggle } from './ui'

export function ArchiveDialog({ featureId, onClose }: { featureId: string; onClose: () => void }) {
  const feature = useStore((s) => s.features.find((f) => f.id === featureId))
  const [removeWorktree, setRemoveWorktree] = useState(true)
  const [deleteBranch, setDeleteBranch] = useState(feature?.stage === 'merged' || feature?.stage === 'deployed')
  const [busy, setBusy] = useState(false)
  if (!feature) return null
  const unmerged = !['merged', 'deployed'].includes(feature.stage)
  return (
    <Modal
      title={`Archive “${feature.title}”`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              await act(() => window.api.archiveFeature(featureId, { removeWorktree, deleteBranch }), 'Feature archived')
              setBusy(false)
              onClose()
            }}
          >
            Archive
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">
          Stops the agent, unlinks the Herd site and removes the feature from the sidebar. The chat history is deleted.
        </p>
        {!feature.inPlace && (
          <>
            <Toggle checked={removeWorktree} onChange={setRemoveWorktree} label={<>Remove worktree <span className="font-mono text-xs text-faint">{feature.worktreePath}</span></>} />
            <Toggle
              checked={deleteBranch && removeWorktree}
              onChange={setDeleteBranch}
              label={<>Delete local branch <span className="font-mono text-xs text-faint">{feature.branch}</span></>}
            />
          </>
        )}
        {unmerged && removeWorktree && !feature.inPlace && (
          <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            This feature isn&apos;t merged. Uncommitted changes in the worktree will be lost{deleteBranch ? ', and so will unpushed commits' : ''}.
          </p>
        )}
      </div>
    </Modal>
  )
}
