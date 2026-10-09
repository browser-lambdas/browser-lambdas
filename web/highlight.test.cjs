const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(readFileSync(join(__dirname, 'highlight.js'), 'utf8'), context);
const tokenize = context.tokenizeCode;

test('preserves whitespace and code across all supported languages', () => {
	for (const [language, code] of Object.entries({
		javascript: 'const a = "https://example.com/#x";\n// await 12\nawait fn(a, 42);\n',
		shell: '# comment\nnpm install -g baah\necho \'<img src=x onerror=alert(1)>\'\n',
		yaml: 'patterns:\n  - "https://example.com/#x"\ncommands:\n  - "hello"\n',
		toml: '[project]\nname = "# not a comment"\nport = 4455\n',
		plain: '.\n└── functions/hello-world.js\n',
	})) {
		assert.equal(tokenize(code, language).map(t => t.text).join(''), code);
	}
});

test('keeps comments and strings intact instead of highlighting their contents', () => {
	const tokens = tokenize('"https://example.com/#test" // const 42\nawait fn(12)', 'javascript');
	assert.equal(tokens[0].type, 'string');
	assert.equal(tokens.find(t => t.type === 'comment').text, '// const 42');
	assert.equal(tokens.find(t => t.type === 'keyword').text, 'await');
	assert.equal(tokens.find(t => t.type === 'function').text, 'fn');
	assert.equal(tokens.find(t => t.type === 'number').text, '12');
});
