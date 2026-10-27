// Best-effort static hints only: never evaluate the user's function to build help.
export function functionUsageExample(item) {
    const source = String(item.func || '');
    const tokens = [...source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\d+|[^\s]/g)]
        .map((match) => match[0]).filter((token) => !token.startsWith('//') && !token.startsWith('/*'));
    const keys = new Set();
    const bindings = new Set();
    const readKey = (token) => {
        const key = /^(?:"|')/.test(token || '') ? token.slice(1, -1) : token;
        if (/^(?:\d+|[A-Za-z_$][\w$-]*)$/.test(key || '')) keys.add(key);
    };
    const destructure = (start, end) => {
        let depth = 0;
        let expectKey = true;
        for (let i = start; i < end; i++) {
            const token = tokens[i];
            if (!depth && expectKey) {
                if (token !== '.') readKey(token);
                expectKey = false;
            }
            if (['{', '[', '('].includes(token)) depth++;
            if (['}', ']', ')'].includes(token)) depth--;
            if (!depth && token === ',') expectKey = true;
        }
    };
    for (let i = 0; i < tokens.length - 5; i++) {
        if (tokens.slice(i, i + 6).join(' ') !== 'ctx . args . all (') continue;
        let end = i + 6;
        let depth = 1;
        while (end < tokens.length && depth) {
            if (tokens[end] === '(') depth++;
            if (tokens[end] === ')') depth--;
            end++;
        }
        if (tokens[i - 1] === '=') {
            if (tokens[i - 2] === '}') {
                let start = i - 3;
                let braces = 1;
                while (start >= 0 && braces) {
                    if (tokens[start] === '}') braces++;
                    if (tokens[start] === '{') braces--;
                    start--;
                }
                if (!braces) destructure(start + 2, i - 2);
            } else if (/^[A-Za-z_$][\w$]*$/.test(tokens[i - 2] || '')) bindings.add(tokens[i - 2]);
        }
        if (tokens[end] === '.' || (tokens[end] === '[' && /^(?:\d+|["'])/.test(tokens[end + 1] || ''))) readKey(tokens[end + 1]);
    }
    for (let i = 0; i < tokens.length; i++) {
        if (!bindings.has(tokens[i]) || tokens[i - 1] === '.') continue;
        if (tokens[i + 1] === '.' || (tokens[i + 1] === '[' && /^(?:\d+|["'])/.test(tokens[i + 2] || ''))) readKey(tokens[i + 2]);
        if (tokens[i - 1] === '=' && tokens[i - 2] === '}') {
            let start = i - 3;
            while (start >= 0 && tokens[start] !== '{') start--;
            if (start >= 0) destructure(start + 1, i - 2);
        }
    }
    const indexes = [...keys].filter((key) => /^\d+$/.test(key)).map(Number);
    const positional = Array.from({ length: Math.min(32, indexes.length ? Math.max(...indexes) + 1 : 0) }, (_, i) => `pos${i + 1}`);
    const flags = [...keys].filter((key) => !/^\d+$/.test(key)).map((key) => {
        const flag = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        return `${flag.length === 1 ? '-' : '--'}${flag} value`;
    });
    const name = String(item.name || '').trim() || 'do-something';
    const command = [name.split(/\s+/)[0], ...positional, ...flags].join(' ');
    return `# invoke in terminal\n> ${command}\n\n# tabs\nawait ctx.tabs.this().run(${JSON.stringify(command)});`;
}
