const vscode = require('vscode');

// Busca bloques por indentación: funciones def (RE_DEF) o clases (RE_CLASE).
// Devuelve: nombre, línea de inicio y línea de fin de cada bloque.
function findBloques(documento, patron) {
  const lineas = documento.getText().split(/\r?\n/);
  const bloques = [];
  const ancho = (s) => s.replace(/\t/g, '    ').length;

  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(patron);
    if (!m) continue;
    let fin = i;
    for (let j = i + 1; j < lineas.length; j++) {
      if (lineas[j].trim() === '') continue;
      if (ancho(lineas[j].match(/^\s*/)[0]) > ancho(m[1])) fin = j;
      else break;
    }
    bloques.push({ nombre: m[2], inicio: i, fin });
  }
  return bloques;
}

const RE_DEF = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
const RE_CLASE = /^(\s*)class\s+([A-Za-z_]\w*)/;

// Lee el ajuste "abiertas" y devuelve la lista de nombres
function nombresAbiertas() {
  const texto = vscode.workspace.getConfiguration('recogeDef').get('abiertas', '__init__');
  return texto.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

// Abre del todo un bloque (él mismo y todo lo que tenga dentro)
function abrir(b) {
  return vscode.commands
    .executeCommand('editor.unfold', { selectionLines: [b.inicio], levels: 500 })
    .catch(() => {});
}

// Recoge un bloque. levels: 1 = solo su propia región: si ya está recogida
// no hace nada. Antes, sin "levels", VS Code "subía" y plegaba la clase.
function recoger(b) {
  return vscode.commands
    .executeCommand('editor.fold', { selectionLines: [b.inicio], levels: 1 })
    .catch(() => {});
}

// Recuerda, por archivo, qué hizo Ctrl+Alt+F la última vez ('recogido' o 'abierto')
const ultimoEstado = new Map();

function activate(context) {
  // Ctrl+Alt+F: alterna. Recoge todas las def (menos las del ajuste
  // "abiertas") y, si ya estaban recogidas, abre todas del todo.
  context.subscriptions.push(vscode.commands.registerCommand('recogeDef.recogerTodas', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const defs = findBloques(editor.document, RE_DEF);
    if (defs.length === 0) {
      vscode.window.showInformationMessage('No he encontrado ninguna función def en este archivo.');
      return;
    }

    const abiertas = nombresAbiertas();
    const clases = findBloques(editor.document, RE_CLASE);
    const clave = editor.document.uri.toString();

    if (ultimoEstado.get(clave) === 'recogido') {
      // Ya estaban recogidas: ahora se abren todas del todo
      for (const c of clases) await abrir(c);
      for (const d of defs) await abrir(d);
      ultimoEstado.set(clave, 'abierto');
      return;
    }

    // Partir de un estado limpio: abrir del todo clases y funciones
    for (const c of clases) await abrir(c);
    for (const d of defs) await abrir(d);

    // Recoger todas las funciones menos las del ajuste "abiertas"
    for (const d of defs) {
      if (abiertas.includes(d.nombre)) continue;
      await recoger(d);
    }
    ultimoEstado.set(clave, 'recogido');
  }));

  // Ctrl+8: sobre un def, lo recoge; si ya está recogido, lo abre entero
  context.subscriptions.push(vscode.commands.registerCommand('recogeDef.alternar', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const cursor = editor.selection.active.line;
    const dentro = findBloques(editor.document, RE_DEF)
      .filter(d => d.fin > d.inicio && d.inicio <= cursor && cursor <= d.fin);

    if (dentro.length === 0) {
      vscode.window.showInformationMessage('No estás dentro de ninguna función def.');
      return;
    }

    // la función más pequeña que contiene al cursor (por si hay defs anidadas)
    const d = dentro.reduce((a, b) => (b.fin - b.inicio) < (a.fin - a.inicio) ? b : a);

    // Si el cursor está dentro del cuerpo, VS Code mantiene la función
    // abierta por fuerza: se recoge. Si está en la línea def, miramos
    // si el cuerpo se ve para saber si estaba recogida.
    const enElCuerpo = cursor > d.inicio;
    const cuerpoVisible = editor.visibleRanges.some(
      r => r.end.line >= d.inicio + 1 && r.start.line <= d.fin
    );
    const recogida = !enElCuerpo && !cuerpoVisible;

    if (recogida) {
      await abrir(d);
    } else {
      await recoger(d);
    }
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };