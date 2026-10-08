function globToRegexSource(glob) {
    let source = '';
    for (const character of glob) {
        if (character === '*') source += '.*';
        else if (character === '?') source += '.';
        else source += ('\\^$.*+?()[]{}|'.includes(character) ? `\\${character}` : character);
    }
    return `^${source}$`;
}

export function parseUrlPattern(value) {
    const pattern = String(value).trim();
    if (!pattern) throw new Error('URL patterns cannot be empty.');

    if (pattern.startsWith('/')) {
        const lastSlash = pattern.lastIndexOf('/');
        if (lastSlash > 0) {
            const flags = pattern.slice(lastSlash + 1);
            if (!/^[dgimsuvy]*$/.test(flags)) throw new Error(`Invalid regular expression flags: "${flags}".`);
            return { type: 'regex', source: pattern.slice(1, lastSlash), flags };
        }
    }

    // Accept anchored regexes without slash delimiters as a forgiving input form.
    // The UI documents slash-delimited regexes, but accepting the common /^...$/ form
    // avoids silently treating an intended regex as a literal glob.
    if (pattern.startsWith('^') || pattern.endsWith('$'))
        return { type: 'regex', source: pattern, flags: '' };

    // A bare domain suffix such as *.com is useful when the caller wants to allow
    // every URL on matching domains, not a URL whose entire text ends in ".com".
    const domainGlob = /^\*\.([^/*?]+)$/.exec(pattern);
    if (domainGlob) {
        const domain = domainGlob[1].replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
        return {
            type: 'regex',
            source: `^[a-z][a-z0-9+.-]*:\\/\\/(?:[^/]+\\.)?${domain}(?::\\d+)?(?:[\\/?#]|$)`,
            flags: 'i'
        };
    }

    return { type: 'glob', source: globToRegexSource(pattern), flags: '' };
}

export function matchesUrlPattern(pattern, url) {
    const parsed = parseUrlPattern(pattern);
    return new RegExp(parsed.source, parsed.flags).test(url);
}
