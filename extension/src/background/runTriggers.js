import { log } from './activityLog.js';
import { executeLambda } from './executeLambda.js';
import { getTriggers } from './getTriggers.js';
import { matchesUrlPattern } from '../shared/urlPattern.js';
export async function runTriggers(tabId, url) {
    const triggers = await getTriggers();
    for (const trigger of triggers) {
        if (trigger.enabled === false) continue;
        try {
            const patterns = trigger.patterns ?? [];
            if (patterns.some((p) => {
                try {
                    return matchesUrlPattern(p, url);
                }
                catch (err) {
                    log.err(`Trigger "${trigger.name || 'unnamed'}" contains an invalid pattern: pattern="${p}".`, err);
                    return false;
                }
            })) {
                const commands = Array.isArray(trigger.commands) ? trigger.commands : [];
                for (const cmd of commands) {
                    const execution = await executeLambda(tabId, cmd, crypto.randomUUID(), 0, { id: trigger.id, name: trigger.name, project: trigger.project });
                    if (execution.started === false) throw new Error(execution.error);
                    const result = await execution.completion;
                    if (result?.error) throw new Error(result.error);
                }
            }
        }
        catch (err) {
            log.err(`Trigger execution failed: trigger="${trigger.name || 'unnamed'}", tabId=${tabId}, url="${url}".`, err);
        }
    }
}
