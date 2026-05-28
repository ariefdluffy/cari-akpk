import Database from 'better-sqlite3';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface SearchResult {
	source: string;
	page: number;
	pageRange: string;
	totalPages: number;
	title: string;
	snippet: string;
	full_text: string;
	relevance: number;
}

interface PageRow {
	page_num: number;
	title: string;
	content: string;
	full_text: string;
	isContext?: boolean;
}

interface GroupedPages {
	startPage: number;
	endPage: number;
	pages: PageRow[];
}

// Database paths — configurable via environment variables
const DB_PATH: Record<string, string> = {
	'PERGUB 46/2022': process.env.DB_PERGUB || '/home/miftah/data/PERGUB_46_2022_metadata.db',
	'KEP MENPANRB SKJ.01/2025': process.env.DB_KEPMEN || '/home/miftah/data/kepmenpanrb_skj001_2025_metadata.db',
	'PERMENPAN 38/2017': process.env.DB_PERMEN38 || '/home/miftah/data/permenpan_38_2017_metadata.db',
	'Permen 108/2017': process.env.DB_PERMEN108 || '/home/miftah/data/permen_108_2017_metadata.db'
};

// Limits
const MAX_PAGES_PER_DB = 50;
const MAX_CONTEXT = 3;
const MAX_CONTEXT_GENERIC = 5;

/**
 * Escape special FTS5 characters and build a safe MATCH query.
 * Single word → word
 * Multiple words → "phrase match" for exact phrase
 */
function buildFtsQuery(keyword: string): string {
	const cleaned = keyword.trim().replace(/[\^"()+\-~*:]/g, ' ');
	const normalized = cleaned.replace(/\s+/g, ' ').trim();
	if (normalized.includes(' ')) {
		return `"${normalized}"`;
	}
	return normalized;
}

/**
 * Check if a database has the pages_fts table.
 */
function hasFtsIndex(db: Database.Database): boolean {
	const row = db.prepare(
		`SELECT name FROM sqlite_master WHERE type='table' AND name='pages_fts'`
	).get() as { name: string } | undefined;
	return !!row;
}

/**
 * Safely query with FTS5, falling back to LIKE on any error.
 */
function searchWithFts(
	db: Database.Database,
	ftsQuery: string,
	likeTerm: string,
	maxPages: number
): { rawCount: number; rows: PageRow[] } {
	try {
		if (!hasFtsIndex(db)) {
			return searchWithLike(db, likeTerm, maxPages);
		}

		const countRow = db.prepare(
			`SELECT COUNT(*) as cnt FROM pages_fts WHERE pages_fts MATCH ?`
		).get(ftsQuery) as { cnt: number } | undefined;
		const rawCount = countRow?.cnt || 0;

		if (rawCount === 0) {
			return searchWithLike(db, likeTerm, maxPages);
		}

		// Use subquery to avoid rowid join issues:
		// FTS5 content table must match pages exactly for rowid to align.
		// Safer: query FTS for matching page_num via rank, then fetch from pages.
		let rows: PageRow[];
		try {
			rows = db.prepare(`
				SELECT p.page_num, p.title, p.content, p.full_text
				FROM pages_fts fts
				JOIN pages p ON p.page_num = fts.rowid
				WHERE fts MATCH ?
				ORDER BY fts.rank
				LIMIT ?
			`).all(ftsQuery, maxPages) as PageRow[];
		} catch {
			// rowid join failed — fallback to LIKE
			return searchWithLike(db, likeTerm, maxPages);
		}

		// Validate: if rows have null content, fallback
		const valid = rows.some(r => r.page_num != null && (r.content || r.full_text));
		if (!valid || rows.length === 0) {
			return searchWithLike(db, likeTerm, maxPages);
		}

		return { rawCount, rows };
	} catch {
		return searchWithLike(db, likeTerm, maxPages);
	}
}

function searchWithLike(
	db: Database.Database,
	likeTerm: string,
	maxPages: number
): { rawCount: number; rows: PageRow[] } {
	const countRow = db.prepare(`
		SELECT COUNT(*) as cnt
		FROM pages
		WHERE title LIKE ? OR content LIKE ? OR full_text LIKE ?
	`).get(likeTerm, likeTerm, likeTerm) as { cnt: number } | undefined;
	const rawCount = countRow?.cnt || 0;

	if (rawCount === 0) {
		return { rawCount: 0, rows: [] };
	}

	const rows = db.prepare(`
		SELECT page_num, title, content, full_text
		FROM pages
		WHERE title LIKE ? OR content LIKE ? OR full_text LIKE ?
		ORDER BY page_num
		LIMIT ?
	`).all(likeTerm, likeTerm, likeTerm, maxPages) as PageRow[];

	return { rawCount, rows };
}

export const POST: RequestHandler = async ({ request }) => {
	let body: { keyword?: string; limit?: number; offset?: number };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Request body tidak valid' }, { status: 400 });
	}

	const { keyword, limit = 20, offset = 0 } = body;

	if (!keyword || keyword.trim().length < 2) {
		return json({ error: 'Keyword minimal 2 karakter' }, { status: 400 });
	}

	const trimmed = keyword.trim();
	const likeTerm = `%${trimmed}%`;
	const ftsQuery = buildFtsQuery(trimmed);
	const results: SearchResult[] = [];
	const startTime = Date.now();
	let totalRawMatches = 0;

	for (const [name, path] of Object.entries(DB_PATH)) {
		let db: Database.Database | null = null;
		try {
			db = new Database(path, { readonly: true });

			const { rawCount, rows } = searchWithFts(db, ftsQuery, likeTerm, MAX_PAGES_PER_DB);
			totalRawMatches += rawCount;

			if (rows.length === 0) continue;

			const isGeneric = rawCount > 30;
			const contextRange = isGeneric ? MAX_CONTEXT_GENERIC : MAX_CONTEXT;

			// Fetch context pages around matched pages
			const matchedPageNums = new Set(rows.map(r => r.page_num));
			const matchedPages = rows.map(r => r.page_num);
			const minPage = Math.max(1, Math.min(...matchedPages) - contextRange);
			const maxPage = Math.min(9999, Math.max(...matchedPages) + contextRange);

			const contextRows = db.prepare(`
				SELECT page_num, title, content, full_text
				FROM pages
				WHERE page_num BETWEEN ? AND ?
				ORDER BY page_num
			`).all(minPage, maxPage) as PageRow[];

			// Merge matched + context
			const sortedRows: PageRow[] = [
				...rows.map(r => ({ ...r, isContext: false })),
				...contextRows
					.filter(r => !matchedPageNums.has(r.page_num))
					.map(r => ({ ...r, isContext: true }))
			].sort((a, b) => a.page_num - b.page_num);

			const grouped = groupConsecutivePages(sortedRows);

			for (const group of grouped) {
				const fullText = group.pages
					.map(p => p.full_text || p.content || '')
					.join('\n\n');
				const firstNonContext = group.pages.find(p => !p.isContext);
				const title = firstNonContext?.title || `Halaman ${group.startPage}`;
				const page = firstNonContext?.page_num || group.startPage;

				results.push({
					source: name,
					page,
					pageRange:
						group.pages.length > 1
							? `Halaman ${group.startPage} - ${group.endPage}`
							: `Halaman ${group.startPage}`,
					totalPages: group.pages.length,
					title,
					snippet: extractSnippet(fullText, trimmed),
					full_text: fullText,
					relevance: calculateRelevance(title, fullText, trimmed)
				});
			}
		} catch (error) {
			console.error(`Error searching ${name}:`, error);
		} finally {
			db?.close();
		}
	}

	// Sort by relevance
	results.sort((a, b) => b.relevance - a.relevance);

	// Pagination
	const safeOffset = Math.max(0, offset);
	const safeLimit = Math.max(1, Math.min(limit, 100));
	const paginatedResults = results.slice(safeOffset, safeOffset + safeLimit);

	const elapsed = Date.now() - startTime;

	return json({
		keyword,
		total: results.length,
		totalMatches: totalRawMatches,
		returned: paginatedResults.length,
		hasMore: safeOffset + safeLimit < results.length,
		results: paginatedResults,
		elapsed_ms: elapsed,
		sources: Object.keys(DB_PATH)
	});
};

/**
 * Group consecutive pages into logical sections.
 */
function groupConsecutivePages(rows: PageRow[]): GroupedPages[] {
	if (rows.length === 0) return [];

	const groups: GroupedPages[] = [];
	let current: GroupedPages | null = null;

	for (const row of rows) {
		if (!current) {
			current = { startPage: row.page_num, endPage: row.page_num, pages: [row] };
		} else if (row.page_num - current.endPage <= 2) {
			current.endPage = row.page_num;
			current.pages.push(row);
		} else {
			groups.push(current);
			current = { startPage: row.page_num, endPage: row.page_num, pages: [row] };
		}
	}

	if (current) groups.push(current);
	return groups;
}

function extractSnippet(text: string, keyword: string): string {
	if (!text) return '';

	const lowerText = text.toLowerCase();
	const lowerKeyword = keyword.toLowerCase();
	const index = lowerText.indexOf(lowerKeyword);

	if (index === -1) {
		return text.substring(0, 300).replace(/\n/g, ' ').trim() + '...';
	}

	const start = Math.max(0, index - 80);
	const end = Math.min(text.length, index + keyword.length + 220);
	let snippet = text.substring(start, end).replace(/\n/g, ' ').trim();

	if (start > 0) snippet = '...' + snippet;
	if (end < text.length) snippet = snippet + '...';

	return snippet;
}

function calculateRelevance(title: string, content: string, keyword: string): number {
	const lowerKeyword = keyword.toLowerCase();
	let score = 0;

	const titleLower = (title || '').toLowerCase();
	const contentLower = (content || '').toLowerCase();

	if (titleLower.includes(lowerKeyword)) {
		score += 100;
		if (titleLower.startsWith(lowerKeyword)) score += 50;
	}

	const escapedKw = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const count = (contentLower.match(new RegExp(escapedKw, 'gi')) || []).length;
	score += Math.min(count * 10, 50);

	return score;
}
