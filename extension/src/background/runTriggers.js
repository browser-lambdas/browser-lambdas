import { log } from './activityLog.js';
import { executeLambda } from './executeLambda.js';
import { getTriggers } from './getTriggers.js';
import { matchesUrlPattern } from '../shared/urlPattern.js';
export async function runTriggers(tabId, url) {
    const triggers = await getTriggers();
    for (const trigger of triggers) {
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
                    await executeLambda(tabId, cmd, crypto.randomUUID(), 0, { id: trigger.id, name: trigger.name, project: trigger.project });
                }
            }
        }
        catch (err) {
            log.err(`Trigger execution failed: trigger="${trigger.name || 'unnamed'}", tabId=${tabId}, url="${url}".`, err);
        }
    }
}
