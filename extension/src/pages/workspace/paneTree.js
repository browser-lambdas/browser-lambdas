export function contains(node, id) {
  if (!node) return false;
  if (node.type === 'pane') return node.id === id;
  return node.children.some((child) => contains(child, id));
}

export function countPanes(node) {
  if (!node) return 0;
  if (node.type === 'pane') return 1;
  return node.children.reduce((total, child) => total + countPanes(child), 0);
}

export function findPane(node, id) {
  if (!node) return null;
  if (node.type === 'pane') return node.id === id ? node : null;
  for (const child of node.children) {
    const found = findPane(child, id);
    if (found) return found;
  }
  return null;
}

export function splitNode(node, target, direction, freshPane) {
  if (node.type === 'pane') {
    return node.id === target ? { type: 'group', direction, sizes: [50, 50], children: [node, freshPane] } : node;
  }
  const index = node.children.findIndex((child) => contains(child, target));
  if (index === -1) return node;
  return {
    ...node,
    children: node.children.map((child, childIndex) => (childIndex === index ? splitNode(child, target, direction, freshPane) : child))
  };
}

export function removeNode(node, id) {
  if (node.type === 'pane') return node.id === id ? null : node;
  const children = node.children.map((child) => removeNode(child, id)).filter(Boolean);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: normalizeSizes(node.sizes, children.length) };
}

export function normalizeSizes(sizes = [], count) {
  if (sizes.length === count) return sizes;
  return Array.from({ length: count }, () => 100 / count);
}
