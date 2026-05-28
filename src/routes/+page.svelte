<script lang="ts">
	import { onMount } from 'svelte';

	interface Card {
		type: string;
		label: string;
		content: string;
		isHeader?: boolean;
	}

	interface SearchResult {
		source: string;
		page: number;
		pageRange: string;
		totalPages: number;
		title: string;
		snippet: string;
		full_text: string;
		content?: string;
		relevance: number;
	}

	let keyword = $state('');
	let results = $state<SearchResult[]>([]);
	let selectedResult = $state<SearchResult | null>(null);
	let loading = $state(false);
	let searched = $state(false);
	let errorMessage = $state('');
	let stats = $state({ total: 0, elapsed_ms: 0, totalMatches: 0, hasMore: false, returned: 0 });

	// Mobile panel navigation: 'results' | 'detail'
	let activePanel = $state<'results' | 'detail'>('results');

	// Pagination: docs
	let visibleDocCount = $state(20);
	const DOC_INCREMENT = 20;

	// Local search within content
	let localKeyword = $state('');
	let matchCount = $state(0);
	let matchingIdxs = $state<number[]>([]);
	let currentMatchPos = $state(0);

	// Virtual scroll: cards
	let visibleCardCount = $state(50);
	let cardsContainer = $state<HTMLElement | null>(null);
	const CARD_INCREMENT = 50;

	// Derived: visible docs
	let visibleDocs = $derived(results.filter(r => r.relevance > 0).slice(0, visibleDocCount));

	// Derived: all cards from selected result (single source of truth)
	let allCards = $derived<Card[]>(
		selectedResult ? formatText(selectedResult.full_text || selectedResult.content || '') : []
	);

	// Derived: visible slice of all cards
	let visibleCards = $derived(allCards.slice(0, visibleCardCount));

	async function search() {
		if (keyword.trim().length < 2) return;

		loading = true;
		searched = true;
		selectedResult = null;
		visibleDocCount = DOC_INCREMENT;
		activePanel = 'results';
		errorMessage = '';

		try {
			const res = await fetch('/api/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ keyword, limit: 20, offset: 0 })
			});

			if (!res.ok) {
				errorMessage = `Server error: ${res.status}`;
				results = [];
				return;
			}

			const data = await res.json();

			if (data.error) {
				errorMessage = data.error;
				results = [];
				return;
			}

			results = data.results || [];
			stats = {
				total: data.total || 0,
				elapsed_ms: data.elapsed_ms || 0,
				totalMatches: data.totalMatches || 0,
				hasMore: data.hasMore || false,
				returned: data.returned || 0
			};
		} catch (error) {
			errorMessage = 'Gagal menghubungi server. Cek koneksi internet.';
			results = [];
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		const nextOffset = results.length;
		loading = true;
		try {
			const res = await fetch('/api/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ keyword, limit: DOC_INCREMENT, offset: nextOffset })
			});

			if (!res.ok) return;

			const data = await res.json();
			if (data.error) return;

			// Merge new results, avoid duplicates
			const existingIds = new Set(results.map(r => `${r.source}-${r.page}-${r.title}`));
			const newResults = (data.results || []).filter((r: SearchResult) => {
				const key = `${r.source}-${r.page}-${r.title}`;
				if (existingIds.has(key)) return false;
				existingIds.add(key);
				return true;
			});
			results = [...results, ...newResults];
			visibleDocCount += DOC_INCREMENT;
			stats = {
				total: data.total || stats.total,
				elapsed_ms: data.elapsed_ms || stats.elapsed_ms,
				totalMatches: data.totalMatches || stats.totalMatches,
				hasMore: nextOffset + newResults.length < (data.total || stats.total),
				returned: results.length
			};
		} catch (error) {
			console.error('Load more error:', error);
		} finally {
			loading = false;
		}
	}

	function loadMoreCards() {
		visibleCardCount += CARD_INCREMENT;
	}

	function viewDetail(result: SearchResult) {
		selectedResult = result;
		localKeyword = '';
		matchCount = 0;
		matchingIdxs = [];
		currentMatchPos = 0;
		visibleCardCount = CARD_INCREMENT;
		activePanel = 'detail';
		// Scroll to top of detail panel
		if (cardsContainer) {
			cardsContainer.scrollTop = 0;
		}
	}

	function backToResults() {
		activePanel = 'results';
	}

	function handleLocalSearch() {
		if (!selectedResult) return;

		if (!localKeyword.trim()) {
			matchCount = 0;
			matchingIdxs = [];
			currentMatchPos = 0;
			return;
		}
		const lowerKw = localKeyword.toLowerCase();
		const indices: number[] = [];
		const cards = allCards;
		for (let i = 0; i < cards.length; i++) {
			const card = cards[i];
			if ((card.content && card.content.toLowerCase().includes(lowerKw)) ||
			    (card.label && card.label.toLowerCase().includes(lowerKw))) {
				indices.push(i);
			}
		}
		matchCount = indices.length;
		matchingIdxs = indices;
		currentMatchPos = 0;

		if (indices.length > 0) {
			scrollToMatchIndex(indices[0]);
		}
	}

	/** Scroll to a specific card by its global index (within allCards). */
	function scrollToMatchIndex(globalIdx: number) {
		// Ensure enough cards are visible
		if (globalIdx >= visibleCardCount) {
			visibleCardCount = globalIdx + CARD_INCREMENT;
		}
		// Use requestAnimationFrame to wait for DOM update
		requestAnimationFrame(() => {
			const cardEl = cardsContainer?.querySelector(`[data-card-idx="${globalIdx}"]`);
			if (cardEl) {
				cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		});
	}

	function nextMatch(e?: MouseEvent) {
		if (e) e.preventDefault();
		if (matchingIdxs.length === 0) return;
		currentMatchPos = (currentMatchPos + 1) % matchingIdxs.length;
		scrollToMatchIndex(matchingIdxs[currentMatchPos]);
	}

	function prevMatch(e?: MouseEvent) {
		if (e) e.preventDefault();
		if (matchingIdxs.length === 0) return;
		currentMatchPos = (currentMatchPos - 1 + matchingIdxs.length) % matchingIdxs.length;
		scrollToMatchIndex(matchingIdxs[currentMatchPos]);
	}

	function handleLocalSearchEnter(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		nextMatch();
	}

	/** Escape HTML entities to prevent XSS */
	function escapeHtml(text: string): string {
		if (!text) return '';
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	function formatText(text: string): Card[] {
		if (!text) return [];

		let clean = text.replace(/\n{3,}/g, '\n\n').trim();
		const lines = clean.split('\n');
		const cards: Card[] = [];

		const romanPattern = /^(I{1,3}|IV|V|VI{0,3})\.\s+(.+)/;
		const labelPattern = /^(Mutlak Penting|Perlu|Dasar Hukum|Kompetensi Teknis Umum|Kompetensi Manajerial|Kompetensi Sosial Kultural)/;
		const bulletPattern = /^[\-\•]\s+(.+)/;
		const fieldPattern = /^([A-Z][^:]{0,50}):\s*(.+)/;
		const sectionHeaderPattern = /^(MENIMBANG|MENGINGAT|MENETAPKAN|PASAL|BAB|DAFTAR|LAMPIRAN)/i;
		const pointPattern = /^:\s*([a-z]|\d+)\.\s*(.+)/i;
		const subPointPattern = /^(\d+\.\d+)\.?\s*(.*)/;

		let i = 0;
		while (i < lines.length) {
			const line = lines[i].trim();
			if (!line) { i++; continue; }

			// Section header
			if (sectionHeaderPattern.test(line)) {
				cards.push({ type: 'toc', label: '', content: line });
				i++;
				continue;
			}

			// Roman numeral section
			const romanMatch = line.match(romanPattern);
			if (romanMatch) {
				cards.push({ type: 'section', label: romanMatch[1], content: romanMatch[2] });
				i++;
				continue;
			}

			// Special labels
			if (labelPattern.test(line)) {
				cards.push({ type: 'label', label: '', content: line });
				i++;
				continue;
			}

			// Point items: : a. ... or : 1. ...
			const pointMatch = line.match(pointPattern);
			if (pointMatch) {
				cards.push({ type: 'point', label: pointMatch[1].toUpperCase(), content: pointMatch[2] });
				i++;
				continue;
			}

			// Bullet points
			const bulletMatch = line.match(bulletPattern);
			if (bulletMatch) {
				cards.push({ type: 'point', label: '•', content: bulletMatch[1] });
				i++;
				continue;
			}

			// Sub-point: numbered like "3.1."
			const subPointMatch = line.match(subPointPattern);
			if (subPointMatch) {
				const num = subPointMatch[1];
				let content = subPointMatch[2];

				if (!content || content.length < 5) {
					const paragraphs: string[] = [];
					let j = i + 1;
					while (j < lines.length) {
						const nextLine = lines[j].trim();
						if (!nextLine) break;
						if (sectionHeaderPattern.test(nextLine) || labelPattern.test(nextLine) ||
						    pointPattern.test(nextLine) || nextLine.match(/^[A-Z][A-Z\s]{10,}:/) ||
						    nextLine.match(/^(\d+\.\d+|[IVX]+)\.\s/)) {
							break;
						}
						paragraphs.push(nextLine);
						j++;
					}
					content = paragraphs.join(' ');
				}

				if (content.length > 10) {
					cards.push({ type: 'subpoint', label: num, content });
					i++;
					continue;
				}
			}

			// Field: label: value
			const fieldMatch = line.match(fieldPattern);
			if (fieldMatch && line.length < 300) {
				cards.push({ type: 'field', label: fieldMatch[1], content: fieldMatch[2] });
				i++;
				continue;
			}

			// Default: text (merge consecutive text lines)
			if (line.length > 10) {
				const paragraphs: string[] = [line];
				let j = i + 1;
				while (j < lines.length) {
					const nextLine = lines[j].trim();
					if (!nextLine) break;
					if (sectionHeaderPattern.test(nextLine) || labelPattern.test(nextLine)) break;
					paragraphs.push(nextLine);
					j++;
				}
				cards.push({ type: 'text', label: '', content: paragraphs.join(' ') });
				i = j;
				continue;
			}

			i++;
		}

		return cards;
	}

	function getCardClass(type: string, isHeader?: boolean) {
		if (isHeader) return 'card-header-text';
		return `card-${type}`;
	}

	function getCardIcon(type: string, label: string) {
		if (type === 'toc') return '📑';
		if (type === 'section') {
			if (label === 'I') return '📌';
			if (label === 'II') return '📋';
			if (label === 'III') return '📎';
			if (label === 'IV') return '📜';
			if (label === 'V') return '📝';
			return '📄';
		}
		return '•';
	}

	function getSourceBadge(source: string) {
		if (!source) return { label: 'Unknown', class: 'source-default' };
		if (source.includes('PERGUB') || source.includes('pergub')) {
			return { label: 'PERGUB', class: 'source-pergub' };
		}
		if (source.includes('KEPMEN') || source.includes('kepmen')) {
			return { label: 'KEPMENPANRB', class: 'source-kep' };
		}
		if (source.includes('PERMENPAN_38') || source.includes('permenpan_38')) {
			return { label: 'PERMENPAN 38', class: 'source-permen38' };
		}
		if (source.includes('PERMENPAN_108') || source.includes('permenpan_108')) {
			return { label: 'PERMENPAN 108', class: 'source-permen108' };
		}
		return { label: source.split('_').pop()?.replace('.db', '').slice(0, 15) || 'Doc', class: 'source-default' };
	}

	/**
	 * Highlight keyword in text. Returns HTML string.
	 * Escapes HTML entities FIRST to prevent XSS, then applies <mark> tags.
	 */
	function highlightKeyword(text: string, kw: string): string {
		if (!kw || !text) return escapeHtml(text);
		const escaped = escapeHtml(text);
		const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		// Also escape the keyword for display inside the regex
		const escapedKwHtml = escapeHtml(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(`(${escapedKwHtml})`, 'gi');
		return escaped.replace(regex, '<mark>$1</mark>');
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') search();
	}

	function handleSearchShortcut(e: KeyboardEvent) {
		// Don't intercept if user is typing in any input
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

		// '/' focuses search input (not Enter — that conflicts with button/input)
		if (e.key === '/') {
			e.preventDefault();
			const input = document.querySelector('.search-input') as HTMLInputElement;
			if (input) input.focus();
		}
	}

	onMount(() => {
		document.addEventListener('keydown', handleSearchShortcut);
		return () => document.removeEventListener('keydown', handleSearchShortcut);
	});
</script>

<svelte:head>
	<title>Cari AKPK — Pencarian Standar Kompetensi Jabatan ASN</title>
</svelte:head>

<div class="app">
	<!-- Header -->
	<header class="header">
		<div class="header-content">
			<div class="logo">
				<span class="logo-icon">📖</span>
				<div>
					<h1>Cari AKPK</h1>
					<p class="tagline">Pencarian Standar Kompetensi Jabatan ASN</p>
				</div>
			</div>
		</div>
	</header>

	<!-- Stats Bar -->
	{#if searched && !loading && !errorMessage}
		<div class="stats-bar">
			{#if stats.totalMatches > 0}
				<span>✅ Ditemukan <strong>{stats.totalMatches.toLocaleString()}</strong> halaman match dalam <strong>{stats.total}</strong> dokumen · {stats.elapsed_ms}ms</span>
			{:else if results.length > 0}
				<span>✅ Ditemukan <strong>{stats.total}</strong> dokumen dalam <strong>{stats.elapsed_ms}ms</strong></span>
			{:else}
				<span>❌ Tidak ada hasil</span>
			{/if}
		</div>
	{/if}

	<!-- Error Bar -->
	{#if errorMessage}
		<div class="error-bar">
			<span>⚠️ {errorMessage}</span>
			<button onclick={() => errorMessage = ''} class="error-dismiss">✕</button>
		</div>
	{/if}

	<!-- Search Section -->
	<div class="search-section">
		<div class="search-container">
			<div class="search-input-wrapper">
				<span class="search-icon">🔍</span>
				<input
					type="text"
					bind:value={keyword}
					onkeydown={handleKeydown}
					placeholder="Ketik kata kunci... (contoh: kompetensi, biro umum)"
					class="search-input"
				/>
				<button onclick={search} disabled={loading} class="search-button">
					{loading ? 'Mencari...' : 'Cari'}
				</button>
			</div>
			<div class="sources-bar">
				<span class="sources-label">📚 Sumber:</span>
				<span class="source-tag" style="background: rgba(168,85,247,0.2); color: #c084fc;">PERGUB 46/2022</span>
				<span class="source-tag" style="background: rgba(52,211,153,0.2); color: #34d399;">KEPMENPANRB SKJ</span>
				<span class="source-tag" style="background: rgba(251,191,36,0.2); color: #fbbf24;">PERMENPAN 38/2017</span>
				<span class="source-tag" style="background: rgba(96,165,250,0.2); color: #60a5fa;">PERMENPAN 108/2017</span>
			</div>
		</div>
	</div>

	<!-- Main Content - 2 Column -->
	<div class="main-content">
		{#if loading && results.length === 0}
			<div class="loading-state">
				<div class="spinner"></div>
				<p>Mencari...</p>
			</div>
		{:else if !searched}
			<div class="welcome-state">
				<div class="welcome-icon">📖</div>
				<h2>Selamat Datang</h2>
				<p>Cari standar kompetensi jabatan ASN dengan mudah</p>
				<div class="quick-search">
					<span>🔎 Contoh:</span>
					<button onclick={() => { keyword = 'kompetensi'; search(); }}>kompetensi</button>
					<button onclick={() => { keyword = 'jabatan'; search(); }}>jabatan</button>
					<button onclick={() => { keyword = 'pangkat'; search(); }}>pangkat</button>
					<button onclick={() => { keyword = 'mutasi'; search(); }}>mutasi</button>
				</div>
			</div>
		{:else if results.length === 0}
			<div class="empty-state">
				<div class="empty-icon">🔎</div>
				<h2>Tidak Ditemukan</h2>
				<p>Tidak ada hasil untuk "<strong>{keyword}</strong>"</p>
			</div>
		{:else}
			<!-- Mobile Tab Bar -->
			<div class="mobile-tabs">
				<button
					class="mobile-tab {activePanel === 'results' ? 'active' : ''}"
					onclick={() => activePanel = 'results'}
				>
					📋 Hasil ({visibleDocs.length})
				</button>
				<button
					class="mobile-tab {activePanel === 'detail' ? 'active' : ''}"
					onclick={() => selectedResult && (activePanel = 'detail')}
					disabled={!selectedResult}
				>
					📄 Detail {selectedResult ? '' : '(pilih dulu)'}
				</button>
			</div>

			<!-- Results Panel -->
			<div class="results-panel" class:panel-hidden={activePanel !== 'results'}>
				<div class="panel-header">
					<h3>📋 Hasil</h3>
					<span class="result-count">
						{stats.total > visibleDocs.length ? `${visibleDocs.length}/${stats.total}` : stats.total} dokumen
					</span>
				</div>
				<div class="results-list">
					{#each visibleDocs as result}
						{@const badge = getSourceBadge(result.source)}
						<button
							class="result-card {selectedResult === result ? 'selected' : ''}"
							onclick={() => viewDetail(result)}
						>
							<div class="card-header">
								<span class="{badge.class} source-chip">{badge.label}</span>
								<span class="page-num">📑 {result.pageRange || `Hal. ${result.page}`}</span>
							</div>
							<h4 class="card-title">{result.title}</h4>
							<p class="card-snippet">{result.snippet}</p>
							<div class="card-footer">
								<span class="relevance-badge">Relevansi: {result.relevance}</span>
							</div>
						</button>
					{/each}

					<!-- Load More -->
					{#if stats.hasMore || visibleDocs.length < stats.total}
						<button class="load-more-btn" onclick={loadMore} disabled={loading}>
							{#if loading}
								<span class="spinner-sm"></span> Memuat...
							{:else}
								⬇ Tampilkan lebih banyak
								{#if stats.total > visibleDocs.length}
									({stats.total - visibleDocs.length} lagi)
								{/if}
							{/if}
						</button>
					{/if}
				</div>
			</div>

			<!-- Detail Panel -->
			<div class="detail-panel" class:panel-hidden={activePanel !== 'detail'}>
				{#if selectedResult}
					{@const badge = getSourceBadge(selectedResult.source)}
					{@const cards = allCards}
					{@const activeKw = localKeyword || keyword}
					<div class="detail-header">
						<button class="back-btn" onclick={backToResults}>← Kembali</button>
						<span class="{badge.class} source-chip large">{badge.label}</span>
						<span class="detail-page">📑 {selectedResult.pageRange || `Halaman ${selectedResult.page}`}</span>
						{#if selectedResult.totalPages > 1}
							<span class="page-count">({selectedResult.totalPages} halaman)</span>
						{/if}
					</div>

					<h2 class="detail-title">{selectedResult.title}</h2>

					<!-- Local Search Box -->
					<div class="local-search-container">
						<div class="local-search-box">
							<span class="local-search-icon">🔍</span>
							<input
								type="text"
								bind:value={localKeyword}
								oninput={handleLocalSearch}
								onkeydown={handleLocalSearchEnter}
								placeholder="Cari kata dalam konten ini..."
								class="local-search-input"
							/>
							{#if localKeyword.length > 0}
								<button class="clear-btn" onclick={() => { localKeyword = ''; matchCount = 0; matchingIdxs = []; currentMatchPos = 0; }}>✕</button>
							{/if}
						</div>
						{#if matchCount > 0}
							<div class="match-nav">
								<button class="nav-btn" onclick={prevMatch}>⬆</button>
								<span class="match-badge">↕ {currentMatchPos + 1}/{matchCount}</span>
								<button class="nav-btn" onclick={nextMatch}>⬇</button>
							</div>
						{:else if localKeyword.length > 1}
							<div class="match-nav">
								<button class="nav-btn" onclick={prevMatch}>⬆</button>
								<span class="match-badge no-match">0 ditemukan</span>
								<button class="nav-btn" onclick={nextMatch}>⬇</button>
							</div>
						{/if}
						<button class="copy-btn" onclick={() => navigator.clipboard.writeText(selectedResult?.full_text || selectedResult?.content || '')}>
							📋 Salin
						</button>
					</div>

					<div class="detail-content" bind:this={cardsContainer}>
						<!-- Daftar Isi Navigation -->
						{#if cards.filter(c => c.type === 'toc' || c.type === 'section').length > 0}
							<div class="toc-nav">
								<span class="toc-label">📑 Daftar Isi</span>
								<div class="toc-items">
									{#each cards as card, idx}
										{#if card.type === 'toc' || card.type === 'section'}
											{@const targetIdx = idx}
											<button
												class="toc-item"
												onclick={() => scrollToMatchIndex(targetIdx)}
											>
												<span>{getCardIcon(card.type, card.label)}</span>
												<span class="toc-text">{card.content || card.label}</span>
											</button>
										{/if}
									{/each}
								</div>
							</div>
						{/if}

						<!-- Cards (virtual scroll - only visible slice) -->
						<div class="cards-container">
							{#each visibleCards as card, idx}
								{@const cardClass = getCardClass(card.type, card.isHeader)}
								{@const globalIdx = idx}
								<div
									class="content-card {cardClass} {!activeKw || matchingIdxs.includes(globalIdx) ? 'has-match' : 'no-match'}"
									style="--idx: {idx}"
									data-card-idx={globalIdx}
								>
									{#if card.type === 'section' || card.type === 'toc'}
										<div class="card-header-line">
											<span class="card-icon">{getCardIcon(card.type, card.label)}</span>
											<span class="card-title section-title">{@html highlightKeyword(card.content, activeKw)}</span>
										</div>
									{:else if card.type === 'field'}
										<div class="field-card">
											<span class="field-label">{@html highlightKeyword(card.label, activeKw)}:</span>
											<span class="field-value">{@html highlightKeyword(card.content, activeKw)}</span>
										</div>
									{:else if card.type === 'point' && card.label}
										<div class="point-card">
											<span class="point-level">{card.label}</span>
											<span class="point-text">{@html highlightKeyword(card.content, activeKw)}</span>
										</div>
									{:else if card.type === 'subpoint'}
										<div class="subpoint-card">
											<span class="subpoint-level">{card.label}</span>
											<span class="subpoint-text">{@html highlightKeyword(card.content, activeKw)}</span>
										</div>
									{:else if card.type === 'label'}
										<div class="label-chip">
											<span class="label-text">{@html highlightKeyword(card.content, activeKw)}</span>
										</div>
									{:else}
										<div class="text-card">
											<span>{@html highlightKeyword(card.content, activeKw)}</span>
										</div>
									{/if}
								</div>
							{/each}

							<!-- Load More Cards -->
							{#if visibleCardCount < cards.length}
								<button class="load-more-btn load-more-cards" onclick={loadMoreCards}>
									⬇ Tampilkan {Math.min(CARD_INCREMENT, cards.length - visibleCardCount)} kartu lagi
									({cards.length - visibleCardCount} tersisa)
								</button>
							{/if}
						</div>
					</div>

					<div class="detail-footer">
						<div class="meta-info">
							<span>📊 Relevansi: {selectedResult.relevance}</span>
							{#if keyword}
								<span class="keyword-hint">🔍 Pencarian: <strong>{keyword}</strong></span>
							{/if}
						</div>
					</div>
				{:else}
					<div class="detail-placeholder">
						<div class="placeholder-icon">👈</div>
						<p>Pilih salah satu hasil di panel kiri untuk melihat detail</p>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	:global(*) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(body) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		background: #0a0a0f;
		color: #fff;
		min-height: 100vh;
	}

	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
	}

	/* Header */
	.header {
		background: linear-gradient(135deg, rgba(10,10,15,0.95), rgba(15,15,25,0.95));
		border-bottom: 1px solid rgba(255,255,255,0.05);
		padding: 20px 24px;
		flex-shrink: 0;
	}

	.header-content {
		max-width: 1600px;
		margin: 0 auto;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.logo-icon {
		font-size: 2.5rem;
	}

	.logo h1 {
		font-size: 1.8rem;
		font-weight: 700;
		background: linear-gradient(135deg, #00d4ff, #a855f7);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.tagline {
		color: #888;
		font-size: 0.95rem;
		margin-top: 2px;
	}

	/* Stats Bar */
	.stats-bar {
		background: rgba(0,212,255,0.1);
		padding: 14px 24px;
		text-align: center;
		color: #00d4ff;
		font-size: 0.95rem;
		border-bottom: 1px solid rgba(0,212,255,0.2);
		flex-shrink: 0;
	}

	/* Error Bar */
	.error-bar {
		background: rgba(239,68,68,0.15);
		padding: 14px 24px;
		text-align: center;
		color: #f87171;
		font-size: 0.95rem;
		border-bottom: 1px solid rgba(239,68,68,0.3);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
	}

	.error-dismiss {
		background: rgba(255,255,255,0.1);
		border: none;
		color: #f87171;
		padding: 2px 8px;
		border-radius: 6px;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.error-dismiss:hover {
		background: rgba(255,255,255,0.2);
	}

	/* Search Section */
	.search-section {
		background: rgba(255,255,255,0.03);
		padding: 20px 24px;
		border-bottom: 1px solid rgba(255,255,255,0.05);
		flex-shrink: 0;
	}

	.search-container {
		max-width: 900px;
		margin: 0 auto;
	}

	.search-input-wrapper {
		display: flex;
		gap: 12px;
		background: rgba(0,0,0,0.3);
		border-radius: 16px;
		padding: 8px;
		border: 2px solid rgba(255,255,255,0.1);
		transition: border-color 0.3s;
	}

	.search-input-wrapper:focus-within {
		border-color: #00d4ff;
	}

	.search-icon {
		display: flex;
		align-items: center;
		padding: 0 12px;
		font-size: 1.2rem;
	}

	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		font-size: 1.1rem;
		color: #fff;
		padding: 12px 0;
	}

	.search-input::placeholder {
		color: #666;
	}

	.search-button {
		background: linear-gradient(135deg, #00d4ff, #a855f7);
		border: none;
		padding: 12px 32px;
		border-radius: 10px;
		color: white;
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
		transition: transform 0.2s, opacity 0.2s;
	}

	.search-button:hover:not(:disabled) {
		transform: scale(1.02);
	}

	.search-button:disabled {
		opacity: 0.7;
	}

	.sources-bar {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 14px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.sources-label {
		color: #888;
		font-size: 0.9rem;
	}

	.source-tag {
		padding: 5px 12px;
		border-radius: 20px;
		font-size: 0.8rem;
		font-weight: 500;
	}

	/* Main Content - 2 Column */
	.main-content {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 1.2fr;
		gap: 24px;
		padding: 24px;
		max-width: 1600px;
		margin: 0 auto;
		width: 100%;
		min-height: 0;
		overflow: hidden;
	}

	/* Loading State */
	.loading-state {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 80px;
		gap: 20px;
	}

	.spinner {
		width: 50px;
		height: 50px;
		border: 4px solid rgba(0,212,255,0.2);
		border-top-color: #00d4ff;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.loading-state p {
		color: #888;
		font-size: 1.1rem;
	}

	/* Welcome & Empty State */
	.welcome-state, .empty-state {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 80px;
		text-align: center;
	}

	.welcome-icon, .empty-icon {
		font-size: 4rem;
		margin-bottom: 20px;
		opacity: 0.8;
	}

	.welcome-state h2, .empty-state h2 {
		color: #fff;
		margin-bottom: 10px;
	}

	.welcome-state p, .empty-state p {
		color: #888;
		margin-bottom: 24px;
	}

	.quick-search {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.quick-search span {
		color: #666;
	}

	.quick-search button {
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.1);
		color: #00d4ff;
		padding: 8px 16px;
		border-radius: 20px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.quick-search button:hover {
		background: rgba(0,212,255,0.2);
		border-color: rgba(0,212,255,0.3);
	}

	/* Results Panel */
	.results-panel {
		background: rgba(255,255,255,0.02);
		border-radius: 20px;
		border: 1px solid rgba(255,255,255,0.08);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-height: 0;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 20px 24px;
		background: rgba(255,255,255,0.03);
		border-bottom: 1px solid rgba(255,255,255,0.05);
		flex-shrink: 0;
	}

	.panel-header h3 {
		color: #fff;
		font-size: 1.1rem;
	}

	.result-count {
		color: #666;
		font-size: 0.9rem;
	}

	.results-list {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-height: 0;
	}

	.result-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 14px;
		padding: 18px;
		text-align: left;
		cursor: pointer;
		transition: all 0.25s ease;
		width: 100%;
		color: inherit;
		font: inherit;
	}

	.result-card:hover {
		background: rgba(255,255,255,0.06);
		border-color: rgba(0,212,255,0.3);
		transform: translateX(4px);
	}

	.result-card.selected {
		background: rgba(0,212,255,0.1);
		border-color: #00d4ff;
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}

	.source-chip {
		padding: 4px 12px;
		border-radius: 16px;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.source-chip.large {
		padding: 6px 16px;
		font-size: 0.95rem;
	}

	.page-num {
		color: #666;
		font-size: 0.85rem;
	}

	.card-title {
		color: #fff;
		font-size: 1rem;
		margin-bottom: 8px;
		line-height: 1.4;
	}

	.card-snippet {
		color: #888;
		font-size: 0.9rem;
		line-height: 1.6;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-footer {
		margin-top: 10px;
	}

	.relevance-badge {
		background: rgba(255,255,255,0.05);
		padding: 4px 10px;
		border-radius: 10px;
		font-size: 0.75rem;
		color: #666;
	}

	/* Load More Button */
	.load-more-btn {
		background: rgba(0,212,255,0.1);
		border: 1px solid rgba(0,212,255,0.3);
		color: #00d4ff;
		padding: 14px 24px;
		border-radius: 12px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		width: 100%;
		text-align: center;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}

	.load-more-btn:hover:not(:disabled) {
		background: rgba(0,212,255,0.2);
		border-color: rgba(0,212,255,0.5);
	}

	.load-more-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.load-more-cards {
		background: rgba(168,85,247,0.1);
		border-color: rgba(168,85,247,0.3);
		color: #a855f7;
		margin-top: 12px;
	}

	.load-more-cards:hover {
		background: rgba(168,85,247,0.2);
		border-color: rgba(168,85,247,0.5);
	}

	.spinner-sm {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(0,212,255,0.2);
		border-top-color: #00d4ff;
		border-radius: 50%;
		animation: spin 1s linear infinite;
		display: inline-block;
	}

	/* Detail Panel */
	.detail-panel {
		background: rgba(255,255,255,0.02);
		border-radius: 20px;
		border: 1px solid rgba(255,255,255,0.08);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-height: 0;
	}

	.detail-placeholder {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 60px;
		text-align: center;
		color: #666;
	}

	.placeholder-icon {
		font-size: 3rem;
		margin-bottom: 16px;
		opacity: 0.5;
	}

	.detail-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 20px 24px;
		background: rgba(255,255,255,0.03);
		border-bottom: 1px solid rgba(255,255,255,0.05);
		flex-shrink: 0;
		gap: 12px;
	}

	.detail-page {
		color: #888;
		font-size: 0.95rem;
	}

	.page-count {
		color: #00d4ff;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.detail-title {
		padding: 24px;
		color: #fff;
		font-size: 1.3rem;
		line-height: 1.4;
		border-bottom: 1px solid rgba(255,255,255,0.05);
		flex-shrink: 0;
	}

	/* Local Search */
	.local-search-container {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 24px;
		background: rgba(255,255,255,0.02);
		border-bottom: 1px solid rgba(255,255,255,0.05);
		flex-wrap: wrap;
		flex-shrink: 0;
	}

	.local-search-box {
		flex: 1;
		min-width: 200px;
		display: flex;
		align-items: center;
		gap: 10px;
		background: rgba(0,0,0,0.3);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 10px;
		padding: 8px 14px;
		transition: border-color 0.2s;
	}

	.local-search-box:focus-within {
		border-color: rgba(168,85,247,0.5);
	}

	.local-search-icon {
		font-size: 1rem;
		opacity: 0.7;
	}

	.local-search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		font-size: 0.9rem;
		color: #fff;
		padding: 4px 0;
	}

	.local-search-input::placeholder {
		color: #666;
	}

	.clear-btn {
		background: rgba(255,255,255,0.1);
		border: none;
		color: #888;
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.clear-btn:hover {
		background: rgba(255,255,255,0.2);
		color: #fff;
	}

	.match-badge {
		background: rgba(52,211,153,0.2);
		color: #34d399;
		padding: 6px 12px;
		border-radius: 12px;
		font-size: 0.8rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.match-badge.no-match {
		background: rgba(239,68,68,0.2);
		color: #f87171;
	}

	.copy-btn {
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.1);
		color: #888;
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.copy-btn:hover {
		background: rgba(255,255,255,0.1);
		color: #fff;
	}

	/* Detail Content - Scrollable */
	.detail-content {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* Daftar Isi Navigation */
	.toc-nav {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 14px;
		padding: 16px 20px;
		margin-bottom: 20px;
		flex-shrink: 0;
	}

	.toc-label {
		display: block;
		color: #888;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: 12px;
	}

	.toc-items {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.toc-item {
		display: flex;
		align-items: center;
		gap: 6px;
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 0.8rem;
		color: #c8c8c8;
		cursor: pointer;
		transition: all 0.2s;
		max-width: 200px;
	}

	.toc-item:hover {
		background: rgba(0,212,255,0.15);
		border-color: rgba(0,212,255,0.3);
		color: #00d4ff;
	}

	.toc-text {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cards-container {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	/* Content Cards */
	.content-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.05);
		border-radius: 14px;
		padding: 18px 22px;
		transition: opacity 0.3s ease;
		animation: fadeSlideIn 0.3s ease forwards;
		animation-delay: calc(var(--idx, 0) * 10ms);
		opacity: 0;
	}

	@keyframes fadeSlideIn {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Card Types */
	.content-card.card-section,
	.content-card.card-toc {
		background: linear-gradient(135deg, rgba(168,85,247,0.15), rgba(0,212,255,0.1));
		border-color: rgba(168,85,247,0.3);
		border-radius: 16px;
		padding: 20px 24px;
	}

	.content-card.card-field {
		background: rgba(0,212,255,0.05);
		border-left: 4px solid #00d4ff;
		border-radius: 10px;
	}

	.content-card.card-point,
	.content-card.card-subpoint {
		border-left: 4px solid #a855f7;
		background: rgba(168,85,247,0.05);
	}

	.subpoint-card {
		display: flex;
		gap: 16px;
		align-items: flex-start;
	}

	.subpoint-level {
		color: #00d4ff;
		font-weight: 700;
		font-size: 0.9rem;
		min-width: 50px;
		flex-shrink: 0;
	}

	.subpoint-text {
		color: #c8c8c8;
		font-size: 0.95rem;
		line-height: 1.7;
		flex: 1;
	}

	.content-card.card-label {
		background: rgba(251,191,36,0.1);
		border: 1px dashed rgba(251,191,36,0.3);
		border-radius: 8px;
		padding: 12px 18px;
	}

	.content-card.card-text {
		background: rgba(255,255,255,0.02);
	}

	/* Inner Card Elements */
	.card-header-line {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.card-icon {
		font-size: 1.2rem;
	}

	.section-title {
		color: #fff;
		font-weight: 600;
		font-size: 1.1rem;
	}

	.field-card {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.field-label {
		color: #00d4ff;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.field-value {
		color: #c8c8c8;
		font-size: 0.95rem;
		line-height: 1.6;
	}

	.point-card {
		display: flex;
		gap: 16px;
		align-items: flex-start;
	}

	.point-level {
		color: #a855f7;
		font-weight: 700;
		font-size: 0.9rem;
		min-width: 50px;
	}

	.point-text {
		color: #c8c8c8;
		font-size: 0.95rem;
		line-height: 1.6;
		flex: 1;
	}

	.label-chip {
		display: flex;
	}

	.label-text {
		color: #fbbf24;
		font-size: 0.85rem;
		font-weight: 500;
	}

	.text-card span {
		color: #b0b0b0;
		font-size: 0.95rem;
		line-height: 1.7;
	}

	/* Filter: no match = dimmed */
	.content-card.no-match {
		opacity: 0.25;
		transform: scale(0.98);
	}

	.content-card.has-match {
		opacity: 1;
		transform: scale(1);
	}

	/* Match Navigation Buttons */
	.match-nav {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.nav-btn {
		background: rgba(0,212,255,0.15);
		border: 1px solid rgba(0,212,255,0.3);
		color: #00d4ff;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}

	.nav-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.nav-btn:hover {
		background: rgba(0,212,255,0.3);
		border-color: rgba(0,212,255,0.6);
		transform: scale(1.1);
	}

	/* Highlight */
	:global(.content-card mark) {
		background: rgba(0,212,255,0.35);
		color: #fff;
		padding: 2px 6px;
		border-radius: 4px;
		font-weight: 500;
	}

	.detail-footer {
		padding: 20px 24px;
		background: rgba(255,255,255,0.02);
		border-top: 1px solid rgba(255,255,255,0.05);
		flex-shrink: 0;
	}

	.meta-info {
		display: flex;
		gap: 24px;
		color: #666;
		font-size: 0.85rem;
	}

	.keyword-hint {
		color: #00d4ff;
	}

	/* Source Colors */
	.source-pergub { background: rgba(168,85,247,0.2); color: #c084fc; }
	.source-kep { background: rgba(52,211,153,0.2); color: #34d399; }
	.source-permen38 { background: rgba(251,191,36,0.2); color: #fbbf24; }
	.source-permen108 { background: rgba(96,165,250,0.2); color: #60a5fa; }
	.source-default { background: rgba(156,163,175,0.2); color: #9ca3af; }

	/* Scrollbar */
	.results-list::-webkit-scrollbar,
	.detail-content::-webkit-scrollbar {
		width: 8px;
	}

	.results-list::-webkit-scrollbar-track,
	.detail-content::-webkit-scrollbar-track {
		background: rgba(0,0,0,0.2);
		border-radius: 4px;
	}

	.results-list::-webkit-scrollbar-thumb,
	.detail-content::-webkit-scrollbar-thumb {
		background: rgba(255,255,255,0.1);
		border-radius: 4px;
	}

	.results-list::-webkit-scrollbar-thumb:hover,
	.detail-content::-webkit-scrollbar-thumb:hover {
		background: rgba(255,255,255,0.2);
	}

	/* Mobile Tab Bar — hidden on desktop */
	.mobile-tabs {
		display: none;
	}

	/* Back button — hidden on desktop */
	.back-btn {
		display: none;
		align-items: center;
		gap: 6px;
		background: rgba(255,255,255,0.07);
		border: 1px solid rgba(255,255,255,0.12);
		color: #ccc;
		padding: 6px 14px;
		border-radius: 8px;
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.back-btn:hover {
		background: rgba(255,255,255,0.12);
		color: #fff;
	}

	/* Tablet & Mobile (≤ 1024px) */
	@media (max-width: 1024px) {
		.app {
			height: auto;
			min-height: 100vh;
			overflow: visible;
		}

		.main-content {
			grid-template-columns: 1fr;
			overflow: visible;
			padding-top: 0;
			gap: 0;
		}

		.mobile-tabs {
			display: flex;
			grid-column: 1 / -1;
			gap: 0;
			background: rgba(255,255,255,0.03);
			border-bottom: 1px solid rgba(255,255,255,0.07);
			padding: 0 16px;
			position: sticky;
			top: 0;
			z-index: 10;
		}

		.mobile-tab {
			flex: 1;
			background: transparent;
			border: none;
			border-bottom: 3px solid transparent;
			color: #888;
			padding: 14px 8px;
			font-size: 0.9rem;
			font-weight: 600;
			cursor: pointer;
			transition: all 0.2s;
		}

		.mobile-tab.active {
			color: #00d4ff;
			border-bottom-color: #00d4ff;
		}

		.mobile-tab:disabled {
			opacity: 0.4;
			cursor: not-allowed;
		}

		.panel-hidden {
			display: none;
		}

		.results-panel,
		.detail-panel {
			border-radius: 0;
			border-left: none;
			border-right: none;
			min-height: calc(100vh - 280px);
		}

		.results-list {
			max-height: none;
			overflow-y: visible;
		}

		.detail-content {
			overflow-y: visible;
			max-height: none;
		}

		.back-btn {
			display: flex;
		}

		.detail-header {
			flex-wrap: wrap;
			gap: 8px;
			padding: 14px 16px;
		}

		.detail-title {
			padding: 16px;
			font-size: 1.1rem;
		}
	}

	/* Mobile (≤ 640px) */
	@media (max-width: 640px) {
		.header {
			padding: 14px 16px;
		}

		.logo-icon {
			font-size: 1.8rem;
		}

		.logo h1 {
			font-size: 1.3rem;
		}

		.tagline {
			font-size: 0.8rem;
		}

		.stats-bar {
			padding: 10px 16px;
			font-size: 0.82rem;
		}

		.search-section {
			padding: 12px 16px;
		}

		.search-input-wrapper {
			padding: 6px;
			gap: 6px;
		}

		.search-icon {
			display: none;
		}

		.search-input {
			font-size: 0.95rem;
			padding: 10px 0;
		}

		.search-button {
			padding: 10px 18px;
			font-size: 0.9rem;
			flex-shrink: 0;
		}

		.sources-bar {
			gap: 6px;
			margin-top: 10px;
		}

		.source-tag {
			padding: 4px 8px;
			font-size: 0.72rem;
		}

		.main-content {
			padding: 0;
		}

		.panel-header {
			padding: 14px 16px;
		}

		.results-list {
			padding: 12px;
		}

		.result-card {
			padding: 14px;
		}

		.card-header {
			flex-wrap: wrap;
			gap: 6px;
		}

		.local-search-container {
			padding: 10px 12px;
			gap: 8px;
		}

		.local-search-box {
			min-width: 0;
		}

		.copy-btn {
			display: none;
		}

		.detail-content {
			padding: 12px;
		}

		.content-card {
			padding: 14px 16px;
		}

		.point-card,
		.subpoint-card {
			gap: 10px;
		}

		.point-level,
		.subpoint-level {
			min-width: 36px;
		}

		.toc-item {
			max-width: 100%;
		}

		.detail-footer {
			padding: 12px 16px;
		}

		.meta-info {
			flex-wrap: wrap;
			gap: 8px;
		}

		.welcome-state,
		.empty-state {
			padding: 40px 20px;
		}

		.welcome-icon,
		.empty-icon {
			font-size: 3rem;
		}
	}
</style>
