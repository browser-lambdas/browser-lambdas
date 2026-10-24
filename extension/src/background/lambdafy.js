import { log } from './activityLog.js';
import template from '../generated/runtimeTemplate.js';
import { parseArgs } from './parseArgs.js';
export const lambdafy = (func, rawInput, context) => {
    log.dbg(`Preparing function runtime: requestId=${context.requestId}.`);
    const userFnStr = func.toString();
    const parsedArgs = parseArgs(rawInput);
    let templateStr = template
        .replace('PLACEHOLDER_ARGS', JSON.stringify(parsedArgs))
        .replace('PLACEHOLDER_FUNC', func.toString())
        .replace('__Q_TOKEN__', JSON.stringify(context.qToken))
        .replace('__A_TOKEN__', JSON.stringify(context.aToken))
        .replace('__HANDSHAKE_ID__', JSON.stringify(context.handshakeId))
        .replace('__SESSION_KEY__', JSON.stringify(context.sessionKey))
        .replace('__REQUEST_ID__', JSON.stringify(context.requestId ?? null))
        .replace('__NESTED_DEPTH__', JSON.stringify(context.nestedDepth ?? 0));
    if (templateStr.at(-1) === ';') {
        templateStr = templateStr.slice(0, -1);
    }
    return templateStr;
};
