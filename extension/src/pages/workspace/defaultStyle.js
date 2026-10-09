export const DEFAULT_STYLE_CSS = `
#browser-lambdas-shell {
    background: #160e16;
    color: #f7f5f8;
    display: flex;
    flex-direction: column;
    border: 1px solid #2d1b2e;
    border-radius: 24px;
    font-family: 'Fira Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 14px;
    line-height: 1.3;
    padding: 0;
    box-sizing: border-box;
    overflow: hidden;
}
#shell-titlebar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    height: 40px;
    padding: 0 12px;
    border-bottom: 1px solid #2d1b2e;
    cursor: grab;
}
#shell-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px;
}
#shell-outputs {
    padding: 0 2px 0 0;
    background: #160e16;
}
#shell-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0;
    margin-bottom: 6px;
    background: #160e16;
}
#shell-input-wrap > span {
    color: #ddffd0;
    margin-right: 1ch;
}
#shell-input {
    flex: 1;
    border: none;
    outline: none;
    background: #160e16;
    color: #f7f5f8;
    font: inherit;
    line-height: inherit;
    padding: 0;
}
#shell-suggestions {
    background: #160e16;
    color: #f7f5f8;
    border: 1px solid #2d1b2e;
    border-radius: 8px;
}
.shell-icon-button {
    background: transparent;
    color: #f7f5f8;
    border-radius: 6px;
}
.shell-icon-button:hover {
    background: #2d1b2e;
}
.shell-position-menu {
    border: 1px solid #2d1b2e;
    background: #160e16;
}
.shell-position-menu button {
    color: #f7f5f8;
}
.shell-position-menu button:hover {
    background: #2d1b2e;
}
        `.trim();
