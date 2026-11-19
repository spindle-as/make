import { ReviewPanel } from '../panels/ReviewPanel'
import { ShipPanel } from '../panels/ShipPanel'
import { useIsCreator, useWords } from '../lib/words'
import { useStore } from '../store'
import { Modal } from './ui'

/**
 * Review & ship as one focused task (Material 3: a dialog for a short, multi-step flow) instead of a
 * side tab: run the checks, submit for review, approve, go live. Opened from the next-step button
 * under the conversation or the stage chip in the header.
 */
export function ShipDialog({ featureId, onClose }: { featureId: string; onClose: () => void }) {
  const creator = useIsCreator()
  const w = useWords()
  const feature = useStore((s) => s.features.find((f) => f.id === featureId))
  const project = useStore((s) => s.projects.find((p) => p.id === feature?.projectId))
  if (!feature || !project) return null
  return (
    <Modal title={creator ? w.checkAndSubmit : 'Review & ship'} onClose={onClose} width={720} padded={false}>
      <div>{creator ? <ReviewPanel feature={feature} project={project} /> : <ShipPanel feature={feature} project={project} />}</div>
    </Modal>
  )
}
