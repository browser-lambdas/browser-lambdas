import { log } from './activityLog.js';
import template from '../generated/runtimeTemplate.js';
import { parseArgs } from './parseArgs.js';
export const lambdafy = (func, rawInput, context) => {
    log.dbg(`Preparing function runtime: requestId=${context.requestId}.`);
    const values = {
        PLACEHOLDER_ARGS: JSON.stringify(parseArgs(rawInput)),
        PLACEHOLDER_FUNC: func.toString(),
        __CONNECTION_GRANT__: JSON.stringify(context.connectionGrant ?? null),
        __Q_TOKEN__: JSON.stringify(context.qToken ?? null),
        __A_TOKEN__: JSON.stringify(context.aToken ?? null),
        __HANDSHAKE_ID__: JSON.stringify(context.handshakeId ?? null),
        __SESSION_KEY__: JSON.stringify(context.sessionKey ?? null),
        __REQUEST_ID__: JSON.stringify(context.requestId ?? null),
        __NESTED_DEPTH__: JSON.stringify(context.nestedDepth ?? 0)
    };
    return template.replace(/PLACEHOLDER_ARGS|PLACEHOLDER_FUNC|__CONNECTION_GRANT__|__Q_TOKEN__|__A_TOKEN__|__HANDSHAKE_ID__|__SESSION_KEY__|__REQUEST_ID__|__NESTED_DEPTH__/g, (key) => values[key]);
};
