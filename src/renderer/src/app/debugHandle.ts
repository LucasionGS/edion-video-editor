import * as core from '@core/index'
import * as session from '@/engine/playback/session'
import * as commands from '@/store/commands'
import * as dialogs from '@/store/dialogs'
import * as editor from '@/store/editor'
import * as feedback from '@/store/feedback'
import * as source from '@/store/source'
import * as projectActions from '@/store/projectActions'

/**
 * Automated runs only (`EDION_SCREENSHOT`): exposes the stores and commands as `window.__edion`, so an
 * `EDION_DEBUG_SCRIPT` can drive the editor and inspect its state without synthesising pointer events.
 */
export function installDebugHandle(): void {
  Object.assign(window, {
    __edion: { core, editor, commands, session, projectActions, feedback, dialogs, source }
  })
}
