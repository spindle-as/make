import clsx from 'clsx'
import icon from '../assets/brand/spindle-icon.svg'
import lockup from '../assets/brand/spindle-lockup-light.svg'
import wordmark from '../assets/brand/spindle-wordmark-light.svg'

/** Spindle wordmark + "/ make". The official SVGs carry the outlined fonts. */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span className={clsx('flex items-center gap-2 select-none', className)} aria-label="Spindle / Make">
      <img src={wordmark} alt="" style={{ height: size }} draggable={false} />
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
  return <img src={lockup} alt="Spindle, by jsj." style={{ height }} draggable={false} />
}

/** The subtle "powered by jsj" signature. Ms Madi is only ever used for the signature. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-baseline gap-1.5 text-xs text-faint select-none', className)}>
      powered by
      <span className="signature text-lg leading-none text-accent">jsj</span>
    </span>
  )
}
