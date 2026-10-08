import { newLambda } from './records.js';

// Sync changes code only. Permissions remain local workspace decisions, including
// when a reviewed batch contains an older snapshot of those decisions.
export function applyFunctionCodeUpdate(lambdas, incoming) {
    const project = incoming.project || 'default';
    const existing = lambdas.find((lambda) => lambda.name === incoming.name && (lambda.project || 'default') === project);
    if (existing) {
        existing.func = incoming.func;
        return existing;
    }
    const created = newLambda(incoming.name, incoming.func, incoming.project);
    lambdas.push(created);
    return created;
}
