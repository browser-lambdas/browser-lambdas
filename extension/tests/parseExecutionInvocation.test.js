import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MAIN_WORLD,
    USER_SCRIPT_WORLD,
    parseExecutionInvocation
} from '../src/background/parseExecutionInvocation.js';

test('uses the user-script world by default', () => {
    assert.deepEqual(parseExecutionInvocation('inspect-page --verbose'), {
        execution: USER_SCRIPT_WORLD,
        hasExecutionPrefix: false,
        invalidPrefix: null,
        userInput: 'inspect-page --verbose'
    });
});

test('accepts explicit execution-world prefixes case-insensitively', () => {
    assert.deepEqual(parseExecutionInvocation('@user-world inspect-page'), {
        execution: USER_SCRIPT_WORLD,
        hasExecutionPrefix: true,
        invalidPrefix: null,
        userInput: 'inspect-page'
    });
    assert.deepEqual(parseExecutionInvocation('@MAIN-WORLD patch-page'), {
        execution: MAIN_WORLD,
        hasExecutionPrefix: true,
        invalidPrefix: null,
        userInput: 'patch-page'
    });
});

test('rejects malformed long execution prefixes', () => {
    for (const input of ['@user inspect-page', '@main patch-page', '@main-worlda patch-page', '@a patch-page', '@usr-world patch-page']) {
        assert.deepEqual(parseExecutionInvocation(input), {
            execution: USER_SCRIPT_WORLD,
            hasExecutionPrefix: false,
            invalidPrefix: input.split(/\s+/, 1)[0],
            userInput: input
        });
    }
});
