// ===== STATE =====
let library = JSON.parse(localStorage.getItem('scholar_library') || '[]');
let currentResults = [];
let currentFormat = 'apa';
let isSearching = false;

// ===== DOM REFS =====
const $ = id => document.getElementById(id);
const searchInput = $('search-input');
const searchBtn = $('search-btn');
const resultsGrid = $('results-grid');
const resultsHeader = $('results-header');
const resultsTitle = $('results-title');
const resultsCount = $('results-count');
const emptyState = $('empty-state');
const libraryGrid = $('library-grid');
const libraryEmpty = $('library-empty');
const libraryCount = $('library-count');
const citationsList = $('citations-list');
const citeEmpty = $('cite-empty');
const modal = $('detail-modal');
const modalBody = $('modal-body');
const toastContainer = $('toast-container');

// ===== TABS =====
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        $('tab-' + tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'library') renderLibrary();
        if (tab.dataset.tab === 'cite') renderCitations();
    });
});

// ===== TOAST =====
function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    toastContainer.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// ===== API SEARCH =====
async function searchCrossRef(query, yearFrom, yearTo, rows) {
    let url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${rows}&sort=relevance`;
    if (yearFrom) url += `&filter=from-pub-date:${yearFrom}`;
    if (yearTo) url += `,until-pub-date:${yearTo}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.message?.items || []).map(item => ({
        id: item.DOI || Math.random().toString(36),
        title: Array.isArray(item.title) ? item.title[0] : (item.title || 'Untitled'),
        authors: (item.author || []).map(a => `${a.given || ''} ${a.family || ''}`).filter(Boolean),
        year: item.published?.['date-parts']?.[0]?.[0] || item.created?.['date-parts']?.[0]?.[0] || '',
        journal: (item['container-title'] || [])[0] || '',
        doi: item.DOI || '',
        url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''),
        abstract: item.abstract ? item.abstract.replace(/<[^>]*>/g, '') : '',
        type: item.type || 'article',
        citations: item['is-referenced-by-count'] || 0,
        source: 'CrossRef'
    }));
}

async function searchSemantic(query, yearFrom, yearTo, rows) {
    let url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${Math.min(rows, 100)}&fields=title,authors,year,abstract,citationCount,externalIds,journal,url,publicationTypes`;
    if (yearFrom) url += `&year=${yearFrom}-${yearTo || ''}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.data || []).map(item => ({
        id: item.paperId || Math.random().toString(36),
        title: item.title || 'Untitled',
        authors: (item.authors || []).map(a => a.name),
        year: item.year || '',
        journal: item.journal?.name || '',
        doi: item.externalIds?.DOI || '',
        url: item.url || '',
        abstract: item.abstract || '',
        type: (item.publicationTypes || ['article'])[0] || 'article',
        citations: item.citationCount || 0,
        source: 'Semantic Scholar'
    }));
}

async function searchOpenAlex(query, yearFrom, yearTo, rows) {
    let url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${rows}&mailto=scholar@example.com`;
    if (yearFrom && yearTo) url += `&filter=publication_year:${yearFrom}-${yearTo}`;
    else if (yearFrom) url += `&filter=publication_year:${yearFrom}-2026`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.results || []).map(item => ({
        id: item.id || Math.random().toString(36),
        title: item.title || 'Untitled',
        authors: (item.authorships || []).map(a => a.author?.display_name).filter(Boolean),
        year: item.publication_year || '',
        journal: item.primary_location?.source?.display_name || '',
        doi: item.doi ? item.doi.replace('https://doi.org/', '') : '',
        url: item.doi || item.primary_location?.landing_page_url || '',
        abstract: item.abstract_inverted_index ? reconstructAbstract(item.abstract_inverted_index) : '',
        type: item.type || 'article',
        citations: item.cited_by_count || 0,
        source: 'OpenAlex'
    }));
}

function reconstructAbstract(invertedIndex) {
    if (!invertedIndex) return '';
    const words = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
        positions.forEach(pos => { words[pos] = word; });
    }
    return words.join(' ');
}

async function doSearch() {
    const query = searchInput.value.trim();
    if (!query || isSearching) return;
    isSearching = true;
    searchBtn.classList.add('loading');
    emptyState.style.display = 'none';
    resultsHeader.style.display = 'flex';
    resultsTitle.textContent = 'Searching...';
    resultsCount.textContent = '';
    resultsGrid.innerHTML = Array(3).fill(`
        <div class="skeleton-card">
            <div class="skeleton-line w40"></div>
            <div class="skeleton-line title"></div>
            <div class="skeleton-line w60"></div>
            <div class="skeleton-line w100"></div>
            <div class="skeleton-line w80"></div>
        </div>
    `).join('');

    const source = $('filter-source').value;
    const yearFrom = $('filter-year-from').value;
    const yearTo = $('filter-year-to').value;
    const count = parseInt($('filter-count').value);

    try {
        let results;
        if (source === 'crossref') results = await searchCrossRef(query, yearFrom, yearTo, count);
        else if (source === 'semantic') results = await searchSemantic(query, yearFrom, yearTo, count);
        else results = await searchOpenAlex(query, yearFrom, yearTo, count);

        currentResults = results;
        resultsTitle.textContent = `Results for "${query}"`;
        resultsCount.textContent = `${results.length} papers found`;
        renderResults(results);
        if (results.length === 0) {
            resultsGrid.innerHTML = '';
            emptyState.style.display = 'block';
            emptyState.querySelector('h3').textContent = 'No Results Found';
            emptyState.querySelector('p').textContent = 'Try different keywords or change the source.';
        }
    } catch (err) {
        console.error(err);
        showToast('Search failed. Try again or switch source.', 'error');
        resultsGrid.innerHTML = '';
        resultsTitle.textContent = 'Search Error';
    }
    isSearching = false;
    searchBtn.classList.remove('loading');
}

// ===== NLP PARSER =====
function analyzeAbstract(abstract) {
    if (!abstract) return null;
    const text = abstract.toLowerCase();
    
    // Heuristics for objectives
    const objMatch = abstract.match(/([^.]*\b(aim|purpose|objective|goal|we propose|this paper|this study)\b[^.]*\.)/i);
    const objective = objMatch ? objMatch[0].trim() : 'Not explicitly stated';

    // Heuristics for methods
    const methMatch = abstract.match(/([^.]*\b(method|methodology|approach|dataset|experiment|evaluate|model|framework|algorithm)\b[^.]*\.)/i);
    const methodology = methMatch ? methMatch[0].trim() : 'Not explicitly stated';

    // Heuristics for results
    const resMatch = abstract.match(/([^.]*\b(result|show|demonstrate|outperform|achieve|conclude|finding)\b[^.]*\.)/gi);
    const results = resMatch ? resMatch[resMatch.length - 1].trim() : 'Not explicitly stated';

    return { objective, methodology, results };
}

// ===== RENDER RESULTS =====
function renderResults(papers) {
    resultsGrid.innerHTML = papers.map((p, i) => {
        const insights = analyzeAbstract(p.abstract);
        const insightsHtml = insights ? `
            <div class="paper-insights" style="margin-top: 10px; padding: 10px; background: rgba(0, 206, 201, 0.05); border-left: 2px solid var(--accent-3); border-radius: 4px; font-size: 0.8rem;">
                <div style="margin-bottom: 4px;"><strong>Target:</strong> ${escHtml(insights.objective)}</div>
                <div style="margin-bottom: 4px;"><strong>Method:</strong> ${escHtml(insights.methodology)}</div>
                <div><strong>Findings:</strong> ${escHtml(insights.results)}</div>
            </div>
        ` : '';

        return `
        <div class="paper-card" data-index="${i}">
            <div class="paper-type">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                ${escHtml(p.type)} · ${escHtml(p.source)}
            </div>
            <div class="paper-title">${escHtml(p.title)}</div>
            <div class="paper-authors">${p.authors.length ? escHtml(p.authors.slice(0, 4).join(', ')) + (p.authors.length > 4 ? ' et al.' : '') : 'Unknown authors'}</div>
            <div class="paper-meta">
                ${p.year ? `<span class="meta-tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${p.year}</span>` : ''}
                ${p.journal ? `<span class="meta-tag">${escHtml(p.journal.length > 40 ? p.journal.substring(0, 40) + '...' : p.journal)}</span>` : ''}
                ${p.citations ? `<span class="meta-tag">📄 ${p.citations} citations</span>` : ''}
            </div>
            ${p.abstract ? `<div class="paper-abstract">${escHtml(p.abstract)}</div>` : ''}
            ${insightsHtml}
            <div class="paper-actions" style="margin-top: 14px;">
                <button class="paper-btn save-btn ${isInLibrary(p) ? 'saved' : ''}" onclick="event.stopPropagation(); toggleSave(${i})">
                    <svg viewBox="0 0 24 24" fill="${isInLibrary(p) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    ${isInLibrary(p) ? 'Saved' : 'Save'}
                </button>
                ${p.url ? `<a class="paper-btn primary-btn" href="${escHtml(p.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    Open
                </a>` : ''}
                <button class="paper-btn" onclick="event.stopPropagation(); openDetail(${i})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    Details
                </button>
            </div>
        </div>
        `;
    }).join('');
}

function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

// ===== LIBRARY =====
function isInLibrary(paper) { return library.some(p => p.title === paper.title); }

function toggleSave(index) {
    const paper = currentResults[index];
    if (!paper) return;
    if (isInLibrary(paper)) {
        library = library.filter(p => p.title !== paper.title);
        showToast('Removed from library', 'info');
    } else {
        library.push({ ...paper });
        showToast('Saved to library!', 'success');
    }
    saveLibrary();
    renderResults(currentResults);
}

function removeSaved(index) {
    library.splice(index, 1);
    saveLibrary();
    renderLibrary();
    showToast('Removed from library', 'info');
}

function saveLibrary() {
    localStorage.setItem('scholar_library', JSON.stringify(library));
    libraryCount.textContent = library.length;
}

function renderLibrary() {
    libraryCount.textContent = library.length;
    if (library.length === 0) {
        libraryGrid.innerHTML = '';
        libraryEmpty.style.display = 'block';
        return;
    }
    libraryEmpty.style.display = 'none';
    libraryGrid.innerHTML = library.map((p, i) => `
        <div class="paper-card">
            <div class="paper-type">${escHtml(p.type)} · ${escHtml(p.source)}</div>
            <div class="paper-title">${escHtml(p.title)}</div>
            <div class="paper-authors">${p.authors?.length ? escHtml(p.authors.slice(0, 4).join(', ')) + (p.authors.length > 4 ? ' et al.' : '') : 'Unknown'}</div>
            <div class="paper-meta">
                ${p.year ? `<span class="meta-tag">${p.year}</span>` : ''}
                ${p.journal ? `<span class="meta-tag">${escHtml(p.journal.length > 40 ? p.journal.substring(0, 40) + '...' : p.journal)}</span>` : ''}
                ${p.citations ? `<span class="meta-tag">📄 ${p.citations} citations</span>` : ''}
            </div>
            ${p.abstract ? `<div class="paper-abstract">${escHtml(p.abstract)}</div>` : ''}
            <div class="paper-actions">
                <button class="paper-btn" onclick="removeSaved(${i})" style="color:#ff6b6b;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    Remove
                </button>
                ${p.url ? `<a class="paper-btn primary-btn" href="${escHtml(p.url)}" target="_blank" rel="noopener">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    Open
                </a>` : ''}
            </div>
        </div>
    `).join('');
}

// ===== MODAL =====
function openDetail(index) {
    const p = currentResults[index];
    if (!p) return;
    modalBody.innerHTML = `
        <div class="paper-type">${escHtml(p.type)} · ${escHtml(p.source)}</div>
        <h2>${escHtml(p.title)}</h2>
        <div class="modal-authors">${p.authors?.length ? escHtml(p.authors.join(', ')) : 'Unknown authors'}</div>
        <div class="modal-meta">
            ${p.year ? `<span class="meta-tag">${p.year}</span>` : ''}
            ${p.journal ? `<span class="meta-tag">${escHtml(p.journal)}</span>` : ''}
            ${p.doi ? `<span class="meta-tag">DOI: ${escHtml(p.doi)}</span>` : ''}
            ${p.citations ? `<span class="meta-tag">📄 ${p.citations} citations</span>` : ''}
        </div>
        ${p.abstract ? `<div class="modal-abstract"><h3>Abstract</h3>${escHtml(p.abstract)}</div>` : '<div class="modal-abstract"><h3>Abstract</h3><p style="color:var(--text-muted)">No abstract available.</p></div>'}
        <div class="modal-links">
            <button class="paper-btn save-btn ${isInLibrary(p) ? 'saved' : ''}" onclick="toggleSave(${index}); openDetail(${index});">
                <svg viewBox="0 0 24 24" fill="${isInLibrary(p) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                ${isInLibrary(p) ? 'Saved' : 'Save to Library'}
            </button>
            ${p.url ? `<a class="paper-btn primary-btn" href="${escHtml(p.url)}" target="_blank" rel="noopener">Open Source ↗</a>` : ''}
            ${p.doi ? `<button class="paper-btn" onclick="navigator.clipboard.writeText('${escHtml(p.doi)}'); showToast('DOI copied!','success');">Copy DOI</button>` : ''}
        </div>
    `;
    modal.classList.add('active');
}

$('modal-close').addEventListener('click', () => modal.classList.remove('active'));
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });

// ===== CITATIONS =====
function formatAPA(p) {
    const authors = p.authors?.length ? (p.authors.length <= 2 ? p.authors.map(a => { const parts = a.trim().split(' '); return parts.length > 1 ? `${parts[parts.length-1]}, ${parts.slice(0,-1).map(n=>n[0]+'.').join(' ')}` : a; }).join(' & ') : (() => { const parts = p.authors[0].trim().split(' '); return (parts.length > 1 ? `${parts[parts.length-1]}, ${parts.slice(0,-1).map(n=>n[0]+'.').join(' ')}` : p.authors[0]) + ' et al.'; })()) : 'Unknown';
    const year = p.year ? ` (${p.year}). ` : ' (n.d.). ';
    const title = p.title ? p.title + '. ' : '';
    const journal = p.journal ? `<em>${p.journal}</em>. ` : '';
    const doi = p.doi ? `https://doi.org/${p.doi}` : '';
    return `${authors}${year}${title}${journal}${doi}`;
}

function formatMLA(p) {
    const authors = p.authors?.length ? (p.authors.length <= 2 ? p.authors.join(', and ') : p.authors[0] + ', et al.') : 'Unknown';
    const title = p.title ? `"${p.title}." ` : '';
    const journal = p.journal ? `<em>${p.journal}</em>, ` : '';
    const year = p.year || 'n.d.';
    const doi = p.doi ? ` https://doi.org/${p.doi}` : '';
    return `${authors}. ${title}${journal}${year}.${doi}`;
}

function formatChicago(p) {
    const authors = p.authors?.length ? p.authors.join(', ') : 'Unknown';
    const title = p.title ? `"${p.title}." ` : '';
    const journal = p.journal ? `<em>${p.journal}</em> ` : '';
    const year = p.year ? `(${p.year})` : '';
    const doi = p.doi ? `. https://doi.org/${p.doi}` : '';
    return `${authors}. ${title}${journal}${year}${doi}.`;
}

function formatIEEE(p) {
    const authors = p.authors?.length ? (p.authors.length <= 3 ? p.authors.map(a => { const parts = a.trim().split(' '); return parts.length > 1 ? `${parts.slice(0,-1).map(n=>n[0]+'.').join(' ')} ${parts[parts.length-1]}` : a; }).join(', ') : (() => { const parts = p.authors[0].trim().split(' '); return (parts.length > 1 ? `${parts.slice(0,-1).map(n=>n[0]+'.').join(' ')} ${parts[parts.length-1]}` : p.authors[0]) + ' et al.'; })()) : 'Unknown';
    const title = p.title ? `"${p.title}," ` : '';
    const journal = p.journal ? `<em>${p.journal}</em>, ` : '';
    const year = p.year || 'n.d.';
    const doi = p.doi ? `, doi: ${p.doi}` : '';
    return `${authors}, ${title}${journal}${year}${doi}.`;
}

function getCitation(p) {
    if (currentFormat === 'apa') return formatAPA(p);
    if (currentFormat === 'mla') return formatMLA(p);
    if (currentFormat === 'chicago') return formatChicago(p);
    return formatIEEE(p);
}

function renderCitations() {
    if (library.length === 0) {
        citationsList.innerHTML = '';
        citeEmpty.style.display = 'block';
        return;
    }
    citeEmpty.style.display = 'none';
    citationsList.innerHTML = library.map((p, i) => `
        <div class="citation-item">
            <div class="citation-text">${currentFormat === 'ieee' ? `[${i+1}] ` : ''}${getCitation(p)}</div>
            <button class="citation-copy-btn" onclick="copySingleCitation(${i})" title="Copy">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
        </div>
    `).join('');
}

function stripHtml(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; }

function copySingleCitation(i) {
    const text = stripHtml((currentFormat === 'ieee' ? `[${i+1}] ` : '') + getCitation(library[i]));
    navigator.clipboard.writeText(text);
    showToast('Citation copied!', 'success');
}

$('copy-all-btn').addEventListener('click', () => {
    if (library.length === 0) return showToast('No references in library', 'error');
    const all = library.map((p, i) => stripHtml((currentFormat === 'ieee' ? `[${i+1}] ` : '') + getCitation(p))).join('\n\n');
    navigator.clipboard.writeText(all);
    showToast('All citations copied!', 'success');
});

$('export-txt-btn').addEventListener('click', () => {
    if (library.length === 0) return showToast('No references in library', 'error');
    const all = library.map((p, i) => stripHtml((currentFormat === 'ieee' ? `[${i+1}] ` : '') + getCitation(p))).join('\n\n');
    const blob = new Blob([`References (${currentFormat.toUpperCase()} Format)\n${'='.repeat(40)}\n\n${all}`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `references_${currentFormat}.txt`;
    a.click();
    showToast('Exported to TXT!', 'success');
});

// CSV RRL Matrix Export
$('export-csv-btn').addEventListener('click', () => {
    if (library.length === 0) return showToast('No references in library', 'error');
    
    let csv = '\uFEFF'; // BOM for Excel UTF-8 support
    csv += 'Title,Authors,Year,Journal/Source,DOI/URL,Citations,Objective,Methodology,Key Findings\n';
    
    library.forEach(p => {
        const insights = analyzeAbstract(p.abstract) || { objective: '', methodology: '', results: '' };
        const row = [
            `"${(p.title || '').replace(/"/g, '""')}"`,
            `"${(p.authors || []).join('; ').replace(/"/g, '""')}"`,
            p.year || '',
            `"${(p.journal || p.source || '').replace(/"/g, '""')}"`,
            `"${(p.doi || p.url || '').replace(/"/g, '""')}"`,
            p.citations || 0,
            `"${insights.objective.replace(/"/g, '""')}"`,
            `"${insights.methodology.replace(/"/g, '""')}"`,
            `"${insights.results.replace(/"/g, '""')}"`
        ];
        csv += row.join(',') + '\n';
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'RRL_Literature_Matrix.csv';
    a.click();
    showToast('Literature Matrix CSV Exported!', 'success');
});

document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFormat = btn.dataset.format;
        renderCitations();
    });
});

// ===== CLEAR LIBRARY =====
$('clear-library-btn').addEventListener('click', () => {
    if (library.length === 0) return;
    if (confirm('Clear all saved references?')) {
        library = [];
        saveLibrary();
        renderLibrary();
        showToast('Library cleared', 'info');
    }
});

// ===== SORT =====
$('sort-btn').addEventListener('click', () => {
    if (!currentResults.length) return;
    currentResults.sort((a, b) => (b.citations || 0) - (a.citations || 0));
    renderResults(currentResults);
    showToast('Sorted by citation count', 'info');
});

// ===== SEARCH EVENTS =====
searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
document.querySelectorAll('.quick-tag').forEach(tag => {
    tag.addEventListener('click', () => {
        searchInput.value = tag.dataset.query;
        doSearch();
    });
});

// ===== EXTERNAL SEARCH ENGINES =====
$('gs-btn').addEventListener('click', () => {
    const q = searchInput.value.trim();
    if (!q) return showToast('Type a search query first', 'error');
    window.open(`https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`, '_blank');
});
$('pubmed-btn').addEventListener('click', () => {
    const q = searchInput.value.trim();
    if (!q) return showToast('Type a search query first', 'error');
    window.open(`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}`, '_blank');
});
$('arxiv-btn').addEventListener('click', () => {
    const q = searchInput.value.trim();
    if (!q) return showToast('Type a search query first', 'error');
    window.open(`https://arxiv.org/search/?query=${encodeURIComponent(q)}&searchtype=all`, '_blank');
});

// ===== INIT =====
libraryCount.textContent = library.length;
