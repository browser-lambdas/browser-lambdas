import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitNode, removeNode, findPane, countPanes } from '../src/pages/workspace/paneTree.js';
import { renderReviewPanel } from '../src/pages/workspace/reviewView.js';
import { applyPendingItemToCollections } from '../src/pages/workspace/pendingUpdates.js';

test('nested pane splits and removals preserve sibling drafts and collapse empty groups', () => {
    const first = { type: 'pane', id: 'a', pane: { editable: { name: 'draft' }, changed: true } };
    const second = { type: 'pane', id: 'b' };
    const third = { type: 'pane', id: 'c' };
    let tree = splitNode(first, 'a', 'horizontal', second);
    tree = splitNode(tree, 'b', 'vertical', third);
    assert.equal(countPanes(tree), 3);
    tree = removeNode(tree, 'b');
    assert.equal(countPanes(tree), 2);
    assert.equal(findPane(tree, 'a'), first);
    assert.equal(findPane(tree, 'c'), third);
    tree = removeNode(tree, 'c');
    assert.equal(tree, first);
    assert.equal(removeNode(tree, 'a'), null);
});

test('review rendering escapes incoming code and labels', () => {
    const html = renderReviewPanel({ id: 'batch', project: '<img>', items: [{ type: 'lambda', name: '<script>', action: 'update', previous: { func: 'old' }, incoming: { func: '<script>alert(1)</script>' } }] });
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&lt;img&gt;'));
    assert.equal(html.includes('<script>'), false);
});

test('reviewed updates preserve local grants and delete only within the target project', () => {
    const lambdas = [newFunction('one'), newFunction('two')];
    function newFunction(project) { return { id: project, name: 'hello', project, func: 'old', allowedWorlds: [], urlAllowlistEnabled: true, urlPatterns: [] }; }
    applyPendingItemToCollections({ type: 'lambda', action: 'update', incoming: { name: 'hello', project: 'one', func: 'new', allowedWorlds: ['main'] } }, lambdas, [], []);
    assert.deepEqual(lambdas[0].allowedWorlds, []);
    assert.equal(lambdas[0].func, 'new');
    assert.equal(lambdas[1].func, 'old');
    applyPendingItemToCollections({ type: 'lambda', action: 'delete', name: 'hello', project: 'one' }, lambdas, [], []);
    assert.deepEqual(lambdas.map((item) => item.project), ['two']);
});
