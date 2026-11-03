(async function () {
	const connectionGrant = __CONNECTION_GRANT__;
	const qToken = __Q_TOKEN__;
	const aToken = __A_TOKEN__;
	const handshakeId = __HANDSHAKE_ID__;
	const sessionKey = __SESSION_KEY__;
	const requestId = __REQUEST_ID__;
	const nestedDepth = __NESTED_DEPTH__;
	const argsRaw = PLACEHOLDER_ARGS;

	__SECURE_CHANNEL_SOURCE__;

	let port = null;
	let secureChannel = null;
	let connectionError = null;
	let completed = false;
	let resultSent = false;
	let heartbeat;
	let questionListener;
	let transferListener;
	const requestResolvers = new Map();
	const pendingRequests = new Set();
	const sendMessage = async (message) => {
		if (connectionError) throw connectionError;
		if (connectionGrant) port.postMessage(message);
		else {
			if (!secureChannel) throw new Error('The runtime connection is not ready.');
			await secureChannel.send(message);
		}
	};
	const printToShell = (level, ...values) => sendMessage({ type: 'SHELL_OUTPUT', level, values: values.map(String) }).catch(() => {});
	const activityLog = Object.freeze(Object.fromEntries([['err', 'error'], ['dbg', 'debug'], ['info', 'info']].map(([key, level]) => [key,
		(...values) => sendMessage({ type: 'ACTIVITY_LOG', level, message: values.map(String).join(' ') }).catch(() => {})
	])));
	const failConnection = (error) => {
		if (completed || connectionError) return;
		connectionError = new Error(error?.message || 'The function connection closed. Reload the page and run the function again.');
		clearInterval(heartbeat);
		for (const resolver of requestResolvers.values()) resolver.reject(connectionError);
		requestResolvers.clear();
	};
	const trackRequest = (promise) => {
		pendingRequests.add(promise);
		promise.then(() => pendingRequests.delete(promise), () => pendingRequests.delete(promise));
		return promise;
	};
	const makeRequest = (type, extra = {}, rejectErrors = false) => {
		const id = crypto.randomUUID();
		const promise = new Promise((resolve, reject) => {
			if (connectionError) return reject(connectionError);
			requestResolvers.set(id, { resolve, reject, rejectErrors });
			sendMessage({ ...extra, type, id }).catch((error) => {
				requestResolvers.delete(id);
				reject(error);
			});
		});
		return trackRequest(promise);
	};
	const handleMessage = (message) => {
		if (message?.type === 'RUNTIME_CLOSED') return failConnection(new Error(message.error || 'The function connection closed.'));
		const resolver = requestResolvers.get(message?.id);
		if (!resolver) return;
		requestResolvers.delete(message.id);
		if (message.error && resolver.rejectErrors) return resolver.reject(new Error(message.error));
		if (message.error) printToShell('warn', ['GET_SECRET_RESPONSE', 'GET_STORAGE_RESPONSE', 'SET_STORAGE_RESPONSE'].includes(message.type)
			? message.error : `Nested lambda request failed: ${message.error}`);
		if (message.type === 'GET_STORAGE_RESPONSE' && message.found === false && !message.error) printToShell('warn', `storage key does not exist: ${message.key}`);
		resolver.resolve(message.value);
	};
	const networkRequest = (operation, tabId, extra = {}) => makeRequest('NETWORK_REQUEST', { operation, tabId, ...extra }, true);
	const networkWrapper = (tabId = null) => ({
		add: (rule) => trackRequest(networkRequest('add', tabId, { rule }).then((installed) =>
			({ ...installed, remove: () => networkRequest('remove', tabId, { ruleId: installed.id }) }))),
		list: () => networkRequest('list', tabId),
		clear: () => networkRequest('clear', tabId)
	});
	const tabWrapper = (tabId, url, title = '') => ({
		id: tabId, url, title, network: networkWrapper(tabId),
		focus: () => makeRequest('TAB_OPERATION_REQUEST', { operation: 'FOCUS_TAB', options: { tabId } }),
		close: () => makeRequest('TAB_OPERATION_REQUEST', { operation: 'CLOSE_TAB', options: { tabId } }),
		run: (command) => ctx.run(command, tabId)
	});
	const plainArgument = (value, ancestors = new Set()) => {
		if (value === undefined && ancestors.size === 0) return undefined;
		if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (!value || typeof value !== 'object' || ancestors.has(value) || ancestors.size > 50) throw new Error('MAIN arguments must be plain JSON data.');
		const array = Array.isArray(value);
		const prototype = Object.getPrototypeOf(value);
		if ((array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length) throw new Error('MAIN arguments must be plain JSON data.');
		const descriptors = Object.getOwnPropertyDescriptors(value);
		if (array && (Object.keys(descriptors).length !== value.length + 1 || Array.from({ length: value.length }, (_, i) => !Object.hasOwn(descriptors, i)).some(Boolean))) throw new Error('MAIN arguments must contain dense arrays.');
		ancestors.add(value);
		const result = array ? [] : Object.create(null);
		for (const [key, descriptor] of Object.entries(descriptors)) {
			if (array && key === 'length') continue;
			if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('MAIN arguments must not contain getters.');
			result[key] = plainArgument(descriptor.value, ancestors);
		}
		ancestors.delete(value);
		return result;
	};
	const ctx = {
		log: activityLog,
		args: {
			all: (aliases = {}) => {
				const result = {};
				const camel = (value) => value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
				for (const [key, value] of Object.entries(argsRaw)) {
					const negated = key.startsWith('no-');
					const name = negated ? key.slice(3) : key;
					result[camel(aliases[name] ?? name)] = negated ? false : value;
				}
				return result;
			}
		},
		kv: {
			get: (key) => makeRequest('GET_STORAGE_REQUEST', { key }),
			set: (key, value) => makeRequest('SET_STORAGE_REQUEST', { key, value })
		},
		secrets: { get: (key) => makeRequest('GET_SECRET_REQUEST', { key }) },
		run: (userInput, tabId = null) => makeRequest('FUNCTION_CALL_REQUEST', { userInput, depth: nestedDepth + 1, ...(tabId != null ? { tabId } : {}) }),
		main: {
			get: (path) => makeRequest('MAIN_REQUEST', { operation: 'get', path }, true),
			call: (path, ...args) => trackRequest((async () => makeRequest('MAIN_REQUEST', { operation: 'call', path, args: plainArgument(args) }, true))()),
			run: (callback, arg) => trackRequest((async () => {
				if (typeof callback !== 'function') throw new Error('ctx.main.run requires a function and an optional plain-data argument.');
				return makeRequest('MAIN_REQUEST', { operation: 'run', source: Function.prototype.toString.call(callback), arg: plainArgument(arg) }, true);
			})())
		},
		tabs: {
			this: () => ({ network: networkWrapper(), run: (command) => ctx.run(command), close: () => makeRequest('TAB_OPERATION_REQUEST', { operation: 'CLOSE_CURRENT_TAB' }) }),
			new: (arg = {}) => trackRequest(makeRequest('TAB_OPERATION_REQUEST', {
				operation: 'NEW_TAB', options: typeof arg === 'string' ? { url: arg } : arg
			}).then((tab) => tab ? tabWrapper(tab.id, tab.url ?? (typeof arg === 'string' ? arg : arg.url), tab.title) : undefined)),
			all: () => trackRequest(makeRequest('TAB_OPERATION_REQUEST', { operation: 'GET_ALL_TABS' })
				.then((tabs) => tabs?.map((tab) => tabWrapper(tab.id, tab.url, tab.title))))
		}
	};
	const runtime = {
		log: activityLog,
		console: Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map((level) => [level, (...values) => printToShell(level, ...values)])),
		ctx
	};
	const connectNative = () => new Promise((resolve, reject) => {
		port = chrome.runtime.connect({ name: 'lambda-runtime' });
		const timeout = setTimeout(() => { reject(new Error('The function connection timed out.')); port.disconnect(); }, 5000);
		port.onDisconnect.addListener(() => {
			clearTimeout(timeout);
			const error = new Error('The background connection closed. Reload the page and run the function again.');
			failConnection(error);
			reject(error);
		});
		port.onMessage.addListener((message) => {
			if (message?.type === 'INVOCATION_BOUND') {
				clearTimeout(timeout);
				heartbeat = setInterval(() => sendMessage({ type: 'HEARTBEAT' }).catch(failConnection), 20000);
				resolve();
			} else if (message?.type === 'RUNTIME_CLOSED') {
				const error = new Error(message.error || 'The function connection closed.');
				failConnection(error);
				reject(error);
			} else handleMessage(message);
		});
		port.postMessage({ type: 'BIND_INVOCATION', grant: connectionGrant });
	});
	const connectBridge = () => new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('The function bridge timed out.')), 5000);
		questionListener = (event) => {
			if (event.source === window && event.data?.type === 'qToken' && event.data.qToken === qToken) window.postMessage({ type: 'aToken', aToken }, '*');
		};
		transferListener = (event) => {
			if (event.source !== window || event.data?.type !== 'CONTENT_SCRIPT_HANDSHAKE' || event.data.handshakeId !== handshakeId) return;
			window.removeEventListener('message', questionListener);
			window.removeEventListener('message', transferListener);
			port = event.ports[0];
			if (!port) { clearTimeout(timeout); return reject(new Error('The function bridge port is missing.')); }
			secureChannel = createSecureChannel({
				port, key: sessionKey, sessionId: requestId, purpose: 'lambda', role: 'client',
				onMessage: handleMessage,
				onError: (error) => { failConnection(error); reject(error); }
			});
			secureChannel.ready.then(() => { clearTimeout(timeout); resolve(); }, (error) => { clearTimeout(timeout); reject(error); });
		};
		window.addEventListener('message', questionListener);
		window.addEventListener('message', transferListener);
	});
	(connectionGrant ? connectNative() : connectBridge())
		.then(async () => {
			await sendMessage({ type: 'LAMBDA_READY' });
			activityLog.dbg(`${connectionGrant ? 'Native' : 'Secure'} runtime channel established: requestId=${requestId}.`);
			const runLambda = async () => {
				with (runtime) {
					PLACEHOLDER_FUNC;
				}
			};
			const result = await runLambda();
			while (pendingRequests.size) await Promise.allSettled([...pendingRequests]);
			await sendMessage({ type: 'LAMBDA_RESULT', id: requestId, result: { return: result } });
			resultSent = true;
			completed = true;
		})
		.catch(async (error) => {
			await activityLog.err(`Function execution failed: requestId=${requestId}.`, error?.message || error);
			await printToShell('warn', `Lambda failed: ${error?.message || error}`);
			try {
				await sendMessage({ type: 'LAMBDA_RESULT', id: requestId, result: { error: error?.message || String(error) } });
				resultSent = true;
			} catch {}
		})
		.finally(() => {
			completed = true;
			clearInterval(heartbeat);
			if (questionListener) window.removeEventListener('message', questionListener);
			if (transferListener) window.removeEventListener('message', transferListener);
			secureChannel?.close();
			if (connectionGrant) { if (!resultSent) { try { port?.disconnect(); } catch {} } }
			else port?.close();
		});
})();
