#!/usr/bin/env node
// Builds the small native helpers bundled with the app (Resources/bin). Today: clonedir, which
// clones a whole folder copy-on-write in one call (fast workspace setup, see src/main/fastsetup.ts).
// If it can't be built here, the app still works: it builds it on first launch or falls back to `cp -c`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const out = 'build/helpers'
const direct = import.meta.url === `file://${process.argv[1]}`
// Same source as CLONEDIR_SOURCE in src/main/fastsetup.ts (a test keeps them identical).
export const CLONEDIR_SOURCE = `#include <sys/clonefile.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
int main(int argc, char **argv) {
  if (argc != 3) { fprintf(stderr, "usage: clonedir <src> <dst>\\n"); return 2; }
  if (clonefile(argv[1], argv[2], CLONE_NOFOLLOW) != 0) { fprintf(stderr, "clonefile: %s\\n", strerror(errno)); return 1; }
  return 0;
}
`
if (direct) {
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const src = `${out}/clonedir.c`
writeFileSync(src, CLONEDIR_SOURCE)
try {
  execFileSync('cc', ['-O2', '-arch', 'arm64', '-o', `${out}/clonedir`, src], { stdio: 'inherit' })
  console.log('✓ built build/helpers/clonedir')
} catch {
  console.warn('! could not build clonedir — the app will build it on first launch or use cp -c')
}
rmSync(src, { force: true })
}
