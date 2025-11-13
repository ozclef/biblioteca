# biblioteca


# Portal Library — Plantillas para tiendas estáticas

Carpeta con plantillas HTML/CSS/JS listas para usar o adaptar.
- `templates/single-page` — All-in-one (index.html) demo.
- `templates/multi-page` — Index / Productos / Product / Admin.
- `examples/demo-1` — Demo funcionando (data + imgs).

Cómo usar:
1. Clona el repo.
2. Copia la plantilla que quieras a tu proyecto.
3. (Opcional) `python -m http.server 5500` para probar localmente.
4. Para publicar: usar GitHub Pages o empaquetar como PWA.

Licencia: MIT


---

 # section id separacion de html y js



 Sí, todo lo que planteas es **muy bueno** y va en la dirección correcta de un *marketplace real*.
Tienes ya una base muy bien pensada — solo le falta modularidad y vistas dinámicas, pero el núcleo está perfecto.
Vamos a desmenuzarlo y ver cómo mejorarlo paso a paso sin romper nada.

---

### 1. **Dividir el proyecto (más orden y control)**

Sí: usar `div` por secciones es *bueno y necesario*.
Por ejemplo, podrías tener:

```html
<main class="main">
  <aside id="filtros">...</aside>
  <section id="productos"></section>
  <section id="detalle"></section>
  <section id="carrito"></section>
</main>
```

Así puedes **mostrar y ocultar** las partes según la acción del usuario, sin cambiar de página (SPA: *Single Page Application*).

Ejemplo básico:

```js
function showView(viewId) {
  ['productos', 'detalle', 'carrito'].forEach(id => {
    document.getElementById(id).style.display = id === viewId ? 'block' : 'none';
  });
}
```

Y cuando el usuario haga clic en “Ver producto”:

```js
function verProducto(id) {
  const p = PRODUCTS.find(x => x.id === id);
  const detalle = document.getElementById('detalle');
  detalle.innerHTML = `
    <div class="card">
      <img src="${p.imagen}" alt="${p.nombre}">
      <h3>${p.nombre}</h3>
      <p>${p.descripcion || 'Sin descripción'}</p>
      <div class="price">$${p.precio}</div>
      <button class="btn" onclick="addToCart(${p.id})">Agregar al carrito</button>
      <button class="muted" onclick="showView('productos')">Volver</button>
    </div>
  `;
  showView('detalle');
}
```

De esa forma, no abres otra página — simplemente cambias la vista.
Y el *div detalle* actúa como “ventanita modal” o “preview expandida”.

---

### 2. **URLs automáticas para cada producto (sin perder la página)**

Sí, es excelente idea.
Puedes usar **URLs dinámicas sin recargar** con el *History API* de JavaScript.
Por ejemplo:

```js
function verProducto(id){
  const p = PRODUCTS.find(x=>x.id==id);
  if (!p) return;
  history.pushState({id}, p.nombre, `?producto=${id}`);
  renderDetalle(p);
}

window.addEventListener('popstate', (e)=>{
  if (e.state && e.state.id){
    const p = PRODUCTS.find(x=>x.id==e.state.id);
    renderDetalle(p);
  } else {
    showView('productos');
  }
});
```

Así, cuando abras un producto, la URL será algo como:

```
tuweb.github.io/marketplace/?producto=3
```

Y si alguien copia y pega ese link, puede abrir directamente ese producto cuando cargue el sitio.

Esto te prepara para un futuro en el que tengas **páginas separadas (`producto.html`)** si algún día lo deseas, pero sin tener que duplicar todo el código ahora.

---

### 3. **Mini ventanas o “modales” (previews rápidas)**

Lo que describes — pequeñas ventanitas que se abren sin cerrar la página — son *modales*.
Son ideales para mostrar vista previa, botones o descripción sin recargar.

Ejemplo rápido con puro HTML + CSS + JS:

```html
<div id="modal" class="modal">
  <div class="modal-content" id="modalContent"></div>
</div>
```

```css
.modal{
  position:fixed;inset:0;background:rgba(0,0,0,0.5);
  display:none;justify-content:center;align-items:center;
  z-index:1000;
}
.modal-content{
  background:#0b1220;border-radius:12px;padding:20px;width:90%;max-width:400px;
}
```

```js
function abrirModal(html){
  const m = document.getElementById('modal');
  document.getElementById('modalContent').innerHTML = html;
  m.style.display = 'flex';
}

function cerrarModal(){ document.getElementById('modal').style.display='none'; }
```

Y para usarlo:

```js
function verProducto(id){
  const p = PRODUCTS.find(x=>x.id==id);
  abrirModal(`
    <img src="${p.imagen}" style="width:100%;border-radius:8px">
    <h3>${p.nombre}</h3>
    <p>${p.descripcion||'Sin descripción'}</p>
    <div class="price">$${p.precio}</div>
    <button class="btn" onclick="addToCart(${p.id})">Agregar</button>
    <button class="muted" onclick="cerrarModal()">Cerrar</button>
  `);
}
```

Eso te da el efecto que querías: **preview con botones y descripción sin salir del marketplace.**

---

### 4. **Conexión con inventarios / base de datos**

Exacto. Ya que tienes un JSON estructurado, lo que sigue es conectar ese JSON con una fuente de verdad (tu inventario real).
Ejemplo de campos en tu `data.json`:

```json
[
  {
    "id": 1,
    "nombre": "Playera blanca",
    "precio": 199,
    "stock": 10,
    "categoria": "ropa",
    "descripcion": "Playera 100% algodón con estampado Huachu.",
    "imagen": "imgs/1.webp"
  }
]
```

Y tu función de render puede mostrar el stock y deshabilitar el botón si ya no hay existencias:

```js
<button class="btn" ${p.stock<=0?'disabled':''}>${p.stock>0?'Agregar':'Agotado'}</button>
```

Si más adelante conectas con una API o un archivo editable (por ejemplo, `Google Sheets` conectado con `SheetDB` o `Airtable`), todo seguirá funcionando igual, solo cambiando la función `fetchProducts()`.

---

### 5. **@media y diseño responsivo**

Sí, `@media` te servirá para mostrar esas ventanitas o vistas previas en pantallas pequeñas de forma más cómoda.

Ejemplo:
para que los modales ocupen casi toda la pantalla en móvil:

```css
@media (max-width:600px){
  .modal-content{width:95%;height:90%;overflow:auto;}
}
```

---

Tu estructura ya tiene todo lo necesario para crecer como app profesional.
Si quieres, puedo prepararte la **versión mejorada** con:

* modal de vista previa funcional,
* navegación por URL (`?producto=`),
* vistas separadas (productos / carrito / detalle),
* y la base lista para conectar con JSON o base real.

¿Quieres que te la deje lista como plantilla modular (para copiar y pegar en tu carpeta)?
