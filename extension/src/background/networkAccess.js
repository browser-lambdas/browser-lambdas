import { getLambdas } from './getLambdas.js';
import { getProjectSettings } from '../shared/projectPolicy.js';
import { effectiveNetworkAccess } from '../shared/networkPolicy.js';

export const ALLOW_NETWORK_KEY = 'local_storage_key_allow_network';

export async function loadNetworkAccessPolicy() {
    const [lambdas, projects, stored] = await Promise.all([
        getLambdas(), getProjectSettings(), chrome.storage.local.get(ALLOW_NETWORK_KEY)
    ]);
    return (callers) => {
        if (!callers?.length) throw new Error('Network access blocked: the calling function could not be verified.');
        for (const caller of callers) {
            const matches = lambdas.filter((lambda) => (caller.id == null || lambda.id === caller.id)
                && lambda.name === caller.name && (lambda.project || 'default') === caller.project);
            if (matches.length !== 1) throw new Error('Network access blocked: the calling function could not be verified.');
            const project = Object.hasOwn(projects, caller.project) ? projects[caller.project].functions || {} : {};
            if (!effectiveNetworkAccess(matches[0], project, stored[ALLOW_NETWORK_KEY])) {
                throw new Error(`Network rules are disabled for ${JSON.stringify(caller.name)}. Check global, project and function network permissions.`);
            }
        }
    };
}

export async function authorizeNetworkInvocation(invocation) {
    (await loadNetworkAccessPolicy())(invocation?.callers);
}
