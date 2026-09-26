import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Defuddle } from '../src/defuddle';
import { parseDocument, normalizeHtmlAttributes } from './helpers';

const selectors = ['.twitter-tweet', '.instagram-media', '.tiktok-embed', '.reddit-embed'];
const fixture = readFileSync(join(__dirname, 'fixtures/preserve-selectors.html'), 'utf8');

function extract(html = fixture, preserveSelectors = selectors) {
	const doc = parseDocument(html, 'https://example.com/article');
	void doc.head; // linkedom creates a missing head lazily.
	const before = doc.documentElement.outerHTML;
	const result = new Defuddle(doc, { preserveSelectors, useAsync: false }).parse();
	expect(doc.documentElement.outerHTML).toBe(before);
	return parseDocument('<html><head></head><body>' + result.content + '</body></html>');
}

describe('preserveSelectors', () => {
	test('preserves embed markup and order while removing surrounding clutter', () => {
		const doc = extract();
		const expected = readFileSync(join(__dirname, 'expected/preserve-selectors.embeds.html'), 'utf8');
		const embeds = selectors.flatMap(selector => Array.from(doc.querySelectorAll(selector)));
		expect(normalizeHtmlAttributes(embeds.map(el => el.outerHTML).join('\n')).trim())
			.toBe(normalizeHtmlAttributes(expected).trim());
		expect(doc.body.textContent).not.toContain('Unwanted navigation');
		expect(doc.body.textContent).not.toContain('Unwanted sibling');
		expect(doc.body.textContent).toMatch(/Before[\s\S]*Twitter[\s\S]*Instagram[\s\S]*TikTok[\s\S]*Reddit[\s\S]*After/);
	});

	test('preserves adjacent matches in a hidden wrapper without importing outside embeds', () => {
		const doc = extract(`<html><body><nav><blockquote class="keep">Outside</blockquote></nav>
			<article><p>Before the posts with enough article text to identify the main content.</p>
			<div hidden><div class="keep">First</div><div class="keep">Second</div></div>
			<p>After the posts with additional explanation and article content for readers.</p></article></body></html>`, ['.keep']);
		expect(Array.from(doc.querySelectorAll('.keep')).map(el => el.textContent)).toEqual(['First', 'Second']);
		expect(doc.body.textContent).toMatch(/Before[\s\S]*First[\s\S]*Second[\s\S]*After/);
	});

	test('defaults to ordinary cleanup', () => {
		expect(extract(fixture, []).querySelector('.instagram-media')).toBeNull();
	});

	test('handles nested matches and a matching content root once', () => {
		const doc = extract('<html><body><article class="keep"><div class="keep"><p>Kept text</p></div></article></body></html>', ['.keep', 'article']);
		expect(doc.querySelectorAll('.keep')).toHaveLength(2);
		expect(doc.querySelectorAll('p')).toHaveLength(1);
	});

	test('ignores invalid selectors without falling back to the unfiltered body', () => {
		const doc = extract(fixture, ['[', ...selectors]);
		expect(doc.querySelector('.twitter-tweet')).not.toBeNull();
		expect(doc.body.textContent).not.toContain('Unwanted navigation');
	});

	test('still sanitizes preserved roots and descendants and resolves URLs', () => {
		const doc = extract(`<html><body><article><p>Article text.</p>
			<div class="keep" onclick="bad()"><script>bad()</script>
			<a href="javascript:bad()">Bad link</a><a href="/post">Good link</a>
			<iframe src="data:text/html,bad" srcdoc="bad" onload="bad()"></iframe></div>
			<script class="keep">bad()</script></article></body></html>`, ['.keep']);
		expect(doc.querySelector('script, [onclick], [onload], [srcdoc]')).toBeNull();
		expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);
		expect(doc.querySelector('iframe')?.hasAttribute('src')).toBe(false);
		expect(doc.querySelector('a[href]')?.getAttribute('href')).toBe('https://example.com/post');
	});
});
