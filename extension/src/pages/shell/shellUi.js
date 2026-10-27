const SHELL_ID = 'browser-lambdas-shell';
const OUTPUTS_ID = 'shell-outputs';
const INPUT_WRAP_ID = 'shell-input-wrap';
const INPUT_ID = 'shell-input';
const SUGGESTIONS_ID = 'shell-suggestions';
const TITLEBAR_ID = 'shell-titlebar';
const POSITION_MENU_ID = 'shell-position-menu';
const MAX_HISTORY = 50;
const DEFAULT_STYLE_ID = 'browser-lambdas-default-style';
const USER_STYLE_ID = 'browser-lambdas-user-style';
const BODY_ID = 'shell-body';
const SHELL_CODE_BG = '#160e16';
const SHELL_FONT_STACK = "'Fira Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
window.clearShellUiHistory = () => {};
let shellThemeReadId = 0;
async function refreshShellPrompt() {
    const prompt = typeof getShellPrompt === 'function' ? await getShellPrompt() : '>';
    const label = document.querySelector(`#${INPUT_WRAP_ID} > span`);
    if (label) label.textContent = `${prompt} `;
}
async function refreshShellTheme() {
    const readId = ++shellThemeReadId;
    try {
        const theme = await (window.getAllowedShellTheme ? window.getAllowedShellTheme() : getSelectedShellTheme());
        if (readId !== shellThemeReadId || !document.getElementById(DEFAULT_STYLE_ID)) return;
        document.getElementById(USER_STYLE_ID)?.remove();
        if (theme?.css) {
            const userStyle = document.createElement('style');
            userStyle.id = USER_STYLE_ID;
            userStyle.textContent = theme.css;
            document.head.appendChild(userStyle);
        }
    } catch (error) {
        if (readId !== shellThemeReadId) return;
        document.getElementById(USER_STYLE_ID)?.remove();
        console.warn('Could not apply terminal style:', error);
    }
}
const showShell = async (tabId, useHistory = false) => {
    let shellContainer = document.getElementById(SHELL_ID);
    const lambdas = await getLambdas();
    const commands = lambdas.map((l) => {
        const parts = l.name.split(/\s+/);
        return {
            tool: parts[0],
            args: parts.slice(1),
            flags: extractFlags(l.name)
        };
    });
    let previousLogs = [];
    if (useHistory && tabId != null) {
        previousLogs = await getTabShellHistory(tabId);
    }
    if (!shellContainer) {
        shellContainer = document.createElement('div');
        shellContainer.id = SHELL_ID;
        shellContainer.className = 'shell-container';
        shellContainer.dataset.testid = 'shell';
        let { x, y, width, height } = await getShellPosition();
        document.body.appendChild(shellContainer);
        const shellElement = shellContainer;
        const defaultCSS = `
.shell-container {
	position: fixed;
	top: ${y}px;
	left: ${x}px;
	width: ${width}px;
	height: ${height}px;
	background: ${SHELL_CODE_BG};
	color: #f7f5f8;
	display: flex;
	flex-direction: column;
	border: 1px solid #2d1b2e;
	border-radius: 24px;
	z-index: 9999;
	font-family: ${SHELL_FONT_STACK};
	font-weight: 400;
	font-smooth: always;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
	font-size: 14px;
	line-height: 1.3;
	padding: 0;
	box-sizing: border-box;
	overflow: hidden;
}
.shell-titlebar {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	height: 40px;
	padding: 0 12px;
	border-bottom: 1px solid #2d1b2e;
	cursor: grab;
	z-index: 2;
}
.shell-controls {
	display: flex;
	align-items: center;
	gap: 6px;
	position: relative;
}
.shell-icon-button {
	width: 26px;
	height: 26px;
	border: none;
	background: transparent;
	color: #f7f5f8;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	border-radius: 6px;
	font-size: 20px;
	line-height: 1;
}
.shell-icon-button:hover {
	background: #2d1b2e;
}
.shell-icon-button svg {
	width: 16px;
	height: 16px;
	stroke: currentColor;
}
.shell-position-menu {
	position: absolute;
	top: calc(100% + 6px);
	right: 0;
	min-width: 160px;
	display: none;
	flex-direction: column;
	padding: 6px;
	border-radius: 10px;
	border: 1px solid #2d1b2e;
	background: ${SHELL_CODE_BG};
	box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
	z-index: 6;
}
.shell-position-menu button {
	width: 100%;
	text-align: left;
	padding: 8px 10px;
	border: none;
	background: transparent;
	color: #f7f5f8;
	font: inherit;
	cursor: pointer;
	border-radius: 6px;
}
.shell-position-menu button:hover {
	background: #2d1b2e;
}
.shell-body {
	flex: 1;
	overflow-y: auto;
	overflow-x: hidden;
	padding: 12px;
	scrollbar-width: thin;
	scrollbar-color: #90eac4 transparent;
}
.shell-body::-webkit-scrollbar {
	width: 6px;
	height: 6px;
}
.shell-body::-webkit-scrollbar-thumb {
	background-color: #90eac4;
	border-radius: 9999px;
}
.shell-body::-webkit-scrollbar-track {
	background-color: transparent;
}
.shell-outputs {
	padding: 0 2px 0 0;
	background: ${SHELL_CODE_BG};
}
.shell-outputs p {
	margin: 0;
	font-family: inherit;
	font-weight: inherit;
	font-size: 14px;
	line-height: 1.3;
	white-space: pre-wrap;
}
.shell-input-wrap {
	position: relative;
	display: flex;
	align-items: center;
	padding: 0;
	margin-bottom: 6px;
	background: ${SHELL_CODE_BG};
}
.shell-input-wrap > span {
	max-width: 50%;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: #ddffd0;
	margin-right: 1ch;
	font: inherit;
	line-height: inherit;
}
.shell-input {
	flex: 1;
	min-width: 0;
	border: none;
	outline: none;
	background: ${SHELL_CODE_BG};
	color: #f7f5f8;
	font: inherit;
	line-height: inherit;
	padding: 0;
}
.shell-suggestions {
	position: fixed;
	left: 0;
	top: 0;
	display: none;
	max-height: 140px;
	overflow-y: auto;
	overflow-x: hidden;
	background: ${SHELL_CODE_BG};
	color: #f7f5f8;
	font-family: inherit;
	font-weight: inherit;
	padding: 5px;
	z-index: 4;
	box-sizing: border-box;
	border: 1px solid #2d1b2e;
	border-radius: 8px;
}
.shell-suggestion {
	padding: 4px 6px;
	border-radius: 4px;
	cursor: pointer;
}
.shell-suggestion.active,
.shell-suggestion:hover {
	background: #2d1b2e;
}
.shell-resize-edge {
	position: absolute;
	background: transparent;
	z-index: 4;
}
.shell-resize-edge[data-direction='top'] {
	top: -4px;
	left: 8px;
	right: 8px;
	height: 8px;
	cursor: ns-resize;
}
.shell-resize-edge[data-direction='right'] {
	top: 8px;
	right: -4px;
	bottom: 8px;
	width: 8px;
	cursor: ew-resize;
}
.shell-resize-edge[data-direction='bottom'] {
	bottom: -4px;
	left: 8px;
	right: 8px;
	height: 8px;
	cursor: ns-resize;
}
.shell-resize-edge[data-direction='left'] {
	top: 8px;
	left: -4px;
	bottom: 8px;
	width: 8px;
	cursor: ew-resize;
}
.shell-resize-edge[data-direction='top-left'] {
	top: -4px;
	left: -4px;
	width: 12px;
	height: 12px;
	cursor: nwse-resize;
}
.shell-resize-edge[data-direction='top-right'] {
	top: -4px;
	right: -4px;
	width: 12px;
	height: 12px;
	cursor: nesw-resize;
}
.shell-resize-edge[data-direction='bottom-right'] {
	right: -4px;
	bottom: -4px;
	width: 12px;
	height: 12px;
	cursor: nwse-resize;
}
.shell-resize-edge[data-direction='bottom-left'] {
	left: -4px;
	bottom: -4px;
	width: 12px;
	height: 12px;
	cursor: nesw-resize;
}`.trim();
        const defaultStyle = document.createElement('style');
        defaultStyle.id = DEFAULT_STYLE_ID;
        defaultStyle.textContent = defaultCSS;
        document.head.appendChild(defaultStyle);
        await refreshShellTheme();
        const titleBar = document.createElement('div');
        titleBar.id = TITLEBAR_ID;
        titleBar.className = 'shell-titlebar';
        titleBar.dataset.testid = 'shell-titlebar';
        const controls = document.createElement('div');
        controls.className = 'shell-controls';
        const positionButton = document.createElement('button');
        positionButton.type = 'button';
        positionButton.className = 'shell-icon-button';
        positionButton.setAttribute('aria-label', 'Set terminal position');
        positionButton.setAttribute('data-testid', 'shell-position-button');
        positionButton.innerHTML = getPositionIconSvg();
        controls.appendChild(positionButton);
        const positionMenu = document.createElement('div');
        positionMenu.id = POSITION_MENU_ID;
        positionMenu.className = 'shell-position-menu';
        positionMenu.dataset.testid = 'shell-position-menu';
        controls.appendChild(positionMenu);
        for (const placement of ['left', 'right', 'bottom', 'top']) {
            const option = document.createElement('button');
            option.type = 'button';
            option.textContent = `Place on ${placement}`;
            option.addEventListener('click', () => {
                applyShellPlacement(shellElement, placement);
                positionMenu.style.display = 'none';
            });
            positionMenu.appendChild(option);
        }
        positionButton.addEventListener('click', (event) => {
            event.stopPropagation();
            positionMenu.style.display = positionMenu.style.display === 'flex' ? 'none' : 'flex';
        });
        document.addEventListener('mousedown', (event) => {
            if (!controls.contains(event.target)) {
                positionMenu.style.display = 'none';
            }
        });
        for (const interactiveElement of [positionButton, positionMenu]) {
            interactiveElement.addEventListener('mousedown', (event) => {
                event.stopPropagation();
            });
        }
        titleBar.appendChild(controls);
        shellContainer.appendChild(titleBar);
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = '×';
        closeButton.className = 'shell-icon-button';
        closeButton.setAttribute('aria-label', 'Close terminal');
        closeButton.style.fontSize = '34px';
        closeButton.addEventListener('click', removeShell);
        closeButton.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });
        controls.appendChild(closeButton);
        const shellBody = document.createElement('div');
        shellBody.id = BODY_ID;
        shellBody.className = 'shell-body';
        shellContainer.appendChild(shellBody);
        const outputs = document.createElement('div');
        outputs.id = OUTPUTS_ID;
        outputs.className = 'shell-outputs';
        outputs.dataset.testid = 'shell-outputs';
        shellBody.appendChild(outputs);
        const inputWrap = document.createElement('div');
        inputWrap.id = INPUT_WRAP_ID;
        inputWrap.className = 'shell-input-wrap';
        inputWrap.dataset.testid = 'shell-input-wrap';
        shellBody.appendChild(inputWrap);
        const promptLabel = document.createElement('span');
        inputWrap.appendChild(promptLabel);
        await refreshShellPrompt();
        const input = document.createElement('input');
        input.type = 'text';
        input.id = INPUT_ID;
        input.className = 'shell-input';
        input.dataset.testid = 'shell-input';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'none');
        inputWrap.appendChild(input);
        shellBody.addEventListener('click', (event) => {
            if (!event.target.closest('button, input, select, textarea, a')) {
                const selection = window.getSelection();
                if (!selection || selection.isCollapsed)
                    input.focus();
            }
        });
        const suggestions = document.createElement('div');
        suggestions.id = SUGGESTIONS_ID;
        suggestions.className = 'shell-suggestions';
        suggestions.dataset.testid = 'shell-suggestions';
        inputWrap.appendChild(suggestions);
        suggestions.addEventListener('mousedown', (event) => {
            const option = event.target.closest('.shell-suggestion');
            if (!option) return;
            event.preventDefault();
            applySuggestion(input, suggestions, option.dataset.completion || '');
        });
        if (useHistory && previousLogs.length > 0) {
            for (let line of previousLogs) {
                let p = document.createElement('p');
                p.textContent = line;
                p.style.margin = '0';
                p.style.font = 'inherit';
                p.style.lineHeight = 'inherit';
                p.dataset.testid = 'shell-output-line';
                outputs.appendChild(p);
            }
            shellBody.scrollTop = shellBody.scrollHeight;
        }
        const resizeDirections = [
            'top',
            'right',
            'bottom',
            'left',
            'top-left',
            'top-right',
            'bottom-right',
            'bottom-left'
        ];
        for (const direction of resizeDirections) {
            const edge = document.createElement('div');
            edge.id = `shell-resize-${direction}`;
            edge.className = 'shell-resize-edge';
            edge.dataset.direction = direction;
            edge.dataset.testid = `shell-resize-${direction}`;
            shellContainer.appendChild(edge);
        }
        const history = await getInputHistory();
        let historyIndex = history.length;
        window.clearShellUiHistory = async () => {
            outputs.replaceChildren();
            previousLogs = [];
            history.splice(0, history.length);
            historyIndex = 0;
            input.value = '';
            suggestions.replaceChildren();
            suggestions.style.display = 'none';
            if (tabId != null) await updateTabShellHistory(tabId, previousLogs);
            await setInputHistory([]);
        };
        input.addEventListener('input', () => updateSuggestions(input, suggestions, commands, history));
        input.addEventListener('keydown', async (event) => {
            if (!event.isTrusted)
                return;
            if (event.key === 'Enter') {
                event.preventDefault();
                const typedCmd = input.value.trim();
                if (typedCmd) {
                    const isClearCommand = typedCmd === 'clear' || typedCmd === '.clear';
                    history.push(typedCmd);
                    if (history.length > MAX_HISTORY)
                        history.shift();
                    await setInputHistory(history);
                    historyIndex = history.length;
                    if (isClearCommand) {
                        outputs.replaceChildren();
                        previousLogs = [];
                        if (useHistory && tabId != null) {
                            await updateTabShellHistory(tabId, previousLogs);
                        }
                        input.value = '';
                        suggestions.innerHTML = '';
                        suggestions.style.display = 'none';
                        return;
                    }
                    let cmdLine = document.createElement('p');
                    cmdLine.textContent = `${promptLabel.textContent}${typedCmd}`;
                    cmdLine.style.margin = '0';
                    cmdLine.style.font = 'inherit';
                    cmdLine.style.lineHeight = 'inherit';
                    cmdLine.dataset.testid = 'shell-output-line';
                    outputs.appendChild(cmdLine);
                    shellBody.scrollTop = shellBody.scrollHeight;
                    executeCommand(typedCmd);
                }
                input.value = '';
                suggestions.innerHTML = '';
                suggestions.style.display = 'none';
            }
            else if (event.key === 'Escape') {
                event.preventDefault();
                if (suggestions.style.display === 'block') {
                    suggestions.replaceChildren();
                    suggestions.style.display = 'none';
                    input.removeAttribute('data-suggestion');
                    return;
                }
                removeShell();
            }
            else if (event.key === 'Tab') {
                event.preventDefault();
                const option = suggestions.querySelector('.shell-suggestion.active');
                if (option) applySuggestion(input, suggestions, option.dataset.completion || '');
            }
            else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (suggestions.style.display === 'block') selectSuggestion(suggestions, -1);
                else if (historyIndex > 0)
                    input.value = history[--historyIndex];
            }
            else if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (suggestions.style.display === 'block') selectSuggestion(suggestions, 1);
                else if (historyIndex < history.length) {
                    historyIndex++;
                    input.value = historyIndex === history.length ? '' : history[historyIndex];
                }
            }
        });
        input.focus();
        // Observe new output logs 🧠
        const observer = new MutationObserver(async (mutations) => {
            for (const m of mutations) {
                for (const node of Array.from(m.addedNodes)) {
                    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'P') {
                        previousLogs.push(node.textContent ?? '');
                    }
                }
            }
            if (useHistory && tabId != null) {
                await updateTabShellHistory(tabId, previousLogs);
            }
        });
        observer.observe(outputs, { childList: true });
    }
};
function removeShell() {
    const shell = document.getElementById(SHELL_ID);
    if (shell)
        shell.remove();
    document.getElementById(DEFAULT_STYLE_ID)?.remove();
    document.getElementById(USER_STYLE_ID)?.remove();
}
function applyShellPlacement(shell, placement) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const margin = 20;
    if (placement === 'left') {
        shell.style.top = `${margin}px`;
        shell.style.left = `${margin}px`;
        shell.style.width = `${Math.max(320, Math.floor(width * 0.35))}px`;
        shell.style.height = `${Math.max(220, height - margin * 2)}px`;
    }
    else if (placement === 'right') {
        const nextWidth = Math.max(320, Math.floor(width * 0.35));
        shell.style.top = `${margin}px`;
        shell.style.left = `${Math.max(margin, width - nextWidth - margin)}px`;
        shell.style.width = `${nextWidth}px`;
        shell.style.height = `${Math.max(220, height - margin * 2)}px`;
    }
    else if (placement === 'bottom') {
        const nextHeight = Math.max(220, Math.floor(height * 0.4));
        shell.style.top = `${Math.max(margin, height - nextHeight - margin)}px`;
        shell.style.left = `${margin}px`;
        shell.style.width = `${Math.max(320, width - margin * 2)}px`;
        shell.style.height = `${nextHeight}px`;
    }
    else {
        shell.style.top = `${margin}px`;
        shell.style.left = `${margin}px`;
        shell.style.width = `${Math.max(320, width - margin * 2)}px`;
        shell.style.height = `${Math.max(220, Math.floor(height * 0.4))}px`;
    }
    shell.style.transform = 'none';
    persistShellBounds(shell, margin, margin);
}
function getPositionIconSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M15 3v18"></path><path d="m10 15-3-3 3-3"></path></svg>`;
}
function persistShellBounds(shell, fallbackX, fallbackY) {
    setShellPosition({
        x: parseInt(shell.style.left, 10) || fallbackX,
        y: parseInt(shell.style.top, 10) || fallbackY,
        width: parseInt(shell.style.width, 10) || shell.offsetWidth,
        height: parseInt(shell.style.height, 10) || shell.offsetHeight
    });
}
function makeDraggable(shell, handle) {
    let offsetX = 0, offsetY = 0, isDragging = false;
    handle.addEventListener('mousedown', (event) => {
        isDragging = true;
        offsetX = event.clientX - shell.getBoundingClientRect().left;
        offsetY = event.clientY - shell.getBoundingClientRect().top;
        handle.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (event) => {
        if (!isDragging)
            return;
        shell.style.left = event.clientX - offsetX + 'px';
        shell.style.top = event.clientY - offsetY + 'px';
        shell.style.transform = 'none';
        persistShellBounds(shell, event.clientX - offsetX, event.clientY - offsetY);
    });
    document.addEventListener('mouseup', () => {
        isDragging = false;
        handle.style.cursor = 'grab';
    });
}
function makeResizable(shell) {
    let isResizing = false, activeDirection = '', startX, startY, startW, startH, startLeft, startTop;
    const minWidth = 320;
    const minHeight = 220;
    const edges = shell.querySelectorAll('.shell-resize-edge');
    for (const edge of edges) {
        edge.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isResizing = true;
            activeDirection = edge.dataset.direction ?? '';
            startX = e.clientX;
            startY = e.clientY;
            startW = parseInt(getComputedStyle(shell).width);
            startH = parseInt(getComputedStyle(shell).height);
            startLeft = shell.getBoundingClientRect().left;
            startTop = shell.getBoundingClientRect().top;
        });
    }
    document.addEventListener('mousemove', (e) => {
        if (!isResizing)
            return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let width = startW;
        let height = startH;
        let left = startLeft;
        let top = startTop;
        if (activeDirection.includes('right')) {
            width = Math.max(minWidth, startW + dx);
        }
        if (activeDirection.includes('left')) {
            width = Math.max(minWidth, startW - dx);
            left = startLeft + (startW - width);
        }
        if (activeDirection.includes('bottom')) {
            height = Math.max(minHeight, startH + dy);
        }
        if (activeDirection.includes('top')) {
            height = Math.max(minHeight, startH - dy);
            top = startTop + (startH - height);
        }
        shell.style.width = width + 'px';
        shell.style.height = height + 'px';
        shell.style.left = left + 'px';
        shell.style.top = top + 'px';
        shell.style.transform = 'none';
        persistShellBounds(shell, left, top);
    });
    document.addEventListener('mouseup', () => {
        isResizing = false;
        activeDirection = '';
    });
}
function updateSuggestions(input, suggestions, commands, history) {
    let value = input.value.trimStart();
    if (!value) {
        suggestions.style.display = 'none';
        suggestions.innerHTML = '';
        input.removeAttribute('data-suggestion');
        return;
    }
    let words = value.split(/\s+/);
    const hasWorldPrefix = words[0] === '@user-world' || words[0] === '@main-world';
    const commandOffset = hasWorldPrefix ? 1 : 0;
    let firstWord = words[commandOffset];
    let lastWord = words[words.length - 1];
    let cmdMatches = [];
    const tool = commands.find((c) => firstWord === c.tool);
    const prefix = hasWorldPrefix ? `${words[0]} ` : '';
    if (words.length === 1 && !value.endsWith(' ')) {
        cmdMatches = commands.map((c) => c.tool).filter((cmd) => cmd.startsWith(value));
    }
    else if (words.length === commandOffset + 1 && !value.endsWith(' ')) {
        cmdMatches = commands.map((c) => `${prefix}${c.tool}`).filter((cmd) => cmd.startsWith(value));
    }
    else if (tool && value.endsWith(' ')) {
        let escapedArgs = tool.args.map((arg) => arg.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        cmdMatches = [`${prefix}${tool.tool} ${escapedArgs.join(' ')}`];
    }
    else if (tool && (lastWord.startsWith('--') || lastWord.startsWith('-'))) {
        cmdMatches = tool.flags.filter((f) => f.startsWith(lastWord)).map((flag) => `${value.slice(0, value.length - lastWord.length)}${flag}`);
    }
    const historyMatches = history.filter((h) => h.startsWith(value));
    const matches = [...new Set([...cmdMatches, ...historyMatches])];
    suggestions.replaceChildren(...matches.map((match, index) => {
        const option = document.createElement('div');
        option.className = `shell-suggestion${index === 0 ? ' active' : ''}`;
        option.dataset.completion = match;
        option.textContent = match;
        return option;
    }));
    suggestions.style.display = matches.length > 0 ? 'block' : 'none';
    if (matches.length > 0) {
        placeSuggestionsBelowInput(input, suggestions);
        input.setAttribute('data-suggestion', matches[0].startsWith(value) ? matches[0].slice(value.length) : matches[0]);
    }
    else {
        input.removeAttribute('data-suggestion');
    }
}
function selectSuggestion(suggestions, direction) {
    const options = [...suggestions.querySelectorAll('.shell-suggestion')];
    if (!options.length) return;
    const current = Math.max(0, options.findIndex((option) => option.classList.contains('active')));
    options[current].classList.remove('active');
    const next = (current + direction + options.length) % options.length;
    options[next].classList.add('active');
    options[next].scrollIntoView({ block: 'nearest' });
}
function applySuggestion(input, suggestions, completion) {
    input.value = completion;
    input.removeAttribute('data-suggestion');
    suggestions.replaceChildren();
    suggestions.style.display = 'none';
    input.focus();
}
function placeSuggestionsBelowInput(input, suggestions) {
    const inputRect = input.getBoundingClientRect();
    const viewportPadding = 8;
    const menuHeight = Math.min(140, suggestions.scrollHeight || 140);
    const spaceBelow = window.innerHeight - inputRect.bottom - viewportPadding - 4;
    const spaceAbove = inputRect.top - viewportPadding - 4;
    const placeAbove = spaceBelow < Math.min(80, menuHeight) && spaceAbove > spaceBelow;
    const availableHeight = Math.max(80, placeAbove ? spaceAbove : spaceBelow);
    suggestions.style.left = `${inputRect.left}px`;
    suggestions.style.top = `${placeAbove ? Math.max(viewportPadding, inputRect.top - Math.min(menuHeight, availableHeight) - 4) : inputRect.bottom + 4}px`;
    suggestions.style.width = `${Math.max(inputRect.width, 180)}px`;
    suggestions.style.maxHeight = `${Math.min(140, availableHeight)}px`;
}
function extractFlags(name) {
    return name.split(/\s+/).filter((part) => part.startsWith('--') || part.startsWith('-'));
}
