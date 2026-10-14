// Website adapter for the shared extension shell. State lasts for this visit.
let demoHistory = [];
let demoBounds;
const getLambdas = async () => [{ name: 'hello' }, { name: 'vi-nav on' }, { name: 'vi-nav off' }];
const getInputHistory = async () => [...demoHistory];
const setInputHistory = async (history) => { demoHistory = [...history]; };
const getSelectedShellTheme = async () => null;
const getShellPosition = async () => demoBounds || {
	x: Math.min(24, innerWidth * 0.04),
	y: Math.max(16, innerHeight - Math.min(360, innerHeight * 0.65) - 24),
	width: Math.min(600, innerWidth * 0.92),
	height: Math.min(360, innerHeight * 0.65),
};
const setShellPosition = async (bounds) => { demoBounds = bounds; };

function demoPrint(...values) {
	const output = document.getElementById('demo-shell-outputs');
	if (!output) return;
	const line = document.createElement('p');
	line.dataset.testid = 'demo-shell-output-line';
	line.textContent = values.map(String).join(' ');
	output.appendChild(line);
	const body = document.getElementById('demo-shell-body');
	body.scrollTop = body.scrollHeight;
}

// Only compile our curated snippet, never text entered at the command prompt.
// Like extension lambdas, snippets are bodies inside an async runtime.
const demoSources = {
	hello: document.getElementById('demo-hello-source').textContent,
	'vi-nav': document.getElementById('demo-vi-nav-source').textContent,
};
const DemoAsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const demoCommands = {
	hello: new DemoAsyncFunction('ctx', 'console', demoSources.hello),
	'vi-nav': new DemoAsyncFunction('ctx', 'console', demoSources['vi-nav']),
};

async function executeCommand(command) {
	const name = command.split(/\s+/, 1)[0];
	if (!Object.hasOwn(demoCommands, name)) {
		demoPrint(`Unknown command: ${name}. Try hello or vi-nav on (or clear to clear the terminal).`);
		return;
	}
	const original = parseArgs(command);
	const ctx = { args: { all: (aliases = {}) => {
		const result = {};
		const camelCase = key => key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
		for (const key in original) {
			const clean = key.startsWith('no-') ? key.slice(3) : key;
			result[camelCase(aliases[clean] ?? clean)] = key.startsWith('no-') ? false : original[key];
		}
		return result;
	} } };
	try { await demoCommands[name](ctx, { log: demoPrint, warn: demoPrint }); }
	catch (error) { demoPrint(`Error: ${error.message}`); }
}

let demoOpening = false;
function enableDemoInteractions(shell) {
	if (shell.dataset.demoInteractions) return;
	shell.dataset.demoInteractions = 'true';
	const bind = (handle, direction) => {
		let interaction;
		handle.style.touchAction = 'none';
		handle.addEventListener('pointerdown', event => {
			if (event.button !== 0 || event.target.closest('button, .demo-shell-controls')) return;
			event.preventDefault();
			interaction = { id: event.pointerId, x: event.clientX, y: event.clientY, bounds: shell.getBoundingClientRect() };
			handle.setPointerCapture(event.pointerId);
		});
		handle.addEventListener('pointermove', event => {
			if (!interaction || interaction.id !== event.pointerId) return;
			const { bounds, x, y } = interaction;
			const dx = event.clientX - x, dy = event.clientY - y;
			let left = bounds.left, top = bounds.top, width = bounds.width, height = bounds.height;
			const minWidth = Math.min(320, innerWidth), minHeight = Math.min(220, innerHeight);
			if (!direction) { left += dx; top += dy; }
			else {
				if (direction.includes('right')) width = Math.max(minWidth, bounds.width + dx);
				if (direction.includes('bottom')) height = Math.max(minHeight, bounds.height + dy);
				if (direction.includes('left')) { width = Math.max(minWidth, bounds.width - dx); left = bounds.right - width; }
				if (direction.includes('top')) { height = Math.max(minHeight, bounds.height - dy); top = bounds.bottom - height; }
			}
			width = Math.min(width, innerWidth); height = Math.min(height, innerHeight);
			left = Math.max(0, Math.min(left, innerWidth - width));
			top = Math.max(0, Math.min(top, innerHeight - height));
			Object.assign(shell.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
			void setShellPosition({ x: left, y: top, width, height });
		});
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
			handle.addEventListener(type, () => { interaction = null; });
		}
	};
	bind(shell.querySelector('#demo-shell-titlebar'), '');
	for (const edge of shell.querySelectorAll('.demo-shell-resize-edge')) {
		const direction = edge.dataset.direction;
		// Keep corner handles inside the shell's rounded, clipped border.
		if (direction.includes('-')) {
			for (const side of direction.split('-')) edge.style[side] = '4px';
		}
		bind(edge, direction);
	}
}

async function openDemoTerminal() {
	if (demoOpening) return;
	demoOpening = true;
	try {
		await showShell(null);
		const shell = document.getElementById('browser-lambdas-demo-terminal');
		enableDemoInteractions(shell);
		shell.setAttribute('role', 'region');
		shell.setAttribute('aria-label', 'Demo terminal');
		document.getElementById('demo-shell-input').setAttribute('aria-label', 'Demo command');
		document.getElementById('demo-shell-input').focus();
	} finally { demoOpening = false; }
}

window.addEventListener('keydown', (event) => {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
		event.preventDefault();
		event.stopImmediatePropagation();
		void openDemoTerminal();
	}
}, { capture: true });
document.addEventListener('DOMContentLoaded', () => {
	for (const button of document.querySelectorAll('[data-open-demo]')) {
		button.addEventListener('click', () => void openDemoTerminal());
	}
});
