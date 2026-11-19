import clsx from 'clsx'
import icon from '../assets/brand/spindle-icon.svg'
import lockupSvg from '../assets/brand/spindle-lockup-light.svg?raw'
import wordmarkSvg from '../assets/brand/spindle-wordmark-light.svg?raw'

/** The official SVG with its light text recoloured to the current text colour (works in light and dark). */
const themed = (svg: string) => svg.replace(/fill="#eeeee7"/gi, 'fill="currentColor"').replace(/<svg /, '<svg style="height:100%;width:auto;display:block" ')
const WORDMARK = themed(wordmarkSvg)
const LOCKUP = themed(lockupSvg)

/** Spindle wordmark + "/ make". The official SVGs carry the outlined fonts. */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span className={clsx('flex items-center gap-2 select-none', className)} aria-label="Spindle / Make">
      <span className="text-fg" style={{ height: size, display: 'inline-block' }} dangerouslySetInnerHTML={{ __html: WORDMARK }} />
      <span className="font-medium tracking-tight text-faint" style={{ fontSize: size * 0.82 }}>
        / make
      </span>
    </span>
  )
}

export function BrandIcon({ size = 40 }: { size?: number }) {
  return <img src={icon} alt="Spindle" style={{ width: size, height: size }} draggable={false} />
}

export function Lockup({ height = 64 }: { height?: number }) {
  return <span role="img" aria-label="Spindle, by jsj." className="text-fg" style={{ height, display: 'inline-block' }} dangerouslySetInnerHTML={{ __html: LOCKUP }} />
}

/** The subtle "powered by jsj" signature. Ms Madi is only ever used for the signature. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-baseline gap-1.5 text-xs text-faint select-none', className)}>
      powered by
      <span className="signature text-lg leading-none text-muted">jsj</span>
    </span>
  )
}
