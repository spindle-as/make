import type { Api } from '../shared/types'

declare global {
  interface Window {
    api: Api
    menu: {
      onAction(cb: (id: string) => void): () => void
    }
  }
}

export {}
