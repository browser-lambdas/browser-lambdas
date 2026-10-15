function initializeNavigation() {
	const content = document.getElementById('docs-content');
	const toc = document.getElementById('docs-toc');
	const groups = Array.from(content.querySelectorAll('.doc-group'));
	const badges = Array.from(document.querySelectorAll('.docs-categories [data-category-link]'));

	function showGroup(group) {
		for (const candidate of groups) candidate.hidden = candidate !== group;
		for (const badge of badges) {
			if (badge.dataset.categoryLink === group.dataset.category) badge.setAttribute('aria-current', 'true');
			else badge.removeAttribute('aria-current');
		}
		toc.replaceChildren();
		for (const heading of group.querySelectorAll(':scope > .doc-section > h1, :scope > .doc-section > h2, [data-toc]')) {
			const item = document.createElement('li');
			const link = document.createElement('a');
			link.href = `#${heading.id}`;
			link.textContent = heading.textContent;
			item.appendChild(link);
			toc.appendChild(item);
		}
	}

	function followHash(scroll = true) {
		let id;
		try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ''; }
		const target = document.getElementById(id);
		const group = target?.closest('.doc-group') || groups.find(group => group.dataset.category === 'intro');
		showGroup(group);
		if (scroll && target && target !== group && target.closest('.doc-group')) target.scrollIntoView({ block: 'start', behavior: 'instant' });
	}

	// Reveal destinations before native anchor navigation, including cross-category links.
	document.addEventListener('click', (event) => {
		const link = event.target.closest('a[href^="#"]');
		if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const target = document.getElementById(link.hash.slice(1));
		const group = target?.closest('.doc-group');
		if (!group) return;
		if (group.dataset.category === 'llms') loadLlmsViewer();
		if (link.matches('[data-category-link], [data-category-home]')) {
			event.preventDefault();
			showGroup(group);
			if (location.hash !== link.hash) history.pushState(null, '', link.hash);
			document.querySelector('.docs-content').scrollTop = 0;
		} else {
			showGroup(group);
		}
	});
	window.addEventListener('popstate', () => followHash());
	window.addEventListener('hashchange', () => followHash());
	followHash(Boolean(location.hash));
	if (location.hash === '#category-llms') loadLlmsViewer();
}

async function loadLlmsViewer() {
	const code = document.getElementById('llms-content');
	const copy = document.getElementById('copy-llms-content');
	const status = document.getElementById('llms-status');
	if (!code || !copy || code.dataset.loaded) return;
	try {
		const response = await fetch('llms.txt', { cache: 'no-store' });
		if (!response.ok) throw new Error('Unable to load llms.txt');
		code.textContent = await response.text();
		code.dataset.loaded = 'true';
	} catch {
		if (typeof window.LLMS_TEXT !== 'string') {
			code.textContent = 'Unable to load llms.txt.';
			return;
		}
		code.textContent = window.LLMS_TEXT;
		code.dataset.loaded = 'true';
	}
	copy.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(code.textContent);
			status.textContent = 'Copied!';
		} catch {
			status.textContent = 'Copy failed';
		}
		copy.blur();
		window.setTimeout(() => { status.textContent = ''; }, 2000);
	});
}

document.addEventListener('DOMContentLoaded', () => {
	initializeNavigation();
	highlightCodeBlocks();
});
