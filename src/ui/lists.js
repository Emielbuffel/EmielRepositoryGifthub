// Watchlists: several named lists, add a stock to any of them, rename, delete and reorder by dragging.
import { App, saveLists, saveWatch, useList, openStock } from '../app.js';
import { $, $$, html, raw, render, sheet, toast, ICON } from './dom.js';

const newId = () => 'w' + Date.now().toString(36);

/** Sheet to put `sym` in or out of each list. */
export function listMenu(sym) {
  const sh = sheet(`Lists for ${sym}`, html`<div class="results" id="lmList"></div>
    <form class="toolbar" id="lmNew"><input class="input" id="lmName" placeholder="New list name" style="flex:1"><button class="btn" type="submit">${raw(ICON.plus)}Create</button></form>`);
  const draw = () => {
    render($('#lmList', sh), html`${App.lists.map(l => html`<label class="row" style="padding:12px 14px;border-top:.5px solid var(--sep);cursor:pointer"><span><b>${l.name}</b> <span class="muted small">${l.syms.length} stocks</span></span><input type="checkbox" class="switch" data-l="${l.id}" ${l.syms.includes(sym) ? raw('checked') : ''}></label>`)}`);
    $$('[data-l]', sh).forEach(c => {
      c.onchange = () => {
        const l = App.lists.find(x => x.id === c.dataset.l);
        const syms = c.checked ? [...l.syms.filter(s => s !== sym), sym] : l.syms.filter(s => s !== sym);
        saveWatch(syms, l.id); toast(c.checked ? `Added ${sym} to ${l.name}.` : `Removed ${sym} from ${l.name}.`);
      };
    });
  };
  draw();
  $('#lmNew', sh).onsubmit = async e => {
    e.preventDefault(); const name = $('#lmName', sh).value.trim(); if (!name) return;
    await saveLists([...App.lists, { id: newId(), name, syms: [sym] }]); $('#lmName', sh).value = ''; draw();
    toast(`Created ${name} with ${sym}.`);
  };
}

/** Sheet to manage lists: switch, rename, delete, and drag stocks into order. */
export function manageLists() {
  let cur = App.listId;
  const sh = sheet('Watchlists', html`<div class="chips" id="mlTabs"></div><div id="mlBody"></div>`);
  const draw = () => {
    const l = App.lists.find(x => x.id === cur) || App.lists[0]; cur = l.id;
    render($('#mlTabs', sh), html`${App.lists.map(x => html`<button class="chip${x.id === cur ? ' on' : ''}" data-t="${x.id}">${x.name}</button>`)}<button class="chip" data-t="__new">${raw(ICON.plus)}New list</button>`);
    render($('#mlBody', sh), html`
      <div class="toolbar"><input class="input" id="mlName" value="${l.name}" aria-label="List name" style="flex:1"><button class="btn sm" id="mlUse">${App.listId === l.id ? 'Shown in sidebar' : 'Show this list'}</button>${App.lists.length > 1 ? html`<button class="btn sm danger" id="mlDel">Delete list</button>` : ''}</div>
      <div class="results" id="mlItems">${l.syms.length ? l.syms.map((s, i) => html`<div class="drag-row" draggable="true" data-i="${i}"><span class="grip" aria-hidden="true">${raw(ICON.grip)}</span><button class="link" data-open="${s}"><b>${s}</b> <span class="muted small">${App.names[s] || ''}</span></button>
        <span class="row" style="gap:4px"><button class="btn sm" data-up="${i}" aria-label="Move ${s} up" ${i === 0 ? raw('disabled') : ''}>↑</button><button class="btn sm" data-down="${i}" aria-label="Move ${s} down" ${i === l.syms.length - 1 ? raw('disabled') : ''}>↓</button><button class="btn sm danger" data-rm="${i}" aria-label="Remove ${s}">${raw(ICON.trash)}</button></span></div>`) : html`<div class="muted small" style="padding:12px 14px">Empty. Open a stock and tap the star to add it.</div>`}</div>
      <p class="muted tiny" style="margin:0">Drag the handle (or use the arrows) to change the order. The order is used in the sidebar, the chips above the chart and the screener.</p>`);
    $$('[data-t]', sh).forEach(b => { b.onclick = async () => { if (b.dataset.t === '__new') { const id = newId(); await saveLists([...App.lists, { id, name: 'List ' + (App.lists.length + 1), syms: [] }]); cur = id; } else cur = b.dataset.t; draw(); }; });
    $('#mlName', sh).onchange = () => { l.name = $('#mlName', sh).value.trim() || l.name; saveLists(App.lists); draw(); };
    $('#mlUse', sh).onclick = () => { useList(l.id); draw(); };
    $('#mlDel', sh) && ($('#mlDel', sh).onclick = () => { saveLists(App.lists.filter(x => x.id !== l.id)); cur = App.lists[0].id; draw(); });
    const move = (from, to) => { const a = l.syms.slice(); const [x] = a.splice(from, 1); a.splice(to, 0, x); saveWatch(a, l.id); draw(); };
    $$('[data-up]', sh).forEach(b => { b.onclick = () => move(+b.dataset.up, +b.dataset.up - 1); });
    $$('[data-down]', sh).forEach(b => { b.onclick = () => move(+b.dataset.down, +b.dataset.down + 1); });
    $$('[data-rm]', sh).forEach(b => { b.onclick = () => { saveWatch(l.syms.filter((_, i) => i !== +b.dataset.rm), l.id); draw(); }; });
    $$('[data-open]', sh).forEach(b => { b.onclick = () => { sh.close(); openStock(b.dataset.open); }; });
    // drag to reorder (mouse and touch via pointer events)
    let dragI = null;
    $$('.drag-row', sh).forEach(row => {
      row.ondragstart = e => { dragI = +row.dataset.i; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
      row.ondragend = () => row.classList.remove('dragging');
      row.ondragover = e => { e.preventDefault(); row.classList.add('over'); };
      row.ondragleave = () => row.classList.remove('over');
      row.ondrop = e => { e.preventDefault(); row.classList.remove('over'); if (dragI != null && dragI !== +row.dataset.i) move(dragI, +row.dataset.i); dragI = null; };
      const grip = row.querySelector('.grip');
      grip.onpointerdown = e => {
        if (e.pointerType === 'mouse') return; // mouse uses native drag and drop
        e.preventDefault(); const from = +row.dataset.i, rows = $$('.drag-row', sh); row.classList.add('dragging');
        const onMove = ev => { rows.forEach(r => { const b = r.getBoundingClientRect(); r.classList.toggle('over', ev.clientY > b.top && ev.clientY < b.bottom && r !== row); }); };
        const onUp = ev => {
          document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); row.classList.remove('dragging');
          const target = rows.find(r => { const b = r.getBoundingClientRect(); return ev.clientY > b.top && ev.clientY < b.bottom; });
          rows.forEach(r => r.classList.remove('over'));
          if (target && +target.dataset.i !== from) move(from, +target.dataset.i);
        };
        document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
      };
    });
  };
  draw();
}
