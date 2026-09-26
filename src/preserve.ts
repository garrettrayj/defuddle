/**
 * Keep selected subtrees opaque to cleanup. Inert placeholders retain their
 * positions; saved ancestor/sibling references recover positions even when a
 * clutter-removal pass deletes a wrapper. Only matches within the selected
 * content are retained. The caller must sanitize AFTER restoring.
 */
export function preserveSelectedContent(root: Element, selectors: string[] = []): () => Element {
	if (selectors.length === 0) return () => root;
	const matches = new Set<Element>();
	for (const selector of selectors) {
		try {
			if (root.matches(selector)) matches.add(root);
			root.querySelectorAll(selector).forEach(el => matches.add(el));
		} catch {
			// One malformed selector must not turn extraction into a body fallback.
		}
	}
	if (matches.has(root)) {
		const saved = root.cloneNode(true) as Element;
		return () => saved;
	}

	// Query in document order, independent of the order of the selectors.
	const selected = Array.from(root.querySelectorAll('*')).filter(el => {
		if (!matches.has(el)) return false;
		for (let parent = el.parentElement; parent && parent !== root; parent = parent.parentElement) {
			if (matches.has(parent)) return false;
		}
		return true;
	});
	const saved = selected.map(element => {
		const marker = root.ownerDocument.createComment('preserved content');
		element.replaceWith(marker);
		return { element, marker };
	});
	// Capture positions after every replacement so adjacent matches refer to
	// each other's markers, not to already detached original elements.
	const positions = saved.map(({ element, marker }) => {
		const path: { parent: Element; following: Node[] }[] = [];
		for (let node: Node = marker; node !== root && node.parentElement; node = node.parentElement) {
			const siblings = Array.from(node.parentElement.childNodes);
			path.push({ parent: node.parentElement, following: siblings.slice(siblings.indexOf(node as ChildNode) + 1) });
		}
		return { element, marker, path };
	});

	return () => {
		// Restore right-to-left so a following marker can anchor an earlier match.
		const restored = new Map<Node, Node>();
		for (const { element, marker, path } of positions.reverse()) {
			if (root.contains(marker)) {
				marker.replaceWith(element);
			} else {
				const candidates: Node[] = [];
				for (const { parent, following } of path) {
					candidates.push(...following);
					if (parent !== root && !root.contains(parent)) continue;
					const anchor = candidates.map(node => restored.get(node) ?? node)
						.find(node => node.parentNode === parent) ?? null;
					parent.insertBefore(element, anchor);
					break;
				}
			}
			restored.set(marker, element);
		}
		return root;
	};
}
