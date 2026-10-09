export const parseArgs = (input) => {
    const result = {};
    // Match quoted strings, --flags=..., or plain args. The command name is
    // part of the shell input but is not an argument passed to the lambda.
    const parts = input.match(/--[^\s=]+="[^"]*"|"(?:[^"]*)"|\S+/g) || [];
    let i = 0;
    let positionalIndex = 0;
    if (parts.length > 0)
        i = 1;
    let parsingFlags = true;
    while (i < parts.length) {
        let part = parts[i];
        if (parsingFlags && part === '--') {
            parsingFlags = false;
            i++;
            continue;
        }
        // --key=value (supports quoted or unquoted)
        if (parsingFlags && part.startsWith('--') && part.includes('=')) {
            const [key, ...rest] = part.slice(2).split('=');
            let value = rest.join('=');
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }
            result[key] = value;
            i++;
            continue;
        }
        // --key value
        if (parsingFlags && part.startsWith('--')) {
            const key = part.slice(2);
            const next = parts[i + 1];
            if (next && !next.startsWith('-')) {
                let value = next;
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1);
                }
                result[key] = value;
                i += 2;
            }
            else {
                result[key] = true;
                i++;
            }
            continue;
        }
        // short flags like -a or -abc
        if (parsingFlags && part.startsWith('-') && !part.startsWith('--')) {
            const flags = part.slice(1);
            if (flags.length === 1 && parts[i + 1] && !parts[i + 1].startsWith('-')) {
                result[flags] = parts[i + 1].replace(/^"|"$/g, '');
                i += 2;
                continue;
            }
            flags.split('').forEach((char) => {
                result[char] = true;
            });
            i++;
            continue;
        }
        // quoted positional
        if (part.startsWith('"') && part.endsWith('"')) {
            result[positionalIndex++] = part.slice(1, -1);
            i++;
            continue;
        }
        // plain positional
        result[positionalIndex++] = part;
        i++;
    }
    return result;
};
