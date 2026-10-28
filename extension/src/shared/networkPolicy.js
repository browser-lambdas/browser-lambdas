export function effectiveNetworkAccess(lambda = {}, project = {}, global = false) {
    return global === true && project.allowNetwork === true && lambda.allowNetwork !== false;
}
