import { applyFunctionCodeUpdate } from '../../shared/functionUpdates.js';
import { applyTriggerDefinitionUpdate } from '../../shared/triggerUpdates.js';
import { newStyle } from '../../shared/records.js';

export function applyPendingItemToCollections(item, lambdas, styles, triggers) {
  const incoming = item.incoming;
  const project = item.project || incoming?.project || item.previous?.project || 'default';
  if (item.action === 'delete') {
    if (item.type === 'lambda') {
      const index = lambdas.findIndex((lambda) => lambda.name === item.name && (lambda.project || 'default') === project);
      if (index >= 0) lambdas.splice(index, 1);
    }
    if (item.type === 'style') {
      const index = styles.findIndex((style) => style.name === item.name && (style.project || 'default') === project);
      if (index >= 0) styles.splice(index, 1);
    }
    if (item.type === 'trigger') {
      const index = triggers.findIndex((trigger) => trigger.name === item.name && (trigger.project || 'default') === project);
      if (index >= 0) triggers.splice(index, 1);
    }
    return;
  }
  if (!incoming) return;
  if (item.type === 'lambda') {
    applyFunctionCodeUpdate(lambdas, incoming);
  }
  if (item.type === 'style') {
    const existing = styles.find((style) => style.name === incoming.name && (style.project || 'default') === (incoming.project || 'default'));
    if (existing) existing.css = incoming.css;
    else styles.push(newStyle(incoming.name, incoming.css, incoming.project));
  }
  if (item.type === 'trigger') {
    applyTriggerDefinitionUpdate(triggers, { ...incoming, project: incoming.project || project });
  }
}
