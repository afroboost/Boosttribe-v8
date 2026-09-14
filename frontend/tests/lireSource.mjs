/**
 * Lecture de sources pour les bancs structurels — et LE piège qu'ils ont failli avaler.
 *
 * La première version retirait les commentaires ligne par ligne : « la ligne commence
 * par // ou par * ». Elle supprimait donc aussi la ligne de FERMETURE d'un bloc JSDoc
 * (` */`), et le retrait des blocs `/* … *​/` qui suivait partait alors du `/**` initial
 * jusqu'au premier `*​/` SURVIVANT — c'est-à-dire des dizaines de lignes de VRAI CODE
 * effacées silencieusement. Des bancs passaient au vert sur du code qu'ils ne voyaient
 * plus, et rougissaient dès qu'un commentaire changeait de forme.
 *
 * Ordre correct, et c'est tout l'intérêt de ce module : blocs D'ABORD, lignes ENSUITE.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

/** Contenu brut d'un fichier de `src/`. */
export const lire = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

/** Le code EXÉCUTÉ, commentaires retirés : une explication n'est pas une preuve. */
export function codeSeul(txt) {
  return txt
    .replace(/\/\*[\s\S]*?\*\//g, '')            // blocs (JSDoc et {/* … */} JSX) d'abord…
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))   // …puis les commentaires de ligne.
    .join('\n');
}

/** Noms des fichiers d'un dossier de `src/` (ex. « hooks »). */
export const lister = (dossier) => fs.readdirSync(path.join(SRC, dossier));

export default { lire, codeSeul, lister };
