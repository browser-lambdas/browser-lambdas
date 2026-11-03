(() => {
	const flows = {
		native: {
			nodes: ['Background worker', 'USER_SCRIPT lambda', 'Content script'],
			area: 'Target page · separate JavaScript worlds',
			steps: [
				['Authorize and inject', 'The worker checks permissions and injects a one-use connection grant into the authorized USER_SCRIPT runtime.', ['leftDown'], ['grant issued', 'grant received', 'UI connection'], ['Browser injection', 'Private UI Port', ''], [
					['Worker → USER_SCRIPT · illustrative setup', '{ connectionGrant: "7ad2…", requestId: "run-42" }'],
				]],
				['Connect and bind', 'The runtime opens a Port and presents its grant. The worker verifies the browser-supplied tab, frame and document, consumes the grant and binds the Port to the invocation.', ['leftUp'], ['verifies grant', 'runtime.connect()', 'UI connection'], ['Native runtime.Port', 'Private UI Port', ''], [
					['Runtime → worker · first message', '{ type: "BIND_INVOCATION", grant: "7ad2…" }'],
					['Browser → worker · connection identity', '{ tab: { id: 12 }, frameId: 0, documentId: "doc-a…" }'],
				]],
				['Check each request', 'The worker checks current permissions using the identity bound to this Port, including every function in the caller chain.', ['leftUp'], ['checks permissions', 'bound to run-42', 'UI connection'], ['Native runtime.Port', 'Private UI Port', ''], [
					['Runtime → worker · illustrative request', '{ type: "GET_STORAGE_REQUEST", id: "req-8", key: "theme" }'],
				]],
				['Respond and finish', 'Responses return over the same Port. Terminal output uses the content-script connection; completion ends the invocation and closes its runtime Port.', ['leftDown', 'rightDown'], ['routes response', 'receives result', 'terminal output'], ['Native runtime.Port', 'Private UI Port', ''], [
					['Worker → runtime · response', '{ type: "GET_STORAGE_RESPONSE", id: "req-8", value: "dark" }'],
					['On completion', 'end invocation → close Port → reject pending calls'],
				]],
			],
			failures: {
				denied: [1, 'Grant rejected', 'The worker rejects unknown, expired, reused or wrong-document grants and closes the Port before accepting runtime requests.', ['leftUp'], ['rejects binding', 'connection closed', 'UI unaffected'], ['Rejected', 'Private UI Port', ''], [['Worker → runtime · illustrative failure', '{ error: "Invalid connection grant" }']]],
				lost: [3, 'Worker disconnected', 'Worker loss ends the invocation and rejects pending calls. Restarting the worker does not restore its authority or replay operations.', [], ['state lost', 'pending calls fail', 'UI connection lost'], ['Disconnected', 'UI lifecycle', ''], [['Runtime · failure', 'Error: Worker disconnected; operation outcome may be unknown.']]],
			},
		},
		main: {
			nodes: ['Background worker', 'USER_SCRIPT lambda', 'MAIN helper'],
			area: 'Target page · shared DOM, separate globals',
			steps: [
				['Request a page operation', 'The USER_SCRIPT lambda requests a page operation over its bound Port. The worker checks MAIN permissions for the complete caller chain.', ['leftUp'], ['checks permission', 'keeps ctx here', 'not started'], ['Native runtime.Port', '', ''], [
					['Lambda · API call', 'await ctx.main.call("app.router.navigate", "/inbox");'],
					['Runtime → worker · illustrative request', '{ type: "MAIN_REQUEST", id: "req-9", operation: "call", path: "app.router.navigate", args: ["/inbox"] }'],
				]],
				['Execute in MAIN', 'The browser injects a helper into the authorized document. The helper receives the operation and explicit arguments, without privileged ctx or connection credentials.', ['rightDown'], ['targets doc-a…', 'waits in isolation', 'calls page function'], ['Native runtime.Port', 'Browser injection', ''], [
					['Worker → MAIN helper · explicit data', '{ path: "app.router.navigate", args: ["/inbox"] }'],
				]],
				['Return through the browser', 'The browser returns the helper’s result directly to the worker. Page operations do not use a window.postMessage request/reply channel.', ['rightUp'], ['receives result', 'still isolated', 'page controls data'], ['Native runtime.Port', 'Browser result', ''], [
					['Browser → worker · illustrative result', '{ result: { route: "/inbox" } }'],
				]],
				['Return plain data', 'The worker validates the result and returns plain data to the isolated lambda. Validate page-supplied values before using them in privileged operations.', ['leftDown'], ['routes response', 'continues with ctx', 'operation complete'], ['Native runtime.Port', '', ''], [
					['Worker → runtime', '{ type: "MAIN_RESPONSE", id: "req-9", value: { route: "/inbox" } }'],
				]],
			],
			failures: {
				denied: [2, 'Page operation failed', 'A missing function or a page exception rejects the call. Any effects before the exception may already have happened.', ['rightUp'], ['returns error', 'call rejects', 'throws exception'], ['Native runtime.Port', 'Browser result', ''], [['Runtime · illustrative rejection', 'Error: app.router.navigate is not a function']]],
				lost: [1, 'Target document changed', 'Navigation invalidates the target document. The operation rejects instead of running in the replacement document or retrying automatically.', [], ['rejects old target', 'call rejects', 'document replaced'], ['Native runtime.Port', 'Invalid document', ''], [['Worker · failure', 'Error: Target document is no longer available']]],
			},
		},
		bridge: {
			nodes: ['Background worker', 'Content script', 'Full MAIN lambda'],
			area: 'Target page · MAIN shares the page’s JavaScript',
			steps: [
				['Deliver bridge credentials', 'The worker injects credentials into MAIN and delivers a matching set through the target document’s private content-script Port.', ['leftDown', 'rightDown'], ['checks MAIN access', 'receives credentials', 'receives credentials'], ['Private extension Port', 'Browser injection', ''], [
					['Worker → each endpoint · illustrative shared values', '{ sessionKey: "<256-bit key>", qToken: "b71d…", aToken: "2f6c…", handshakeId: "e4bf…" }'],
				]],
				['Rendezvous and transfer', 'The endpoints exchange readiness tokens. The content script keeps port1 and transfers port2 through window.postMessage. These messages are visible to the page.', ['across', 'back'], ['invocation recorded', 'keeps port1', 'receives port2'], ['Private extension Port', '', 'window.postMessage'], [
					['Content script → window', '{ type: "qToken", qToken: "b71d…" }'],
					['MAIN → window', '{ type: "aToken", aToken: "2f6c…" }'],
					['Content script → window · transfers port2', 'window.postMessage(\n  { type: "CONTENT_SCRIPT_HANDSHAKE", handshakeId: "e4bf…" },\n  "*", [port2]\n);'],
				]],
				['Prove key possession', 'Each endpoint verifies an encrypted hello using its directional session key before accepting application messages.', ['across', 'back'], ['invocation recorded', 'checks proof', 'checks proof'], ['Private extension Port', '', 'Encrypted proofs'], [
					['Each direction · encrypted payload', '{ kind: "hello" }'],
					['MessageChannel envelope', '{ v: 1, seq: 0, iv: "<base64>", ct: "<base64>" }'],
				]],
				['Relay authorized requests', 'The content script relays decrypted requests over its private Port. The worker checks the invocation and current permissions before performing privileged operations.', ['back', 'leftUp', 'leftDown', 'across'], ['checks permissions', 'relays requests', 'uses granted ctx'], ['Private extension Port', '', 'Encrypted data'], [
					['MAIN → content script · encrypted request', '{ kind: "data", value: { type: "GET_STORAGE_REQUEST", id: "req-8", key: "theme" } }'],
					['Security boundary', 'Hostile MAIN code may expose the key, arguments and granted capabilities.'],
				]],
			],
			failures: {
				denied: [2, 'Proof rejected', 'An invalid proof closes the channel before application traffic is accepted. Startup fails without a plaintext fallback.', [], ['no runtime access', 'channel closed', 'channel closed'], ['Private extension Port', '', 'Invalid proof'], [['Channel · failure', 'Reject proof → close channel → fail startup']]],
				lost: [2, 'Startup deadline reached', 'If the page disrupts setup or the peer does not respond, startup fails and its channel is cleaned up.', [], ['no runtime access', 'channel closed', 'no response'], ['Private extension Port', '', 'Deadline reached'], [['Channel · failure', 'No hello → close channel → fail startup']]],
			},
		},
		cli: {
			nodes: ['Extension sync', 'baah CLI', 'Extension page review'],
			area: 'Local machine · paired connection',
			steps: [
				['Authenticate the connection', 'The CLI and extension verify fresh HMAC challenges using the shared connection token. The token stays local to each endpoint.', ['leftUp', 'leftDown'], ['checks CLI proof', 'checks extension proof', 'unchanged'], ['HMAC challenges', '', ''], [
					['Both directions · conceptual exchange', 'fresh nonce → HMAC proof → verify saved pairing'],
				]],
				['Encrypt the batch', 'Directional AES-GCM keys and sequence checks protect the batch. The extension validates its contents and project policy before accepting changes.', ['leftUp'], ['validates batch', 'sends resources', 'unchanged'], ['Encrypted WebSocket', '', ''], [
					['CLI → extension · encrypted content', 'project → manifest → resources → end marker'],
				]],
				['Stage for review', 'Review is required by default. Updates wait in the extension page and affected functions cannot run until the changes are resolved.', ['rightDown'], ['stages changes', 'awaits acknowledgement', 'approve or reject'], ['Encrypted WebSocket', 'Pending changes', ''], [
					['Extension → extension page', 'Changes staged; local permissions preserved.'],
				]],
				['Acknowledge receipt', 'The extension acknowledges the batch over the encrypted connection. With review enabled, a successful push leaves the changes pending approval.', ['leftDown'], ['confirms batch', 'push succeeds', 'still pending review'], ['Encrypted WebSocket', 'Pending changes', ''], [
					['Extension → CLI · conceptual acknowledgement', '{ type: "batch-received", batchId: "batch-12", status: "pending-review" }'],
				]],
			],
			failures: {
				denied: [0, 'Pairing failed', 'An invalid proof closes the connection before project data is sent. The extension page receives no changes.', [], ['rejects proof', 'push fails', 'unchanged'], ['Connection closed', '', ''], [['CLI · failure', 'Error: Connection authentication failed']]],
				lost: [2, 'Batch rejected', 'An invalid batch or a project lock rejects delivery. The CLI reports failure; the rejected batch is not applied.', ['leftDown'], ['rejects batch', 'push fails', 'unchanged'], ['Encrypted rejection', '', ''], [['Extension → CLI · conceptual acknowledgement', '{ type: "batch-rejected", batchId: "batch-12", reason: "Project is locked" }']]],
			},
		},
	};
	const paths = {
		leftDown: 'M 205 85 V 120 H 85 V 225',
		leftUp: 'M 105 225 V 138 H 225 V 85',
		rightDown: 'M 295 85 V 120 H 415 V 225',
		rightUp: 'M 395 225 V 138 H 275 V 85',
		across: 'M 172 245 H 328',
		back: 'M 328 270 H 172',
	};
	const namespace = 'http://www.w3.org/2000/svg';
	function svgElement(tag, attrs = {}, text) {
		const el = document.createElementNS(namespace, tag);
		Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
		if (text !== undefined) el.textContent = text;
		return el;
	}
	document.querySelectorAll('[data-flow]').forEach(figure => {
		const flow = flows[figure.dataset.flow];
		if (!flow) return;
		const uid = `${figure.dataset.flow}-diagram`;
		const scenario = figure.querySelector('[data-flow-scenario]');
		const svg = svgElement('svg', { class: 'handshake-diagram', viewBox: '0 0 500 310', role: 'img', 'aria-labelledby': `${uid}-title ${uid}-desc` });
		const title = svgElement('title', { id: `${uid}-title` });
		const desc = svgElement('desc', { id: `${uid}-desc` });
		svg.append(title, desc);
		const marker = svgElement('marker', { id: `${uid}-arrow`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
		marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke' }));
		const defs = svgElement('defs');
		defs.append(marker);
		svg.append(defs, svgElement('rect', { class: 'handshake-page', x: 1, y: 205, width: 498, height: 104, rx: 12 }), svgElement('text', { class: 'handshake-label', x: 250, y: 194, 'text-anchor': 'middle' }, flow.area));
		const wires = svgElement('g');
		const packets = svgElement('g', { 'aria-hidden': 'true' });
		svg.append(wires);
		const status = [[150, 15, 200, 70], [8, 225, 154, 64], [338, 225, 154, 64]].map(([x, y, width, height], i) => {
			svg.append(svgElement('rect', { class: 'handshake-node', x, y, width, height, rx: 10 }), svgElement('text', { class: 'handshake-name', x: x + width / 2, y: y + 27, 'text-anchor': 'middle' }, flow.nodes[i]));
			const label = svgElement('text', { class: 'handshake-key', x: x + width / 2, y: y + 47, 'text-anchor': 'middle' });
			svg.append(label);
			return label;
		});
		const labels = [[8, 108, 'start'], [492, 108, 'end'], [250, 226, 'middle']].map(([x, y, anchor]) => {
			const label = svgElement('text', { class: 'handshake-label', x, y, 'text-anchor': anchor });
			svg.append(label);
			return label;
		});
		svg.append(packets);
		const buttons = document.createElement('div');
		buttons.className = 'handshake-steps';
		buttons.setAttribute('role', 'group');
		buttons.setAttribute('aria-label', `${flow.nodes[1]} communication steps`);
		const caption = document.createElement('figcaption');
		caption.className = 'handshake-caption';
		caption.setAttribute('aria-live', 'polite');
		caption.setAttribute('aria-atomic', 'true');
		const heading = document.createElement('strong');
		const description = document.createElement('p');
		const exchange = document.createElement('dl');
		exchange.className = 'handshake-exchange';
		exchange.setAttribute('aria-label', 'Information exchanged');
		caption.append(heading, description, exchange);
		figure.append(svg, buttons, caption);
		let index = 0;
		flow.steps.forEach((step, i) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = i + 1;
			button.setAttribute('aria-label', `Step ${i + 1}: ${step[0]}`);
			button.addEventListener('click', () => { index = i; render(); });
			buttons.append(button);
		});
		function render() {
			const failure = flow.failures[scenario.value];
			const failed = failure && index === failure[0];
			const [name, detail, active, states, links, examples] = failed ? failure.slice(1) : flow.steps[index];
			figure.dataset.state = failed ? 'closed' : 'open';
			heading.textContent = name;
			description.textContent = detail;
			title.textContent = name;
			desc.textContent = `${detail} ${flow.nodes.map((node, i) => `${node}: ${states[i]}`).join('. ')}`;
			status.forEach((label, i) => { label.textContent = states[i]; });
			labels.forEach((label, i) => { label.textContent = links[i]; });
			Array.from(buttons.children).forEach((button, i) => {
				button.hidden = Boolean(failure && i > failure[0]);
				if (i === index) button.setAttribute('aria-current', 'step');
				else button.removeAttribute('aria-current');
			});
			wires.replaceChildren();
			packets.replaceChildren();
			// Inactive routes remain visible to keep the topology legible between steps.
			const shown = figure.dataset.flow === 'bridge' ? ['leftDown', 'across', 'back'] : ['leftDown', 'rightDown'];
			new Set([...shown, ...active]).forEach(key => {
				wires.append(svgElement('path', { class: `handshake-wire${active.includes(key) ? ' is-active' : ''}`, d: paths[key], 'marker-end': `url(#${uid}-arrow)` }));
			});
			if (!failed) active.forEach(key => {
				const packet = svgElement('g', { class: 'handshake-packet', style: `offset-path: path('${paths[key]}')` });
				packet.append(svgElement('rect', { x: -15, y: -10, width: 30, height: 20, rx: 4 }), svgElement('text', { 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, '{..}'));
				packets.append(packet);
			});
			exchange.replaceChildren(...examples.flatMap(([label, payload]) => {
				const term = document.createElement('dt');
				term.textContent = label;
				const definition = document.createElement('dd');
				const code = document.createElement('code');
				code.textContent = payload;
				definition.append(code);
				return [term, definition];
			}));
		}
		scenario.addEventListener('change', () => { index = 0; render(); });
		render();
		figure.hidden = false;
	});
})();
