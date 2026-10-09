const USER_EXECUTION_PREFIX = '@user-world';
const MAIN_EXECUTION_PREFIX = '@main-world';
export const USER_SCRIPT_WORLD = 'USER_SCRIPT_WORLD';
export const MAIN_WORLD = 'MAIN_WORLD';

export function parseExecutionInvocation(input) {
    const trimmed = input.trim();
    const [prefix = ''] = trimmed.split(/\s+/, 1);
    const normalizedPrefix = prefix.toLowerCase();
    const invalidPrefix = prefix.startsWith('@') &&
        ![USER_EXECUTION_PREFIX, MAIN_EXECUTION_PREFIX].includes(normalizedPrefix)
        ? prefix
        : null;
    const execution = normalizedPrefix === MAIN_EXECUTION_PREFIX
        ? MAIN_WORLD
        : USER_SCRIPT_WORLD;
    const hasExecutionPrefix = normalizedPrefix === USER_EXECUTION_PREFIX ||
        normalizedPrefix === MAIN_EXECUTION_PREFIX;

    return {
        execution,
        hasExecutionPrefix,
        invalidPrefix,
        userInput: hasExecutionPrefix
            ? trimmed.slice(prefix.length).trim()
            : trimmed
    };
}
