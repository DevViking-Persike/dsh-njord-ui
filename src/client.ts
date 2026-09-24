/** NJORD panels mounted over public Cordis and Client Remote extension points. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@persike/dsh-project-tools/remote'
import projectRemote from '@persike/dsh-project-tools/remote'
import * as docker from './docker/index.ts'
import * as treadmill from './treadmill/index.ts'
import * as knowledge from './knowledge/index.ts'
import * as archify from './archify/index.ts'
import { installStyles } from './styles.ts'
export const inject = ['remote']
/** Mount the plugin-owned API before activating its consumers. */
export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(projectRemote)
  ctx.effect(() => unmount, 'njord: Remote namespaces')
  ctx.effect(installStyles, 'njord: styles')
  ctx.plugin(docker)
  ctx.plugin(treadmill)
  ctx.plugin(knowledge)
  ctx.plugin(archify)
}
