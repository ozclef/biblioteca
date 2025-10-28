/*
¡Me encanta la idea — hacer un *loader resiliente* que agarre *todo* lo que pongas (HTML, CSS, JS, JSON, SCSS, JSX, PY, etc.), intente enlazarlo y, si algo falla, siga con lo siguiente sin romper la página! 🚀

Te doy **una solución práctica y lista para usar**:

1. un `index.html` que actúa de “orquestador” (carga y monta lo que encuentre),
2. `scripts/loader.js` — la lógica de carga tolerante a fallos y de unión de piezas,
3. `tools/generate-manifest.js` — un script Node opcional que **genera automáticamente** un `manifest.json` con todos los archivos del repo (útil porque el navegador no puede listar directorios en GitHub Pages),
4. un ejemplo de `manifest.json` y las instrucciones para que todo funcione localmente y en GitHub Pages.

Principio de funcionamiento (resumido)

* Tú pones *todos* tus archivos en el repo (en cualquier carpeta).
* Ejecutas `tools/generate-manifest.js` en tu máquina (genera `data/manifest.json` que lista todos los archivos).
* `index.html` descarga `data/manifest.json` y, según el tipo (html, css, js, json, scss, jsx, py...), intenta **inyectar** o **procesar** cada archivo en orden de prioridad.
* Si la carga de un archivo falla o lanza error, el loader la ignora y sigue con el siguiente.
* Para HTML fragments: el loader intenta insertarlos en placeholders con `data-slot="nombre"`, o los apila en un `#autocontent` si no hay slot.
* Para CSS: los añade como `<link>` o `<style>` (si son .scss el manifest puede apuntar al .css transpilado o lo dejamos fuera hasta que lo proceses).
* Para JS: los carga con `type="module"` o como script normal; si un script falla (error en ejecución), lo atrapa y sigue.
* Para JSON: lo incorpora a un objeto global `window.__LIBRARY_JSONS__` para que cualquier script lo pueda usar.
* Para imágenes/URLs: si fallan, el loader coloca placeholders y registra los errores en consola + UI de fallos.
* Para archivos no ejecutables (py, jsx, scss): el loader los incluye en una lista de “extras” para descargar/mostrar su contenido (no se ejecutan en el navegador), para que puedas ver y copiar.

---

### 1) `tools/generate-manifest.js` (Node) — **ejecuta esto** para crear `data/manifest.json`

Colócalo en `tools/` y ejecútalo con `node tools/generate-manifest.js`. Genera un JSON con paths relativos.

```javascript
  */
// tools/generate-manifest.js
// Usage: node tools/generate-manifest.js
const fs = require('fs');
const path = require('path');

const root = process.cwd(); // run from repo root
const outDir = path.join(root, 'data');
const outFile = path.join(outDir, 'manifest.json');

// carpetas que quieres IGNORAR (node_modules, .git, etc.)
const IGNORE = ['node_modules', '.git', '.github', 'data'];

function walk(dir, base = '') {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (IGNORE.includes(file)) continue;
    const full = path.join(dir, file);
    const rel = path.join(base, file).replace(/\\/g, '/');
    const stat = fs.statSync(full);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(full, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

const files = walk(root).filter(f => !f.startsWith('data/manifest.json')); // evitar recursión
const manifest = files.map(p => {
  const ext = path.extname(p).slice(1).toLowerCase();
  return { path: p, ext };
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2));
console.log('Manifest generado en', outFile, 'con', manifest.length, 'archivos.');



/*```

---

### 2) `data/manifest.json` (ejemplo minimal — generado por el script)

```json
{
  "generatedAt": "2025-10-28T00:00:00.000Z",
  "files": [
    { "path": "index.html", "ext": "html" },
    { "path": "styles/style.css", "ext": "css" },
    { "path": "scripts/app.js", "ext": "js" },
    { "path": "data/productos.json", "ext": "json" },
    { "path": "imgs/3a631ed8-...jpg", "ext": "jpg" },
    { "path": "tools/generate-products.js", "ext": "js" },
    { "path": "notes/readme.md", "ext": "md" },
    { "path": "extras/script.py", "ext": "py" }
  ]
}
```

---

### 3) `index.html` (loader principal) — pega esto en la raíz

Este archivo es la *capa de orquestación*: carga `data/manifest.json`, intenta cargar cada recurso con tolerancia a fallos, inyecta y muestra una pequeña UI con resumen de errores.

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Biblioteca — Loader tolerante</title>
  <style>
    body{font-family:Inter, system-ui, Arial;margin:0;background:#f6f8fb;color:#0b1220}
    .wrap{max-width:1100px;margin:18px auto;padding:18px}
    header{display:flex;align-items:center;gap:12px}
    header h1{margin:0}
    .status{background:#fff;padding:12px;border-radius:10px;box-shadow:0 8px 18px rgba(2,6,23,0.06);margin-top:12px}
    .grid{display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px}
    .slot{background:#fff;padding:10px;border-radius:8px;min-height:40px}
    .fail-list{color:#b91c1c}
    pre{background:#0b1220;color:#e6eef8;padding:12px;border-radius:8px;overflow:auto}
    .small{font-size:13px;color:#596973}
  </style>
</head>
<body>
  <main class="wrap">
    <header>
      <h1>Biblioteca · Loader</h1>
      <div class="small">Cargador tolerante: tratará de inyectar TODO lo que pongas en el repo.</div>
    </header>

    <section class="status" id="status">
      <div><strong id="stat-msg">Cargando manifest...</strong></div>
      <div class="small">Manifest: <code>data/manifest.json</code></div>
      <div style="margin-top:8px">
        <button id="btn-reload">Recargar</button>
        <span id="summary" style="margin-left:12px"></span>
      </div>
      <div id="errors" class="fail-list" style="margin-top:8px"></div>
    </section>

    <section id="autocontent" class="grid" aria-live="polite">
      <!-- HTML fragments will be placed here or into data-slot placeholders -->
      <div class="slot" data-slot="header"></div>
      <div class="slot" data-slot="main"></div>
      <div class="slot" data-slot="footer"></div>
    </section>

    <section style="margin-top:12px">
      <h3>Assets detectados</h3>
      <div id="assets" class="small"></div>
    </section>

    <section style="margin-top:12px">
      <h3>Archivos tipo no ejecutable (visibles)</h3>
      <div id="extras"></div>
    </section>
  </main>

<script>
(async function(){
  const STATUS = document.getElementById('stat-msg');
  const ERR = document.getElementById('errors');
  const ASSETS = document.getElementById('assets');
  const EXTRAS = document.getElementById('extras');
  const AUTOCONTENT = document.getElementById('autocontent');
  const MANIFEST = 'data/manifest.json';
  const summary = document.getElementById('summary');
  const reloadBtn = document.getElementById('btn-reload');
  let manifest = null;
  let failures = [];

  reloadBtn.addEventListener('click', ()=> location.reload());

  function logFail(msg){
    failures.push(msg);
    ERR.innerHTML = failures.map(m=>'• '+m).join('<br>');
  }

  async function fetchJson(path){
    try{
      const r = await fetch(path);
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    }catch(e){
      throw new Error('fetchJson ' + path + ' -> ' + e.message);
    }
  }

  async function fetchText(path){
    try{
      const r = await fetch(path);
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    }catch(e){
      throw new Error('fetchText ' + path + ' -> ' + e.message);
    }
  }

  // util: insertar CSS de texto
  function insertStyle(cssText, origin){
    const s = document.createElement('style');
    s.dataset.origin = origin;
    s.textContent = cssText;
    document.head.appendChild(s);
  }

  // util: insertar link CSS
  function insertLinkCss(href){
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
    return l;
  }

  // util: insertar script (module or classic)
  function insertScript(src, opts = {module:false, text:null}){
    return new Promise((resolve) => {
      try{
        if(opts.text){
          const s = document.createElement('script');
          s.textContent = opts.text;
          document.body.appendChild(s);
          resolve();
        } else {
          const s = document.createElement('script');
          if(opts.module) s.type = 'module';
          s.src = src;
          s.crossOrigin = 'anonymous';
          s.onload = ()=> resolve();
          s.onerror = ()=> { resolve({error:true}); };
          document.body.appendChild(s);
        }
      }catch(e){
        resolve({error:true, message:e.message});
      }
    });
  }

  // util: mount html fragment into slot or auto
  function mountHtmlFragment(htmlText, filename){
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    // if fragment contains element with data-slot attribute, use it
    const slotElems = doc.querySelectorAll('[data-slot]');
    if(slotElems && slotElems.length){
      slotElems.forEach(se=>{
        const name = se.getAttribute('data-slot');
        const target = document.querySelector(`[data-slot="${name}"]`);
        if(target) target.innerHTML += se.innerHTML;
        else {
          // create new slot if missing
          const ns = document.createElement('div');
          ns.className = 'slot';
          ns.dataset.slot = name;
          ns.innerHTML = se.innerHTML;
          AUTOCONTENT.appendChild(ns);
        }
      });
      return;
    }
    // else, append whole body content into main slot
    const bodyHtml = doc.body.innerHTML.trim();
    const mainSlot = document.querySelector('[data-slot="main"]') || AUTOCONTENT;
    mainSlot.innerHTML += bodyHtml;
  }

  // map file ext to handler
  const HANDLERS = {
    html: async (f) => {
      try{
        const txt = await fetchText(f.path);
        mountHtmlFragment(txt, f.path);
        return { ok:true };
      }catch(e){
        logFail(e.message); return { ok:false, err:e.message };
      }
    },
    css: async (f) => {
      try{
        // prefer link tag (so caching works)
        insertLinkCss(f.path);
        return { ok:true };
      }catch(e){
        logFail('css:'+f.path+' -> '+e.message); return { ok:false, err:e.message };
      }
    },
    js: async (f) => {
      try{
        // try as module first if filename contains .m. else load classic
        const isModule = f.path.endsWith('.mjs') || f.path.includes('/module/');
        const res = await insertScript(f.path, {module:isModule});
        if(res && res.error){ logFail('js failed to load: '+f.path); return { ok:false }; }
        return { ok:true };
      }catch(e){
        logFail('js:'+f.path+' -> '+e.message); return { ok:false, err:e.message };
      }
    },
    json: async (f) => {
      try{
        const j = await fetchJson(f.path);
        // stash globally: window.__LIBRARY_JSONS__ = { 'path': obj }
        window.__LIBRARY_JSONS__ = window.__LIBRARY_JSONS__ || {};
        window.__LIBRARY_JSONS__[f.path] = j;
        return { ok:true };
      }catch(e){
        logFail('json:'+f.path+' -> '+e.message); return { ok:false, err:e.message };
      }
    },
    svg: async (f) => { return HANDLERS['img'] ? HANDLERS['img'](f) : {ok:false}; },
    png: async (f) => { return HANDLERS['img'] ? HANDLERS['img'](f) : {ok:false}; },
    jpg: async (f) => { return HANDLERS['img'] ? HANDLERS['img'](f) : {ok:false}; },
    jpeg: async (f) => { return HANDLERS['img'] ? HANDLERS['img'](f) : {ok:false}; },
    gif: async (f) => { return HANDLERS['img'] ? HANDLERS['img'](f) : {ok:false}; },
    img: async (f) => {
      try{
        // add img link to extras gallery
        const a = document.createElement('a');
        a.href = f.path; a.target = '_blank'; a.rel='noopener';
        const img = document.createElement('img');
        img.src = f.path;
        img.style.maxWidth = '160px'; img.style.height='90px'; img.style.objectFit='cover'; img.style.borderRadius='6px';
        a.appendChild(img);
        EXTRAS.appendChild(a);
        return { ok:true };
      }catch(e){
        logFail('img:'+f.path+' -> '+e.message); return { ok:false, err:e.message };
      }
    },
    scss: async (f) => {
      // can't compile scss client-side reliably without big libs.
      // Just fetch and show as code block
      try{
        const txt = await fetchText(f.path);
        const pre = document.createElement('pre');
        pre.textContent = txt;
        EXTRAS.appendChild(pre);
        return { ok:true };
      }catch(e){
        logFail('scss:'+f.path+' -> '+e.message); return { ok:false, err:e.message };
      }
    },
    jsx: async (f) => {
      // not executing: just show source so you can copy/paste or precompile
      try{
        const txt = await fetchText(f.path);
        const pre = document.createElement('pre');
        pre.textContent = txt;
        EXTRAS.appendChild(pre);
        return { ok:true };
      }catch(e){
        logFail('jsx:'+f.path+' -> '+e.message); return { ok:false, err:e.message };
      }
    },
    py: async (f) => {
      try{
        const txt = await fetchText(f.path);
        const pre = document.createElement('pre');
        pre.textContent = txt;
        EXTRAS.appendChild(pre);
        return { ok:true };
      }catch(e){
        logFail('py:'+f.path+' -> '+e.message); return { ok:false, err:e.message };
      }
    },
    other: async (f) => {
      try{
        const txt = await fetchText(f.path);
        const pre = document.createElement('pre');
        pre.textContent = txt;
        EXTRAS.appendChild(pre);
        return { ok:true };
      }catch(e){
        logFail('other:'+f.path+' -> '+e.message); return { ok:false, err:e.message };
      }
    }
  };

  // main: fetch manifest
  try{
    manifest = await fetchJson(MANIFEST);
  }catch(e){
    STATUS.textContent = 'No se pudo cargar manifest: ' + e.message;
    ERR.textContent = 'Asegúrate de generar data/manifest.json con tools/generate-manifest.js';
    return;
  }

  // display summary
  const totalFiles = manifest.files.length;
  ASSETS.innerHTML = `<div>Total archivos en manifest: ${totalFiles}</div>`;

  // process files in a priority order:
  // 1) html, 2) css, 3) json, 4) images, 5) js, 6) others
  const order = ['html','css','json','png','jpg','jpeg','svg','js','scss','jsx','py','other'];
  const filesByExt = {};
  for(const f of manifest.files){
    const e = (f.ext || '').toLowerCase() || 'other';
    filesByExt[e] = filesByExt[e] || [];
    filesByExt[e].push(f);
  }

  let processed = 0;
  for(const ext of order){
    const list = filesByExt[ext] || [];
    for(const f of list){
      // process with handler if exists, else other
      const handler = HANDLERS[ext] || HANDLERS['other'];
      try{
        const r = await handler(f);
        processed++;
        summary.textContent = `${processed}/${totalFiles} procesados`;
      }catch(e){
        logFail('Error procesando ' + f.path + ': ' + (e.message||e));
      }
    }
  }

  // process any remaining file types (not in order)
  for(const e in filesByExt){
    if(order.includes(e)) continue;
    for(const f of filesByExt[e]){
      try{
        const handler = HANDLERS[e] || HANDLERS['other'];
        await handler(f);
        processed++;
        summary.textContent = `${processed}/${totalFiles} procesados`;
      }catch(e){
        logFail('Error procesando ' + f.path + ': ' + (e.message||e));
      }
    }
  }

  STATUS.textContent = 'Carga terminada. Archivos: ' + totalFiles;
  if(failures.length) STATUS.textContent += ` — ${failures.length} fallos (ver arriba)`;
})();
</script>
</body>
</html>
```

---

## Cómo usar todo (paso a paso)

1. **Clona tu repo** localmente.
2. Copia `tools/generate-manifest.js` al `tools/` de tu repo.
3. Desde la raíz del repo ejecuta:

   ```bash
   node tools/generate-manifest.js
   ```

   — esto creará `data/manifest.json` con lista de TODOS los archivos (excepto ignorados).
4. Pon `index.html` (el loader) en la raíz del repo. También puedes tenerlo en `templates/` y hacer un demo.
5. Sirve localmente (recomendado):

   ```bash
   python -m http.server 5500
   # o
   npx serve .
   ```

   Abre `http://localhost:5500` — el loader leerá `data/manifest.json` y cargará/inyectará todo lo que encuentre.
6. **En GitHub Pages**: sube `data/manifest.json` al repo y publica. El loader funcionará ahí también (fetch de manifest OK).

---

## Buenas prácticas y recomendaciones

* **Generar manifest** siempre que agregues/elimines archivos. (Puedes automatizarlo con un script git hook o con CI que actualice `data/manifest.json` al hacer push).
* **Orden, convenciones y slots**: Si quieres que fragmentos HTML se inserten en lugares específicos, en esos fragmentos añade elementos con `data-slot="header"` o `data-slot="main"` etc. Ejemplo:

  ```html
  <div data-slot="header">
    <nav>...</nav>
  </div>
  ```

  El loader detecta eso y monta el contenido en el slot correspondiente.
* **JS que depende de elementos específicos**: si tienes scripts que buscan IDs específicos, pueden ejecutarse antes de que los fragmentos HTML estén montados. Para evitar problemas, idealmente:

  * pon `defer` en tus scripts (si son archivos estáticos) o
  * convierte scripts en módulos y que se ejecuten después (o guardan una función `init()` que se llama desde el loader).
* **SCSS/JSX/PY**: el loader no compila SCSS/JSX/PY en el navegador. Los muestra como “extras” (código fuente) para que los descargues o proceses. Si quieres que el loader compile SCSS/JSX client-side, puedo añadir una versión con `sass.js` o `esbuild-wasm` — ojo: eso incrementa mucho peso y complejidad.

---

## Qué más puedo darte ahora (elige)

* A) Te armo el repo *completo* (ZIP) con `index.html`, `tools/generate-manifest.js` y un ejemplo `data/manifest.json` prellenado usando los archivos que ya me subiste (si quieres que lo haga, dime si puedo leer/usar los uploads).
* B) Te doy un `git` workflow (GitHub Action) que ejecuta `generate-manifest.js` en CI y actualiza `data/manifest.json` automáticamente al push.
* C) Te adapto el loader para que **priorice** ciertas carpetas (por ejemplo `templates/important/*`) y ejecute módulos JS con `init()` después de montar HTML.
* D) Te añado una versión que *intente* ejecutar archivos `.mjs` primero y capture los errores para seguir en paz.

Dime cuál opción prefieres y te lo entrego ya listo para pegar en tu repo. Si quieres que lo haga minimal y ahora, te doy el ZIP con todo listo (A) — dime si lo quieres.
