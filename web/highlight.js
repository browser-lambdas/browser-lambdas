// A small tokenizer for our documentation examples, not a full language parser.
// Unrecognized syntax stays plain text; strings/comments are consumed as a unit.
const codeTokenRules = {
	javascript: [
		['comment', /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/],
		['string', /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/],
		['keyword', /\b(?:async|await|break|const|continue|else|export|false|for|function|if|import|in|let|new|null|of|return|throw|true|try|undefined|var|while)\b/],
		['number', /\b\d+(?:\.\d+)?\b/],
		['function', /\b[A-Za-z_$][\w$]*(?=\s*\()/],
	],
	shell: [
		['comment', /#[^\n]*/],
		['string', /"(?:\\[\s\S]|[^"\\])*"|'[^']*'/],
		['keyword', /(?:^|[ \t])(?:@[\w-]+|--?[A-Za-z][\w-]*)/],
		['function', /^(?:\$[ \t]+)?[A-Za-z][\w-]*/],
		['number', /\b\d+\b/],
	],
	yaml: [
		['comment', /#[^\n]*/],
		['string', /"(?:\\[\s\S]|[^"\\])*"|'(?:''|[^'])*'/],
		['property', /\b[\w-]+(?=\s*:)/],
		['keyword', /\b(?:true|false|null)\b/],
		['number', /\b\d+(?:\.\d+)?\b/],
	],
	toml: [
		['comment', /#[^\n]*/],
		['string', /"(?:\\[\s\S]|[^"\\])*"|'[^']*'/],
		['property', /^\s*\[[^\]\n]+\]|\b[\w-]+(?=\s*=)/],
		['keyword', /\b(?:true|false)\b/],
		['number', /\b\d+(?:\.\d+)?\b/],
	],
};

function tokenizeCode(source, language) {
	const rules = codeTokenRules[language];
	if (!rules) return [{ text: source }];
	const pattern = new RegExp(rules.map(([type, regex]) => `(?<${type}>${regex.source})`).join('|'), 'gm');
	const tokens = [];
	let end = 0;
	for (const match of source.matchAll(pattern)) {
		if (match.index > end) tokens.push({ text: source.slice(end, match.index) });
		const type = rules.find(([name]) => match.groups[name] !== undefined)[0];
		tokens.push({ text: match[0], type });
		end = match.index + match[0].length;
	}
	if (end < source.length) tokens.push({ text: source.slice(end) });
	return tokens;
}

function highlightCodeBlocks() {
	for (const code of document.querySelectorAll('pre > code[data-language]')) {
		const fragment = document.createDocumentFragment();
		for (const { text, type } of tokenizeCode(code.textContent, code.dataset.language)) {
			const node = type ? document.createElement('span') : document.createTextNode(text);
			if (type) {
				node.className = `syntax-${type}`;
				node.textContent = text;
			}
			fragment.appendChild(node);
		}
		code.replaceChildren(fragment);
	}
}
