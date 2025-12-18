const PAPER_PATH = 'core.tex';
const BIB_PATH = 'refs.bib';
const LATEX_ASSET_BASE = 'https://cdn.jsdelivr.net/npm/latex.js@0.12.6/dist/';

let latexAssetsAttached = false;

document.addEventListener('DOMContentLoaded', () => {
  loadPaper();
});

async function loadPaper() {
  const statusEl = document.getElementById('paper-status');
  const paperEl = document.getElementById('paper-content');

  setStatus(statusEl, 'Loading main paper…');

  const bibPromise = fetchBibliography().catch(err => {
    console.warn('Failed to load bibliography', err);
    return null;
  });

  try {
    const res = await fetch(PAPER_PATH);
    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`);
    }

    const rawTex = await res.text();
    const body = extractBody(rawTex);
    const citationOrder = collectCitations(body);
    const citationMap = makeCitationMap(citationOrder);
    const bibEntriesAll = (await bibPromise) || [];
    const bibEntries = filterBibliography(bibEntriesAll, citationOrder);
    const forceLatex = new URLSearchParams(window.location.search).get('renderer') === 'latexjs';

    let rendered = false;

    if (!forceLatex) {
      try {
        const html = renderWithMarkdown(body, citationMap);
        paperEl.innerHTML = html;
        setStatus(statusEl, 'Rendered with Markdown + MathJax');
        rendered = true;
      } catch (mdErr) {
        console.warn('Markdown render failed, trying LaTeX.js', mdErr);
      }
    }

    if (!rendered) {
      const fragment = renderWithLatexJs(body, citationMap);
      paperEl.replaceChildren(fragment);
      setStatus(statusEl, 'Rendered with LaTeX.js');
    }

    if (window.MathJax && window.MathJax.typesetPromise) {
      await window.MathJax.typesetPromise([paperEl]);
    }

    if (bibEntries && bibEntries.length) {
      const refsHtml = renderBibliographySection(bibEntries);
      paperEl.insertAdjacentHTML('beforeend', refsHtml);
    }

    attachCitationHandlers(bibEntries);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, 'Failed to load paper');
    paperEl.innerHTML = `<div class="error">Could not load paper: ${err.message}</div>`;
  }
}

function setStatus(el, text) {
  if (el) {
    el.textContent = text;
  }
}

function extractBody(tex) {
  const start = tex.indexOf('\\begin{document}');
  const end = tex.indexOf('\\end{document}');

  if (start !== -1 && end !== -1 && end > start) {
    return tex.slice(start + '\\begin{document}'.length, end).trim();
  }

  return tex;
}

function renderWithLatexJs(body, citationMap) {
  if (!window.latexjs) {
    throw new Error('LaTeX.js is not available on window.latexjs');
  }

  const normalized = normalizeLatex(body, citationMap);
  const generator = new window.latexjs.HtmlGenerator({ hyphenate: false });

  window.latexjs.parse(normalized, { generator });

  attachLatexAssets(generator);

  return generator.domFragment();
}

function attachLatexAssets(generator) {
  if (latexAssetsAttached) return;
  const assets = generator.stylesAndScripts(LATEX_ASSET_BASE);
  document.head.appendChild(assets);
  latexAssetsAttached = true;
}

function normalizeLatex(body, citationMap) {
  const macroPrelude = [
    '\\newcommand{\\aistatstitle}[1]{\\section*{#1}}',
    '\\newcommand{\\aistatsauthor}[1]{}',
    '\\newcommand{\\aistatsaddress}[1]{}',
    '\\newcommand{\\textproc}[1]{\\texttt{#1}}',
    '\\newcommand{\\mathds}[1]{\\mathbb{#1}}',
    '\\newcommand{\\citep}[1]{[ #1 ]}',
    '\\newcommand{\\citet}[1]{[ #1 ]}',
    '\\newcommand{\\argmax}{\\mathrm{argmax}}',
    '\\newcommand{\\argmin}{\\mathrm{argmin}}',
    '\\newcommand{\\logit}{\\mathrm{logit}}',
    '\\newcommand{\\ceil}[1]{\\lceil #1 \\rceil}',
    '\\newcommand{\\floor}[1]{\\lfloor #1 \\rfloor}'
  ].join('\n');

  let text = body.replace(/^%.*$/gm, '');
  text = text.replace(/\\twocolumn\[/g, '');
  text = text.replace(/^\]\s*$/gm, '');
  text = text.replace(/\\usepackage[^\n]*\n/g, '');
  text = text.replace(/\\bibliographystyle\{[^}]*\}/g, '');
  text = text.replace(/\\addbibresource\{[^}]*\}/g, '');
  text = text.replace(/\\includegraphics\[.*?\]\{[^}]*\}/g, '');
  text = text.replace(/\\newpage/g, '');
  text = text.replace(/\\onecolumn/g, '');
  text = text.replace(/\\appendix/g, '\\section*{Appendix}');
  text = text.replace(/\\label\{[^}]*\}/g, '');

  text = linkCitations(text, citationMap, (num, slug, key) => `<a class="citation" data-citekey="${key}" href="#ref-${slug}">[${num}]</a>`);

  // Normalize theorem-like environments into plain paragraphs so LaTeX.js can render without style files.
  const theoremish = [
    ['theorem', 'Theorem.'],
    ['lemma', 'Lemma.'],
    ['assumption', 'Assumption.'],
    ['corollary', 'Corollary.'],
    ['conjecture', 'Conjecture.'],
    ['proof', 'Proof.']
  ];

  theoremish.forEach(([env, label]) => {
    const beginPattern = new RegExp(`\\\\begin\\{${env}\\*?\\}`, 'g');
    const endPattern = new RegExp(`\\\\end\\{${env}\\*?\\}`, 'g');
    text = text.replace(beginPattern, `\\\\paragraph{${label}}`);
    text = text.replace(endPattern, '');
  });

  text = text.replace(/\\begin\{figure\*?\}[\s\S]*?\\end\{figure\*?\}/g, fig => {
    const caption = (fig.match(/\\caption\{([^}]*)\}/) || [])[1];
    return `\\begin{quote}${caption || 'Figure'}\\end{quote}`;
  });

  text = convertAlgorithmsToVerbatim(text);

  return `${macroPrelude}\n${text}`;
}

function convertAlgorithmsToVerbatim(text) {
  return text.replace(/\\begin\{algorithm\}[\s\S]*?\\end\{algorithm\}/g, match => {
    const inner = match
      .replace(/\\begin\{algorithmic\}\[?\d*\]?/g, '')
      .replace(/\\end\{algorithmic\}/g, '')
      .replace(/\\caption\{[^}]*\}/g, '')
      .replace(/\\label\{[^}]*\}/g, '')
      .trim();

    const cleaned = inner
      .split('\n')
      .map(line => line.replace(/^\\/, '').trim())
      .filter(Boolean)
      .join('\n');

    return `\\begin{verbatim}\n${cleaned}\n\\end{verbatim}`;
  });
}

function renderWithMarkdown(body, citationMap) {
  if (!window.marked) {
    throw new Error('marked is not available for rendering');
  }

  const linkedBody = linkCitations(body, citationMap, (num, slug, key) => `<a class="citation" data-citekey="${key}" href="#ref-${slug}">[${num}]</a>`);
  const mdSource = latexToMarkdown(linkedBody);
  const { text, placeholders } = extractMathPlaceholders(mdSource);
  window.marked.setOptions({
    mangle: false,
    headerIds: false
  });

  const html = window.marked.parse(text);
  return restoreMathPlaceholders(html, placeholders);
}

function latexToMarkdown(body) {
  let md = body.replace(/^%.*$/gm, '');

  md = md.replace(/\\twocolumn\[/g, '');
  md = md.replace(/^\]\s*$/gm, '');
  md = md.replace(/\\aistatstitle\{([^}]*)\}/, '# $1\n');
  md = md.replace(/\\aistatsauthor\{([^}]*)\}/, '*$1*\n');
  md = md.replace(/\\aistatsaddress\{([^}]*)\}/, '*$1*\n');

  md = md.replace(/\\begin\{abstract\}/, '### Abstract\n');
  md = md.replace(/\\end\{abstract\}/, '\n');

  md = md.replace(/\\section\{([^}]*)\}/g, '## $1');
  md = md.replace(/\\subsection\{([^}]*)\}/g, '### $1');
  md = md.replace(/\\subsubsection\{([^}]*)\}/g, '#### $1');

  md = md.replace(/\\begin\{itemize\}/g, '');
  md = md.replace(/\\end\{itemize\}/g, '');
  md = md.replace(/\\item\s*/g, '- ');

  md = md.replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_, eq) => `$$\n${eq.trim()}\n$$`);
  md = md.replace(/\\begin\{gather\*?\}([\s\S]*?)\\end\{gather\*?\}/g, (_, eq) => `$$\n${eq.trim()}\n$$`);
  md = md.replace(/\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g, (_, eq) => `\\[\n${eq.trim()}\n\\]`);

  md = md.replace(/\\label\{[^}]*\}/g, '');
  md = md.replace(/\\textproc\{([^}]*)\}/g, '`$1`');
  md = md.replace(/\\mathds\{([^}]*)\}/g, (_, symbol) => `\\mathbb{${symbol}}`);
  md = md.replace(/\\cite(p|t)?\{([^}]*)\}/g, '[$2]');

  md = md.replace(/\\begin\{algorithm\}[\s\S]*?\\end\{algorithm\}/g, block => {
    const cleaned = block
      .replace(/\\begin\{algorithmic\}\[?\d*\]?/g, '')
      .replace(/\\end\{algorithmic\}/g, '')
      .replace(/\\caption\{[^}]*\}/g, '')
      .replace(/\\label\{[^}]*\}/g, '');

    const lines = cleaned
      .split('\n')
      .map(line => line.replace(/^\\/, '').trim())
      .filter(Boolean);

    return `\n\`\`\`text\n${lines.join('\n')}\n\`\`\`\n`;
  });

  md = md.replace(/\\begin\{figure\*?\}[\s\S]*?\\end\{figure\*?\}/g, fig => {
    const caption = (fig.match(/\\caption\{([^}]*)\}/) || [])[1];
    const src = (fig.match(/\\includegraphics(?:\[.*?\])?\{([^}]*)\}/) || [])[1];
    const pieces = [];
    if (caption) pieces.push(caption);
    if (src) pieces.push(src);
    const text = pieces.length ? pieces.join(' — ') : 'Figure';
    return `> ${text}\n`;
  });

  const envToHeading = {
    lemma: 'Lemma.',
    theorem: 'Theorem.',
    corollary: 'Corollary.',
    conjecture: 'Conjecture.',
    assumption: 'Assumption.',
    proof: 'Proof.'
  };

  Object.entries(envToHeading).forEach(([env, heading]) => {
    const beginPattern = new RegExp(`\\\\begin\\{${env}\\*?\\}`, 'g');
    const endPattern = new RegExp(`\\\\end\\{${env}\\*?\\}`, 'g');
    md = md.replace(beginPattern, `**${heading}**`);
    md = md.replace(endPattern, '');
  });

  md = md.replace(/\\appendix/g, '\n## Appendix\n');
  md = md.replace(/\\newpage/g, '');
  md = md.replace(/\\onecolumn/g, '');
  md = md.replace(/\\twocolumn/g, '');

  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

function extractMathPlaceholders(mdSource) {
  const placeholders = [];
  let text = mdSource;

  const patterns = [
    /\$\$[\s\S]*?\$\$/g,      // display math with $$
    /\\\[[\s\S]*?\\\]/g,      // display math with \[ \]
    /\$[^$\n]*\$/g            // inline math $
  ];

  patterns.forEach(pattern => {
    text = text.replace(pattern, match => {
      const key = `@@MATH${placeholders.length}@@`;
      placeholders.push(match);
      return key;
    });
  });

  return { text, placeholders };
}

function restoreMathPlaceholders(html, placeholders) {
  return placeholders.reduce((acc, math, idx) => acc.replace(`@@MATH${idx}@@`, math), html);
}

function collectCitations(text) {
  const citeRegex = /\\cite(p|t)?\{([^}]*)\}/g;
  const order = [];
  const seen = new Set();
  let match;

  while ((match = citeRegex.exec(text)) !== null) {
    const keys = match[2].split(',').map(k => k.trim()).filter(Boolean);
    keys.forEach(key => {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    });
  }

  return order;
}

function makeCitationMap(order) {
  const map = {};
  order.forEach((key, idx) => {
    map[key] = idx + 1;
  });
  return map;
}

function filterBibliography(entries, citationOrder) {
  if (!entries || !entries.length) return [];
  const byKey = new Map(entries.map(e => [e.citekey, e]));
  return citationOrder
    .map((key, idx) => {
      const entry = byKey.get(key);
      if (!entry) return { citekey: key, fields: { title: key }, number: idx + 1 };
      return { ...entry, number: idx + 1 };
    })
    .filter(Boolean);
}

async function fetchBibliography() {
  const res = await fetch(BIB_PATH);
  if (!res.ok) {
    throw new Error(`References not found (${res.status})`);
  }

  const raw = await res.text();
  return parseBibtex(raw);
}

function parseBibtex(raw) {
  const entries = [];
  const cleaned = raw.replace(/^[ \t]*%.*$/gm, '');
  const entryRegex = /@(\w+)\s*\{\s*([^,]+),([\s\S]*?)\n\}/g;
  let match;

  while ((match = entryRegex.exec(cleaned)) !== null) {
    const [, type, citekey, body] = match;
    const fields = {};
    const fieldRegex = /(\w+)\s*=\s*(\{[^{}]*\}|\"[^\"]*\"|[^,\n]+)\s*,?/g;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      const [, key, rawVal] = fieldMatch;
      const val = rawVal
        .trim()
        .replace(/^{|}$/g, '')
        .replace(/^\"|\"$/g, '')
        .replace(/\s+/g, ' ');
      fields[key.toLowerCase()] = val;
    }

    entries.push({ type: type.toLowerCase(), citekey, fields });
  }

  return entries;
}

function renderBibliographySection(entries) {
  const items = entries
    .map(entry => {
      const slug = slugifyCiteKey(entry.citekey);
      const label = entry.number || '';
      return `<li id="ref-${slug}"><span class="ref-label">[${label}]</span> ${formatBibEntry(entry)}</li>`;
    })
    .join('');

  return `
    <section class="references">
      <h2 id="references">References</h2>
      <ol>
        ${items}
      </ol>
    </section>
  `;
}

function formatBibEntry({ citekey, fields }) {
  const title = fields.title || citekey;
  const authors = fields.author ? formatAuthors(fields.author) : '';
  const venue = fields.journal || fields.booktitle || '';
  const year = fields.year ? ` (${fields.year})` : '';
  const link = fields.doi
    ? ` <a href="https://doi.org/${fields.doi}" target="_blank" rel="noopener noreferrer">doi</a>`
    : fields.url
    ? ` <a href="${fields.url}" target="_blank" rel="noopener noreferrer">link</a>`
    : '';

  const parts = [
    `<span class="ref-title">${title}</span>${year}`,
    authors && ` ${authors}`,
    venue && ` — ${venue}`,
    link
  ].filter(Boolean);

  return parts.join('');
}

function formatAuthors(raw) {
  const authors = raw.split(/\s+and\s+/i).map(a => a.trim());
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
  return `${authors.slice(0, -1).join(', ')}, & ${authors[authors.length - 1]}`;
}

function linkCitations(text, citationMap, formatter) {
  if (!citationMap || Object.keys(citationMap).length === 0) return text;
  const citeRegex = /\\cite(p|t)?\{([^}]*)\}/g;
  return text.replace(citeRegex, (_, __, content) => {
    const keys = content.split(',').map(k => k.trim()).filter(Boolean);
    if (!keys.length) return '';
    const links = keys.map(key => {
      const num = citationMap[key];
      if (!num) return key;
      return formatter(num, slugifyCiteKey(key), key);
    });
    return links.join(' ');
  });
}

function slugifyCiteKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function attachCitationHandlers(entries) {
  const paperEl = document.getElementById('paper-content');
  const sidePanel = document.getElementById('side-panel-body');
  if (!paperEl || !sidePanel) return;
  const byKey = new Map(entries.map(e => [e.citekey, e]));

  paperEl.querySelectorAll('a.citation').forEach(anchor => {
    anchor.addEventListener('click', evt => {
      evt.preventDefault();
      const key = anchor.dataset.citekey;
      const entry = byKey.get(key);
      if (entry) {
        sidePanel.innerHTML = renderReferenceDetail(entry);
        sidePanel.className = 'reference-detail';
      } else {
        sidePanel.innerHTML = `<p>Reference not found for ${key}.</p>`;
        sidePanel.className = 'proof-placeholder';
      }
    });
  });
}

function renderReferenceDetail(entry) {
  const title = entry.fields.title || entry.citekey;
  const authors = entry.fields.author ? formatAuthors(entry.fields.author) : '';
  const venue = entry.fields.journal || entry.fields.booktitle || '';
  const year = entry.fields.year || '';
  const link = entry.fields.doi
    ? `https://doi.org/${entry.fields.doi}`
    : entry.fields.url || '';

  const parts = [
    `<span class="ref-title">${title}${year ? ` (${year})` : ''}</span>`,
    authors ? `<div class="ref-authors">${authors}</div>` : '',
    venue ? `<div class="ref-venue">${venue}</div>` : '',
    link ? `<div><a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a></div>` : ''
  ].filter(Boolean);

  return parts.join('');
}
