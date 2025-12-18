const PAPER_PATH = 'core.tex';
const LATEX_ASSET_BASE = 'https://cdn.jsdelivr.net/npm/latex.js@0.12.6/dist/';

let latexAssetsAttached = false;

document.addEventListener('DOMContentLoaded', () => {
  loadPaper();
});

async function loadPaper() {
  const statusEl = document.getElementById('paper-status');
  const paperEl = document.getElementById('paper-content');

  setStatus(statusEl, 'Loading main paper…');

  try {
    const res = await fetch(PAPER_PATH);
    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`);
    }

    const rawTex = await res.text();
    const body = extractBody(rawTex);

    try {
      const rendered = renderWithLatexJs(body);
      paperEl.replaceChildren(rendered);
      setStatus(statusEl, 'Rendered with LaTeX.js');
    } catch (latexErr) {
      console.warn('LaTeX.js render failed, falling back to Markdown', latexErr);
      const fallbackHtml = renderWithMarkdown(body);
      paperEl.innerHTML = fallbackHtml;
      setStatus(statusEl, 'Rendered with Markdown fallback');
    }

    if (window.MathJax && window.MathJax.typesetPromise) {
      await window.MathJax.typesetPromise([paperEl]);
    }
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

function renderWithLatexJs(body) {
  if (!window.latexjs) {
    throw new Error('LaTeX.js is not available on window.latexjs');
  }

  const normalized = normalizeLatex(body);
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

function normalizeLatex(body) {
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

  text = text.replace(/\\begin\{lemma\}/g, '\\paragraph{Lemma.}');
  text = text.replace(/\\end\{lemma\}/g, '');
  text = text.replace(/\\begin\{proof\}/g, '\\paragraph{Proof.}');
  text = text.replace(/\\end\{proof\}/g, '');

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

function renderWithMarkdown(body) {
  if (!window.marked) {
    throw new Error('marked is not available for fallback rendering');
  }

  const mdSource = latexToMarkdown(body);
  window.marked.setOptions({
    mangle: false,
    headerIds: false
  });

  return window.marked.parse(mdSource);
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

  md = md.replace(/\\begin\{itemize\}/g, '');
  md = md.replace(/\\end\{itemize\}/g, '');
  md = md.replace(/\\item\s*/g, '- ');

  md = md.replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_, eq) => `$$\n${eq.trim()}\n$$`);
  md = md.replace(/\\begin\{gather\*?\}([\s\S]*?)\\end\{gather\*?\}/g, (_, eq) => `$$\n${eq.trim()}\n$$`);

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

  md = md.replace(/\\begin\{lemma\}/g, '**Lemma.**');
  md = md.replace(/\\end\{lemma\}/g, '');
  md = md.replace(/\\begin\{proof\}/g, '**Proof.**');
  md = md.replace(/\\end\{proof\}/g, '');
  md = md.replace(/\\appendix/g, '\n## Appendix\n');
  md = md.replace(/\\newpage/g, '');
  md = md.replace(/\\onecolumn/g, '');

  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}
