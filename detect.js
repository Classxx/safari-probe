() => {
  const vw = document.documentElement.clientWidth;
  const issues = [];
  const name = (e) => {
    const cls = (e.className && typeof e.className === 'string') ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const txt = (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${e.tagName.toLowerCase()}${cls}${txt ? ` «${txt}»` : ''}`;
  };
  const clipped = (e) => {
    // Внутри прокручиваемого/обрезающего предка (карусели, ленты) вылезание — норма.
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true;
    }
    return false;
  };
  if (document.documentElement.scrollWidth > vw + 1) issues.push({ kind: 'page-hscroll', what: `ширина ${document.documentElement.scrollWidth} > ${vw}` });
  const all = [...document.querySelectorAll('body *')].filter((e) => {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed') return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  for (const e of all) {
    const r = e.getBoundingClientRect();
    if ((r.right > vw + 2 || r.left < -2) && !clipped(e)) issues.push({ kind: 'out-of-viewport', what: name(e), r: [Math.round(r.left), Math.round(r.right)] });
    const s = getComputedStyle(e);
    // Текст обрезан, а многоточия нет — подпись «съедена».
    if (e.clientWidth > 2 && !e.classList.contains('sr-only') && e.children.length === 0 && (e.innerText || '').trim() && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 2 && !s.webkitLineClamp?.match(/\d/))
      issues.push({ kind: 'text-cut', what: name(e), w: [e.clientWidth, e.scrollWidth] });
    // Ребёнок шире родителя без обрезки — «вылезает за плашку».
    const p = e.parentElement;
    if (p && p !== document.body) {
      const pr = p.getBoundingClientRect(); const ps = getComputedStyle(p);
      if (pr.width > 2 && ps.display !== 'contents' && !clipped(e) && !/(auto|scroll|hidden|clip)/.test(ps.overflowX) && r.right > pr.right + 4 && r.width <= vw && s.position !== 'absolute' && (e.innerText || '').trim())
        issues.push({ kind: 'overflows-parent', what: name(e), by: Math.round(r.right - pr.right), parent: name(p).slice(0, 60) });
      // По вертикали: текст переносится и вылезает вниз за плашку с заданной
      // высотой (заголовок в три строки на узкой плитке).
      if (pr.height > 2 && ps.display !== 'contents' && !clipped(e) && !/(auto|scroll|hidden|clip)/.test(ps.overflowY) && (ps.height !== 'auto' || ps.aspectRatio !== 'auto' || ps.position === 'absolute') && r.bottom > pr.bottom + 4 && (e.innerText || '').trim() && e.children.length === 0)
        issues.push({ kind: 'spills-down', what: name(e), by: Math.round(r.bottom - pr.bottom), parent: name(p).slice(0, 60) });
    }
  }
  // Дедуп по kind+what
  const seen = new Set();
  return issues.filter((i) => { const k = i.kind + i.what; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
};

module.exports = { DETECT }
