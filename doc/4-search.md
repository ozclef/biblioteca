

Perfecto — vamos a montarte un **buscador local estilo Google** con vistas previas inteligentes y enfoque por tipo de archivo (MD, HTML, JS, JSON, PY, etc.), que:

* indexa **todo** lo que haya en `data/manifest.json` (o en tus `repos/`) y descarga el texto necesario,
* prioriza **.md** (tu principal fuente de conversaciones/notes) y luego HTML/JS/PY/JSON,
* muestra **sugerencias en vivo** mientras escribes (autocomplete),
* ofrece una **vista previa** para cada resultado:

  * Markdown → renderizado (no muestra conversaciones privadas si lo marcas como privado — detalles abajo),
  * HTML → render seguro en un iframe *sandbox* o vista de código,
  * JS / PY / JSON → vista de código con resaltado + snippet,
  * Imágenes → miniatura,
* es **resiliente**: si algún fetch falla pasa al siguiente archivo,
* y **todo se ejecuta localmente** en el navegador (no envía nada a servidores).

Te doy: 1) cómo marcar archivos privados para que no aparezcan en resultados, 2) el HTML/CSS/JS listos para pegar en tu `index.html` (o `search.html`) que se integra con el manifest/loader que ya tienes, y 3) notas de seguridad y mejoras opcionales.

---

## 1) Convenciones para privacidad / exclusión

Para que el buscador **omita** archivos sensibles (por ejemplo tus conversaciones), usa **alguna** de estas opciones (elige la que prefieras):

* Añadir en el `manifest.json` un campo `private: true` para el archivo. Ejemplo:

  ```json
  { "path": "repos/algo/conversacion-oculta.md", "ext": "md", "private": true }
  ```
* O añadir YAML frontmatter en el propio `.md`:

  ```md
  ---
  private: true
  ---
  Texto secreto...
  ```

  El indexador detectará `private: true` y lo ignorará.
* O renombrar la carpeta con prefijo `_private/` o `.private/`: el `tools/generate-manifest.js` puede marcar esos archivos automáticamente.

**Por defecto el script no enviará nada fuera de tu navegador** — todo es local (manifest + fetches locales). Si quieres que cierto archivo no se indexe automáticamente, márcalo `private` o ponlo en `.private/`.

---

## 2) Qué hace el buscador (resumen técnico)

* Carga `data/manifest.json`.
* Filtra archivos `private: true` y extensiones no indexables.
* Para cada archivo indexable (.md, .html, .js, .py, .json, .txt) hace `fetch(text)` (con tolerancia a errores).
* Extrae metadatos:

  * `title`: primer H1/H2 en MD/HTML o filename.
  * `snippet`: primeras ~300 chars (limpio).
  * `content`: texto completo (para búsquedas y vista previa).
* Construye índice con **Fuse.js** (fuzzy) usando campos `title`, `snippet`, `content`, `path`, `category` (si existe).
* UI: caja de búsqueda con sugerencias en vivo + lista de resultados + panel de vista previa (render markdown, mostrar código con highlight.js o iframe sandbox).
* Controles: filtros por tipo (MD/HTML/JS/PY/IMG), ordenar por relevancia o fecha (si manifest incluye `mtime`).

---

## 3) Código listo para integrar

Pega esto en un nuevo archivo `scripts/search.js` y añade al `index.html` (o crea `search.html`) los enlaces a las librerías CDN (Fuse.js, marked, highlight.js). Todo es local.

### Dependencias (CDN — pega en `<head>` o justo antes del script)

```html
<!-- Fuse.js para búsqueda fuzzy -->
<script src="https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.min.js"></script>

<!-- Marked para renderizar Markdown en vista previa -->
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

<!-- Highlight.js para resaltado de código -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css">
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/highlight.min.js"></script>
```

### UI (añádelo donde quieras en tu HTML)

```html
<section style="margin-top:18px;">
  <div style="display:flex;gap:8px;align-items:center">
    <input id="global-search" type="search" placeholder="Buscar (ej. inventory, marketplace, window)..." style="flex:1;padding:10px;border-radius:8px;border:1px solid #ddd">
    <select id="filter-type" style="padding:8px;border-radius:8px;border:1px solid #ddd">
      <option value="all">Todos</option>
      <option value="md">Markdown</option>
      <option value="html">HTML</option>
      <option value="js">JS</option>
      <option value="py">PY</option>
      <option value="json">JSON</option>
      <option value="img">Imagenes</option>
    </select>
  </div>

  <div style="display:flex;gap:12px;margin-top:12px">
    <div style="width:48%;min-height:300px;">
      <ul id="suggestions" style="list-style:none;padding:0;margin:0"></ul>
      <div id="results" style="margin-top:8px"></div>
    </div>

    <div id="preview" style="flex:1;min-height:300px;background:#fff;padding:12px;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,0.06)">
      <div id="preview-meta" style="margin-bottom:6px;color:#6b7280;font-size:13px"></div>
      <div id="preview-body"></div>
    </div>
  </div>
</section>
```

### `scripts/search.js` (pégalo completo)

```javascript
// scripts/search.js
// Requiere: Fuse.js, marked, highlight.js cargados antes.
(async function(){
  const MANIFEST_PATH = 'data/manifest.json';
  const MAX_SNIPPET = 300;

  // UI elements
  const input = document.getElementById('global-search');
  const filterSelect = document.getElementById('filter-type');
  const suggestionsEl = document.getElementById('suggestions');
  const resultsEl = document.getElementById('results');
  const previewMeta = document.getElementById('preview-meta');
  const previewBody = document.getElementById('preview-body');

  let manifest = null;
  let indexItems = []; // {path, ext, title, snippet, content, private}
  let fuse = null;

  function safeText(s){
    return (s===null||s===undefined)?'':String(s);
  }

  function short(s, n=MAX_SNIPPET){
    if(!s) return '';
    return s.length > n ? s.slice(0,n) + '…' : s;
  }

  function cleanTextFromHtml(html){
    // simple: create DOM and read textContent
    try{
      const d = new DOMParser().parseFromString(html, 'text/html');
      return d.body.textContent || '';
    }catch(e){ return html; }
  }

  // load manifest
  async function loadManifest(){
    try{
      const r = await fetch(MANIFEST_PATH);
      if(!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return j;
    }catch(e){
      console.error('No se pudo cargar manifest:', e.message);
      return null;
    }
  }

  // Decide si indexar un archivo por extensión
  function extIndexable(ext){
    return ['md','markdown','html','htm','js','mjs','json','py','txt','svg','png','jpg','jpeg','gif'].includes(ext);
  }

  // Detecta private por manifest entry or frontmatter
  async function fetchAndInspect(f){
    const path = f.path;
    const ext = f.ext || path.split('.').pop().toLowerCase();
    const entry = { path, ext, title: null, snippet:'', content:'', private:false };
    try{
      // we fetch text for supported types (also images we skip fetching)
      if(['png','jpg','jpeg','gif','svg'].includes(ext)){
        // image: no text fetch — snippet is empty, but keep as index item
        entry.title = path.split('/').pop();
        entry.snippet = '[imagen]';
        return entry;
      }
      const resp = await fetch(path);
      if(!resp.ok) throw new Error('HTTP ' + resp.status);
      const txt = await resp.text();
      // check frontmatter for private: true
      const fm = txt.match(/^---\n([\s\S]*?)\n---/);
      if(fm){
        if(/private\s*:\s*true/i.test(fm[1])) {
          entry.private = true;
          return entry;
        }
      }
      // content extraction according to ext
      if(ext === 'md' || ext === 'markdown'){
        // try to get first heading as title
        const m = txt.match(/^\s*#\s+(.+)$/m) || txt.match(/^\s*##\s+(.+)$/m);
        entry.title = m ? m[1].trim() : path.split('/').pop();
        // snippet: first paragraph
        const nofm = txt.replace(/^---[\s\S]*?---\s*/,'');
        const firstPara = nofm.split(/\n\s*\n/).find(p=>p.trim());
        entry.snippet = short(firstPara ? firstPara.replace(/\n/g,' ') : nofm.slice(0,MAX_SNIPPET));
        entry.content = nofm;
      } else if(ext === 'html' || ext === 'htm'){
        // parse and get title or H1
        const doc = new DOMParser().parseFromString(txt,'text/html');
        const t = (doc.querySelector('title') && doc.querySelector('title').textContent) || (doc.querySelector('h1') && doc.querySelector('h1').textContent) || path.split('/').pop();
        entry.title = t;
        entry.snippet = short(cleanTextFromHtml(txt));
        entry.content = cleanTextFromHtml(txt);
      } else if(ext === 'js' || ext === 'mjs' || ext === 'py' || ext === 'json' || ext === 'txt'){
        entry.title = path.split('/').pop();
        entry.snippet = short(txt.replace(/\s+/g,' '));
        entry.content = txt;
      } else {
        entry.title = path.split('/').pop();
        entry.snippet = short(txt.replace(/\s+/g,' '));
        entry.content = txt;
      }
    }catch(e){
      console.warn('No se pudo leer', path, e.message);
      entry.title = path.split('/').pop();
      entry.snippet = '[no disponible]';
      entry.content = '';
    }
    return entry;
  }

  // Build index from manifest
  async function buildIndex(){
    manifest = await loadManifest();
    if(!manifest) return;
    const files = manifest.files || manifest.files || [];
    indexItems = [];
    // prioritize MD first (so we schedule them earlier)
    const sorted = files.slice().sort((a,b)=>{
      const pri = (x)=> (x.ext==='md' ? 0 : 1);
      return pri(a)-pri(b);
    });
    for(const f of sorted){
      if(f.private) continue; // skip if manifest marks private
      if(!extIndexable(f.ext)) continue;
      const item = await fetchAndInspect(f);
      if(item.private) continue; // skip hidden via frontmatter
      indexItems.push(item);
    }

    // build Fuse index
    const options = {
      includeScore: true,
      shouldSort: true,
      keys: [
        { name: 'title', weight: 0.7 },
        { name: 'snippet', weight: 0.4 },
        { name: 'content', weight: 0.2 },
        { name: 'path', weight: 0.1 }
      ],
      threshold: 0.35,
      ignoreLocation: true
    };
    fuse = new Fuse(indexItems, options);
  }

  // render suggestions under input as user types
  function renderSuggestions(list){
    suggestionsEl.innerHTML = '';
    const max = Math.min(6, list.length);
    for(let i=0;i<max;i++){
      const item = list[i];
      const li = document.createElement('li');
      li.style.padding = '8px';
      li.style.borderBottom = '1px solid #f1f5f9';
      li.style.cursor = 'pointer';
      li.textContent = `${item.title} — ${item.path}`;
      li.addEventListener('click', ()=> selectResult(item));
      suggestionsEl.appendChild(li);
    }
  }

  // render results list (more detailed)
  function renderResults(list){
    resultsEl.innerHTML = '';
    if(!list || list.length===0){ resultsEl.innerHTML = '<div class="small">Sin resultados</div>'; return; }
    for(const r of list){
      const item = r.item ? r.item : r; // r may be a Fuse result or plain item
      const card = document.createElement('div');
      card.style.padding='8px';
      card.style.border='1px solid #eef2f7';
      card.style.marginBottom='8px';
      card.style.borderRadius='8px';
      card.style.background='#fff';
      card.innerHTML = `<div style="display:flex;justify-content:space-between">
          <div style="font-weight:700">${escapeHtml(item.title)}</div>
          <div style="color:#6b7280;font-size:13px">${escapeHtml(item.ext.toUpperCase())}</div>
        </div>
        <div style="color:#475569;font-size:13px;margin-top:6px">${escapeHtml(item.snippet)}</div>
        <div style="color:#94a3b8;font-size:12px;margin-top:8px">${escapeHtml(item.path)}</div>
      `;
      card.addEventListener('click', ()=> selectResult(item));
      resultsEl.appendChild(card);
    }
  }

  function escapeHtml(s){ return safeText(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // when select a result, show preview
  async function selectResult(item){
    previewMeta.textContent = `${item.title} — ${item.path} — ${item.ext.toUpperCase()}`;
    previewBody.innerHTML = '<div class="small">Cargando preview…</div>';
    try{
      if(['md','markdown'].includes(item.ext)){
        // render markdown to HTML
        const src = item.content || await (await fetch(item.path)).text();
        const nofm = src.replace(/^---[\s\S]*?---\s*/,'');
        previewBody.innerHTML = marked.parse(nofm);
        // highlight code blocks
        previewBody.querySelectorAll('pre code').forEach((block)=> hljs.highlightElement(block));
      } else if(['html','htm'].includes(item.ext)){
        // try to show a sandboxed iframe preview + source below
        const html = item.content || await (await fetch(item.path)).text();
        // iframe
        const iframe = document.createElement('iframe');
        iframe.style.width='100%'; iframe.style.height='320px'; iframe.style.border='1px solid #e6eef8';
        iframe.sandbox = 'allow-same-origin allow-forms allow-popups';
        previewBody.innerHTML = '';
        previewBody.appendChild(iframe);
        iframe.srcdoc = html;
        // also show source
        const h = document.createElement('details');
        h.style.marginTop='8px';
        h.innerHTML = `<summary>Ver código HTML</summary><pre><code>${escapeHtml(html)}</code></pre>`;
        previewBody.appendChild(h);
        h.querySelector('code').className = 'language-html';
        hljs.highlightElement(h.querySelector('code'));
      } else if(['js','mjs'].includes(item.ext)){
        const src = item.content || await (await fetch(item.path)).text();
        previewBody.innerHTML = `<pre><code class="language-javascript">${escapeHtml(src)}</code></pre>`;
        hljs.highlightElement(previewBody.querySelector('code'));
      } else if(['py'].includes(item.ext)){
        const src = item.content || await (await fetch(item.path)).text();
        previewBody.innerHTML = `<pre><code class="language-python">${escapeHtml(src)}</code></pre>`;
        hljs.highlightElement(previewBody.querySelector('code'));
      } else if(['json'].includes(item.ext)){
        const js = item.content || await (await fetch(item.path)).text();
        const pretty = JSON.stringify(JSON.parse(js),null,2);
        previewBody.innerHTML = `<pre><code class="language-json">${escapeHtml(pretty)}</code></pre>`;
        hljs.highlightElement(previewBody.querySelector('code'));
      } else if(['png','jpg','jpeg','gif','svg'].includes(item.ext)){
        previewBody.innerHTML = `<img src="${item.path}" style="max-width:100%;border-radius:6px">`;
      } else {
        // generic: show text source if available
        const src = item.content || await (await fetch(item.path)).text().catch(()=>null);
        if(src){
          previewBody.innerHTML = `<pre><code>${escapeHtml(src)}</code></pre>`;
        } else {
          previewBody.innerHTML = `<div class="small">Previsualización no disponible.</div>`;
        }
      }
    }catch(e){
      previewBody.innerHTML = `<div class="small" style="color:#b91c1c">Error cargando preview: ${escapeHtml(e.message)}</div>`;
    }
    // scroll to preview
    previewBody.scrollIntoView({behavior:'smooth'});
  }

  // perform search and update suggestions/results
  function doSearch(q){
    if(!fuse) return;
    const filter = filterSelect.value;
    if(!q || q.trim().length === 0){
      // no query: show top MD titles as suggestions
      const pool = indexItems.filter(it => filter === 'all' || it.ext === filter).slice(0,20);
      const sug = pool.map(p => ({ title:p.title, path:p.path, ext:p.ext, snippet:p.snippet }));
      renderSuggestions(sug);
      renderResults(sug.map(s=>s));
      return;
    }
    const res = fuse.search(q, {limit: 50});
    // filter by ext if chosen
    const filtered = res.filter(r => (filter === 'all') || (r.item.ext === filter));
    renderSuggestions(filtered.map(f=>f.item));
    renderResults(filtered);
  }

  // events
  input.addEventListener('input', (e)=> doSearch(e.target.value));
  filterSelect.addEventListener('change', ()=> doSearch(input.value));
  // keyboard enter on suggestions -> open first
  input.addEventListener('keydown', (e)=> {
    if(e.key === 'Enter'){
      const q = input.value.trim();
      if(!q) return;
      const r = fuse.search(q, {limit:1});
      if(r && r.length) selectResult(r[0].item);
    }
  });

  // build and ready
  await buildIndex();
  // default: show suggestions
  doSearch('');
})();
```

---

## 4) Notas de integración y performance

* **Manifest** debe listar todos los archivos que quieres indexar; usa `tools/generate-manifest.js` para generarlo automáticamente.
* **Carga inicial**: indexación descarga muchos archivos — si tu repo es grande puede tardar. Opciones:

  * indexar solo metadata y primeros N bytes; o
  * generar un *pre-index* (server-side) que incluya `title/snippet` para cada archivo y el loader solo fetch el pre-index (mucho más rápido). Puedes hacer esto con el `tools/` Node scripts.
* **Carga incremental**: el script que te di prioriza `.md` y busca texto; para repos muy grandes modifica `fetchAndInspect` para solo descargar first 20 KB.
* **Seguridad HTML**: para previsualizar HTML uso `iframe sandbox` para limitar permisos. No uses `allow-scripts` si no confías en el código. Actualmente el iframe se crea con `sandbox="allow-same-origin allow-forms allow-popups"` — puedes quitar `allow-same-origin` y `allow-popups` para más seguridad; si quitas `allow-same-origin` y quieres usar `srcdoc` sigue funcionando.

---

## 5) Cómo marcar manualmente cosas para indexar primero y mejorar resultados de "focus"

* En tus `*.md` añade metadatos YAML al inicio:

  ```md
  ---
  title: "Mi nota sobre marketplace"
  tags: [marketplace, inventory, ecommerce]
  category: docs
  priority: 10
  private: false
  ---
  ```

  El indexador puede ser adaptado para leer `priority` y ordenar resultados por prioridad además de relevancia. Puedo añadir eso si quieres.

---

## 6) ¿Qué sigue? Opciones que puedo entregar ahora (elige)

A. **Te adapto `tools/generate-manifest.js`** para que también genere un `data/preindex.json` con `path`, `ext`, `title`, `snippet`, `mtime` (esto acelera el loader; ideal para repos grandes).
B. **Te devuelvo un ZIP** con `index.html` + `scripts/search.js` + `tools/generate-manifest.js` + ejemplo `data/manifest.json`/`data/preindex.json`.
C. **Te integro esto en tu loader actual** (el que ya tiene manifest-based loader y gallery), y hago que el search se muestre como overlay/modal.
D. **Te añado soporte para OAuth / login** mínimo para que solo tú veas la UI de search en tu navegador (esto no encripta archivos, solo oculta la UI hasta logueo local).

Dime cuál opción quieres y lo pongo listo para que copies/pegues en tu repo.

---

Si quieres, empiezo ya con la **opción A + C** (preindex generator + integración en el loader) y te doy el ZIP — eso te dará **búsqueda rápida** y la UI integrada en la página que ya tienes. ¿Vamos con eso? 😄
