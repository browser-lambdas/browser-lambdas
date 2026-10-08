function parseInput(def, x) {
    const defParts = def.split(/\s+/).slice(1);
    const inputParts = x.match(/(?:[^\s"]+|"[^"]*")+/g)?.slice(1) || [];
    const flags = new Set();
    let positional = [];
    defParts.forEach((part) => {
        if (part.startsWith('--') || part.startsWith('-'))
            flags.add(part);
        else
            positional.push({ key: part, value: null });
    });
    let parsedFlags = [];
    let i = 0;
    let parsingFlags = true;
    for (let j = 0; j < inputParts.length; j++) {
        let part = inputParts[j].replace(/^"|"$/g, '');
        if (parsingFlags && part === '--') {
            parsingFlags = false;
            continue;
        }
        if (parsingFlags && part.startsWith('--')) {
            let next = inputParts[j + 1]?.replace(/^"|"$/g, '');
            if (flags.has(part)) {
                parsedFlags.push({
                    key: part,
                    value: next && !next.startsWith('-') ? next : true
                });
                if (next && !next.startsWith('-'))
                    j++;
            }
        }
        else if (parsingFlags && part.startsWith('-') && part.length > 1) {
            // multiple short flags: -abc
            part
                .slice(1)
                .split('')
                .forEach((f) => {
                let flag = `-${f}`;
                if (flags.has(flag)) {
                    parsedFlags.push({ key: flag, value: true });
                }
            });
        }
        else {
            if (i < positional.length) {
                positional[i].value = part;
                i++;
            }
        }
    }
    // Include any unused flags
    flags.forEach((flag) => {
        if (!parsedFlags.some((f) => f.key === flag)) {
            parsedFlags.push({ key: flag, value: null });
        }
    });
    return [...positional, ...parsedFlags];
}
