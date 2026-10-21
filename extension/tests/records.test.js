import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newLambda, newSecret, newStorageItem, newRuntimeStorageItem, newTrigger, newStyle } from '../src/shared/records.js';
import { evaluateAccessPolicy } from '../src/shared/accessPolicy.js';

test('record factories preserve workspace versus runtime permission defaults without shared mutable state', () => {
    const records = [newLambda(), newSecret(), newStorageItem()];
    for (const record of records) assert.deepEqual(record.allowedWorlds, ['user_scripts']);
    assert.equal(new Set(records.map((record) => record.id)).size, records.length);
    records[0].allowedWorlds.push('main');
    assert.deepEqual(newLambda().allowedWorlds, ['user_scripts']);
    assert.equal(newLambda().world, '');
    const runtime = newRuntimeStorageItem('test', { count: 2 });
    assert.deepEqual(runtime.value, { count: 2 });
    assert.deepEqual(runtime.allowedWorlds, ['user_scripts', 'main']);
    assert.equal(runtime.urlAllowlistEnabled, false);
    assert.equal(evaluateAccessPolicy({ policy: runtime, executionWorld: 'MAIN_WORLD', url: 'https://example.com', allowMainWorld: false }).allowed, false);
    assert.equal(evaluateAccessPolicy({ policy: runtime, executionWorld: 'MAIN_WORLD', url: 'https://example.com', allowMainWorld: true }).allowed, true);
});

test('trigger definitions are copied and style records include stable identity and selection state', () => {
    const patterns = ['https://example.com/*'];
    const commands = ['hello'];
    const trigger = newTrigger('test', patterns, commands, 'project');
    patterns.push('*');
    commands.push('other');
    assert.deepEqual(trigger.patterns, ['https://example.com/*']);
    assert.equal(trigger.enabled, true);
    assert.equal(Object.hasOwn(trigger, 'allowedWorlds'), false);
    assert.deepEqual(trigger.commands, ['hello']);
    const style = newStyle('theme', 'body {}', 'project');
    assert.equal(typeof style.id, 'string');
    assert.equal(style.selected, false);
    assert.equal(style.project, 'project');
});
