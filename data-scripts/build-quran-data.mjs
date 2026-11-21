#!/usr/bin/env node
/**
 * Télécharge et prépare les données du Coran depuis Tanzil.net.
 *
 *  - Texte uthmani (Médine, Hafs) : affichage + comparaison
 *  - Texte "simple-clean"          : aide à la comparaison (orthographe imla'i)
 *  - Métadonnées (sourates, pages, juz', quarts de hizb, sajdas)
 *
 * Licence Tanzil : CC BY 3.0, le texte NE DOIT PAS être modifié.
 * Ce script stocke donc les versets tels quels (verbatim). La seule
 * transformation est structurelle : la basmala que Tanzil place en tête du
 * verset 1 de chaque sourate (sauf 1 et 9) est extraite dans un champ
 * séparé, car elle n'est pas comptée comme verset dans la numérotation Hafs.
 * La normalisation (diacritiques, etc.) est calculée à la volée dans l'app.
 *
 * Usage : node data-scripts/build-quran-data.mjs [--force] [--if-missing]
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '.cache');
const OUT = join(HERE, '..', 'frontend', 'public', 'data', 'quran.json');
const FORCE = process.argv.includes('--force');
const IF_MISSING = process.argv.includes('--if-missing');

const SOURCES = {
  uthmani:
    'https://tanzil.net/pub/download/index.php?marks=true&sajdah=true&rub=true&tatweel=true&quranType=uthmani&outType=txt-2&agree=true',
  simple:
    'https://tanzil.net/pub/download/index.php?quranType=simple-clean&outType=txt-2&agree=true',
  meta: 'https://tanzil.net/res/text/metadata/quran-data.js',
};

async function cached(name, url) {
  const file = join(CACHE, name);
  if (!FORCE) {
    try {
      await stat(file);
      return readFile(file, 'utf8');
    } catch {
      /* not cached */
    }
  }
  process.stdout.write(`Téléchargement ${name}… `);
  const res = await fetch(url, { headers: { 'User-Agent': 'quran-recitation-data-script' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, text, 'utf8');
  console.log(`${(text.length / 1024).toFixed(0)} Ko`);
  return text;
}

/** Parse "sura|aya|text" lines; returns {verses: Map<"s:a", text>, copyright} */
function parseTxt2(raw) {
  const verses = new Map();
  const copyright = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('#')) {
      copyright.push(line);
      continue;
    }
    if (!line.trim()) continue;
    const [s, a, ...rest] = line.split('|');
    verses.set(`${Number(s)}:${Number(a)}`, rest.join('|'));
  }
  return { verses, copyright: copyright.join('\n') };
}

/** Extract a `QuranData.X = [ ... ];` array literal from quran-data.js */
function metaArray(js, key) {
  const m = js.match(new RegExp(`QuranData\\.${key}\\s*=\\s*(\\[[\\s\\S]*?\\]);`));
  if (!m) throw new Error(`Métadonnée ${key} introuvable`);
  // Strip comments, convert to JSON (no eval: the file is downloaded data).
  // Strings are either "…" (may contain ') or '…' (never contain quotes).
  const body = m[1]
    .replace(/\/\/[^\n]*/g, '')
    .replace(/("[^"]*")|'([^'"]*)'/g, (_, dq, sq) => dq ?? JSON.stringify(sq))
    .replace(/,\s*\]/g, ']');
  return JSON.parse(body);
}

/** Lettres de base uniquement (pour vérifier la basmala, pas pour l'app). */
function skeleton(s) {
  return s.replace(/[^ء-غف-يٱ]/g, '');
}

function sajdaType(entry) {
  return entry[2] ?? 'recommended';
}

async function main() {
  if (IF_MISSING) {
    try {
      await stat(OUT);
      return; // déjà présent
    } catch {
      /* à générer */
    }
  }
  const [uthRaw, simpleRaw, metaJs] = await Promise.all([
    cached('uthmani.txt', SOURCES.uthmani),
    cached('simple-clean.txt', SOURCES.simple),
    cached('quran-data.js', SOURCES.meta),
  ]);

  const uth = parseTxt2(uthRaw);
  const simple = parseTxt2(simpleRaw);
  const suraMeta = metaArray(metaJs, 'Sura').slice(1, 115);
  const juz = metaArray(metaJs, 'Juz').slice(1, 31);
  const hizbQuarter = metaArray(metaJs, 'HizbQaurter').slice(1, 241);
  const page = metaArray(metaJs, 'Page').slice(1, 605);
  const sajda = metaArray(metaJs, 'Sajda').slice(1);

  if (uth.verses.size !== 6236 || simple.verses.size !== 6236) {
    throw new Error(`Nombre de versets inattendu : ${uth.verses.size} / ${simple.verses.size}`);
  }

  const BASMALA_UTH = uth.verses.get('1:1');
  const BASMALA_SIMPLE = simple.verses.get('1:1');

  const suras = [];
  const verses = []; // [uthmani, simple] indexés par index global
  for (let s = 1; s <= 114; s++) {
    const [start, ayas, order, rukus, name, tname, ename, type] = suraMeta[s - 1];
    if (start !== verses.length) throw new Error(`Index de début incohérent pour la sourate ${s}`);
    let basmala = null; // texte uthmani verbatim de la basmala de cette sourate
    for (let a = 1; a <= ayas; a++) {
      let u = uth.verses.get(`${s}:${a}`);
      let t = simple.verses.get(`${s}:${a}`);
      if (u === undefined || t === undefined) throw new Error(`Verset manquant ${s}:${a}`);
      if (a === 1 && s !== 1 && s !== 9) {
        // La basmala uthmani peut varier légèrement (ex. shadda sur le ب en 95 et 97) :
        // on compare le squelette consonantique des 4 premiers mots.
        const uw = u.split(' ');
        const tw = t.split(' ');
        if (
          skeleton(uw.slice(0, 4).join(' ')) !== skeleton(BASMALA_UTH) ||
          tw.slice(0, 4).join(' ') !== BASMALA_SIMPLE
        ) {
          throw new Error(`Basmala attendue en tête de ${s}:1`);
        }
        basmala = uw.slice(0, 4).join(' ');
        u = uw.slice(4).join(' ');
        t = tw.slice(4).join(' ');
      }
      verses.push([u, t]);
    }
    suras.push({ n: s, start, ayas, order, rukus, name, tname, ename, type, basmala });
  }

  const toIndex = ([s, a]) => suras[s - 1].start + a - 1;
  const data = {
    meta: {
      source: 'Tanzil Project — https://tanzil.net',
      textVersion: (uth.copyright.match(/Version\s+([\d.]+)/) || [])[1] ?? 'unknown',
      license: 'Creative Commons Attribution 3.0 (texte non modifié)',
      generatedAt: new Date().toISOString(),
      basmala: [BASMALA_UTH, BASMALA_SIMPLE],
      copyrightUthmani: uth.copyright,
      copyrightSimple: simple.copyright,
    },
    suras,
    verses,
    // Index global du premier verset de chaque division
    juz: juz.map(toIndex),
    hizbQuarter: hizbQuarter.map(toIndex),
    page: page.map(toIndex),
    sajda: sajda.map((e) => ({ index: toIndex(e), type: sajdaType(e) })),
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data), 'utf8');
  console.log(
    `OK → ${OUT}\n  ${verses.length} versets, ${suras.length} sourates, ${data.page.length} pages, ` +
      `${data.juz.length} juz', ${data.hizbQuarter.length} quarts de hizb`,
  );
}

main().catch((e) => {
  console.error('Échec :', e.message);
  process.exit(1);
});
