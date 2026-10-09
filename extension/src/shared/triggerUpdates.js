import { newTrigger } from './records.js';

// Patterns and commands belong to the trigger definition. World grants are local
// permissions and must not be replaced by a CLI payload or an old review snapshot.
export function applyTriggerDefinitionUpdate(triggers, incoming) {
    const project = incoming.project || 'default';
    const existing = triggers.find((trigger) => trigger.name === incoming.name && (trigger.project || 'default') === project);
    const definition = {
        patterns: Array.isArray(incoming.patterns) ? [...incoming.patterns] : [],
        commands: Array.isArray(incoming.commands) ? [...incoming.commands] : []
    };
    if (existing) {
        Object.assign(existing, definition);
        return existing;
    }
    const created = newTrigger(incoming.name, definition.patterns, definition.commands, incoming.project);
    triggers.push(created);
    return created;
}
