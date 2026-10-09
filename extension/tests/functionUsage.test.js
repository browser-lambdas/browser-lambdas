import assert from 'node:assert/strict';
import test from 'node:test';
import { functionUsageExample } from '../src/shared/functionUsage.js';

test('usage generates shell and current-tab calls from destructured positional arguments', () => {
    const usage = functionUsageExample({ name: 'do-something', func: 'const { 0: first, 1: second } = ctx.args.all();' });
    assert.equal(usage, '# invoke in shell\n> do-something pos1 pos2\n\n# tabs\nawait ctx.tabs.this().run("do-something pos1 pos2");');
});

test('usage recognizes named flags, aliases and indexed accesses without executing code', () => {
    const usage = functionUsageExample({ name: 'inspect', func: `const args = ctx.args.all({ u: 'user' }); const { user, dryRun } = args; console.log(args[2], args['output'], args[unknown]); throw new Error('never run');` });
    assert.match(usage, /> inspect pos1 pos2 pos3 --user value --dry-run value --output value/);
    assert.doesNotMatch(usage, /--unknown/);
});

test('usage ignores comment/string examples and rest bindings, and handles direct accesses', () => {
    const usage = functionUsageExample({ name: 'inspect', func: `// const { 8: ignored } = ctx.args.all();
const text = "ctx.args.all()[9]";
const { 0: first, ...rest } = ctx.args.all();
console.log(ctx.args.all()[1]);` });
    assert.match(usage, /> inspect pos1 pos2\n/);
    assert.doesNotMatch(usage, /--rest|pos3/);
});

test('usage escapes commands in the JavaScript example and tolerates unfinished code', () => {
    assert.equal(functionUsageExample({ name: 'new-name', func: 'const { unfinished' }), '# invoke in shell\n> new-name\n\n# tabs\nawait ctx.tabs.this().run("new-name");');
    assert.match(functionUsageExample({ name: 'say"hi' }), /run\("say\\"hi"\)/);
});
