(async function () {
	const qToken = __Q_TOKEN__;
	const aToken = __A_TOKEN__;
	const handshakeId = __HANDSHAKE_ID__;
	const sessionKey = __SESSION_KEY__;
	const requestId = __REQUEST_ID__;
	const nestedDepth = __NESTED_DEPTH__;
	const argsRaw = PLACEHOLDER_ARGS;

	__SECURE_CHANNEL_SOURCE__;

	const printToShell = (type, ...msgs) => {
		sendEncrypted({ type: 'SHELL_OUTPUT', level: type, values: msgs.map(String) });
	};

	let port = null;
	let secureChannel = null;
	const requestResolvers = {};
	const sendEncrypted = (payload) => secureChannel?.send(payload) || Promise.resolve();

	const activityLog = Object.freeze({
		err: (...values) => sendEncrypted({ type: 'ACTIVITY_LOG', level: 'error', message: values.map(String).join(' ') }),
		dbg: (...values) => sendEncrypted({ type: 'ACTIVITY_LOG', level: 'debug', message: values.map(String).join(' ') }),
		info: (...values) => sendEncrypted({ type: 'ACTIVITY_LOG', level: 'info', message: values.map(String).join(' ') })
	});

	const makeRequest = (type, extra = {}) =>
		new Promise(async (resolve) => {
			const id = crypto.randomUUID();
			requestResolvers[id] = resolve;
			await sendEncrypted({ type, id, ...extra });
		});

	const tabWrapper = (tabId, url, title = '') => ({
		id: tabId,
		url,
		title,
		focus: () =>
			makeRequest('TAB_OPERATION_REQUEST', {
				operation: 'FOCUS_TAB',
				options: { tabId }
			}),
		close: () =>
			makeRequest('TAB_OPERATION_REQUEST', {
				operation: 'CLOSE_TAB',
				options: { tabId }
			}),
		run: (cmd) => ctx.run(cmd, tabId)
	});

	const ctx = {
		log: activityLog,
		args: {
			all: (aliases = {}) => {
				const original = argsRaw;
				const result = {};
				const toCamelCase = (str) => str.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
				for (const key in original) {
					let val = original[key];
					if (key.startsWith('no-')) {
						const clean = key.slice(3);
						const resolved = aliases[clean] ?? clean;
						result[toCamelCase(resolved)] = false;
						continue;
					}
					const resolved = aliases[key] ?? key;
					result[toCamelCase(resolved)] = val;
				}
				return result;
			}
		},
		kv: {
			get: (key) => makeRequest('GET_STORAGE_REQUEST', { key }),
			set: (key, value) => makeRequest('SET_STORAGE_REQUEST', { key, value })
		},
		secrets: {
			get: (key) => makeRequest('GET_SECRET_REQUEST', { key })
		},
		run: (userInput, tabId = null) =>
			makeRequest('FUNCTION_CALL_REQUEST', {
				userInput,
				depth: nestedDepth + 1,
				...(tabId ? { tabId } : {})
			}),
		tabs: {
			this: () => ({
				run: (cmd) => ctx.run(cmd),
				close: () => makeRequest('TAB_OPERATION_REQUEST', { operation: 'CLOSE_CURRENT_TAB' })
			}),
			new: (arg = {}) =>
				new Promise(async (resolve) => {
					const id = crypto.randomUUID();
					requestResolvers[id] = (tab) => {
						if (!tab) { resolve(undefined); return; }
						const requestedUrl = typeof arg === 'string' ? arg : arg.url;
						resolve(tabWrapper(tab.id, tab.url ?? requestedUrl, tab.title));
					};
					await sendEncrypted({
						type: 'TAB_OPERATION_REQUEST',
						id,
						operation: 'NEW_TAB',
						options: typeof arg === 'string' ? { url: arg } : arg
					});
				}),
			all: () =>
				makeRequest('TAB_OPERATION_REQUEST', {
					operation: 'GET_ALL_TABS'
				}).then((tabs) => tabs.map((tab) => tabWrapper(tab.id, tab.url, tab.title)))
		}
	};

	const runtime = {
		log: activityLog,
		console: {
			log: (...args) => printToShell('log', ...args),
			warn: (...args) => printToShell('warn', ...args)
		},
		ctx
	};

	const handleSecureMessage = async (msg) => {
		const resolve = requestResolvers[msg.id];
		if (resolve) {
			activityLog.dbg(`Runtime request resolved: type=${msg.type || 'unknown'}, requestId=${msg.id}.`);
            if (msg.error) {
                printToShell('warn', ['GET_SECRET_RESPONSE', 'GET_STORAGE_RESPONSE', 'SET_STORAGE_RESPONSE'].includes(msg.type)
                    ? msg.error
                    : `Nested lambda request failed: ${msg.error}`);
            }
            if (msg.type === 'GET_STORAGE_RESPONSE' && msg.found === false && !msg.error) {
                printToShell('warn', `storage key does not exist: ${msg.key}`);
            }
			resolve(msg.value);
			delete requestResolvers[msg.id];
		}
	};

	const awaitHandshake = () =>
		new Promise((resolve, reject) => {
			window.addEventListener('message', function initListener(event) {
				if (
					event.source !== window ||
					event.data?.type !== 'CONTENT_SCRIPT_HANDSHAKE' ||
					event.data.handshakeId !== handshakeId
				)
					return;

				window.removeEventListener('message', initListener);

				port = event.ports[0];
				if (!port) {
					return reject();
				}

				secureChannel = createSecureChannel({
					port, key: sessionKey, sessionId: requestId, purpose: 'lambda', role: 'client',
					onMessage: handleSecureMessage,
					onError: (error) => {
						for (const [id, resolveRequest] of Object.entries(requestResolvers)) {
							delete requestResolvers[id];
							try { resolveRequest(undefined); } catch {}
						}
						reject(error);
					}
				});
				secureChannel.ready.then(() => {
					activityLog.dbg(`Secure runtime channel established: requestId=${requestId}.`);
					resolve();
				}, reject);
			});
		});

	window.addEventListener('message', (event) => {
		if (
			event.source !== window ||
			event.data?.type !== 'CONTENT_SCRIPT_INIT' ||
			event.data.qToken !== qToken
		)
			return;
		window.postMessage({ type: 'aToken', aToken }, '*');
	});

	awaitHandshake()
		.then(async () => {
			await sendEncrypted({ type: 'LAMBDA_READY' });
			activityLog.dbg(`Function execution started: requestId=${requestId}.`);

			const runLambda = async () => {
				with (runtime) {
					PLACEHOLDER_FUNC;
				}
			};

			const result = await runLambda();
			await Promise.allSettled(Object.values(requestResolvers));
			await sendEncrypted({
				type: 'LAMBDA_RESULT',
				id: requestId,
				result: { return: result }
			});
		})
		.catch(async (err) => {
			activityLog.err(`Function execution failed: requestId=${requestId}.`, err?.message || err);
			printToShell('warn', `Lambda failed: ${err?.message || err}`);
			await sendEncrypted({
				type: 'LAMBDA_RESULT',
				id: requestId,
				result: { error: err?.message || String(err) }
			});
			secureChannel?.close();
			port?.close();
		});
})();
