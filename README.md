# Tilawa — récitation du Coran avec correction en temps réel

Application web progressive (PWA), installable sur iPhone, Android et ordinateur. Vous récitez à voix haute ; l'app transcrit votre voix, la compare mot à mot au texte attendu et vous arrête (ou vous corrige à la fin) en cas de mot erroné, oublié ou ajouté, ou de verset sauté.

> ⚠️ Outil d'entraînement : il vérifie **les mots et l'enchaînement**, pas la prononciation fine ni le tajwid. Il ne remplace pas un enseignant qualifié.

## 📱 Utilisation sur iPhone (sans PC ni serveur)

**Adresse de l'app : <https://xenightyt-wq.github.io/tilawa/>**

1. Ouvrez l'adresse dans **Safari**, puis **Partager** → **Sur l'écran d'accueil**.
2. Lancez Tilawa depuis l'écran d'accueil, puis allez dans **Paramètres** → **Télécharger le modèle maintenant**. C'est un téléchargement unique d'environ 95 Mo ; faites-le en Wi-Fi.
3. Récitez. La reconnaissance vocale tourne **dans le téléphone** (Whisper Tarteel au format ONNX, exécuté par WebGPU et WebAssembly). Rien n'est envoyé sur Internet, et tout fonctionne hors ligne une fois le modèle téléchargé.

En bas de l'écran de récitation, un indicateur affiche le mode de calcul et le temps de traitement (par exemple `webgpu+wasm · 850 ms`). Sous 1 s, la correction reste fluide.

**Mises à jour** : chaque `git push` sur `main` reconstruit et republie l'app (workflow `.github/workflows/pages.yml`). Le téléphone récupère la nouvelle version à la réouverture suivante.

Le mode **serveur** (FastAPI + GPU, décrit plus bas) reste disponible dans les Paramètres. Il est plus rapide et plus robuste au bruit, mais il faut que le PC tourne.

## Sommaire

- [Utilisation sur iPhone](#-utilisation-sur-iphone-sans-pc-ni-serveur)
- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Installation et lancement (développement)](#installation-et-lancement-développement)
- [Utiliser l'app sur un téléphone (HTTPS)](#utiliser-lapp-sur-un-téléphone-https)
- [Installer la PWA sur iPhone et Android](#installer-la-pwa-sur-iphone-et-android)
- [Déploiement (Docker, VPS, Fly.io, Railway)](#déploiement)
- [Données du Coran et licences](#données-du-coran-et-licences)
- [Choix du modèle de reconnaissance](#choix-du-modèle-de-reconnaissance)
- [Confidentialité : ce qui est envoyé où](#confidentialité--ce-qui-est-envoyé-où)
- [Tests](#tests)
- [Limites connues et améliorations futures](LIMITES.md)

## Fonctionnalités

| | |
|---|---|
| **Choix de la portion** | sourate (verset de début et de fin), page du mushaf (1–604), juz' (1–30), hizb (1–60) |
| **Récitation corrigée** | mots en vert au fil de la récitation ; à la faute : mot en rouge, son et vibration (réglables), mot attendu affiché ; reprise au mot ou au verset (ou en touchant un mot) |
| **Deux comportements** | « arrêt immédiat à la faute » ou « correction à la fin du passage » (bascule aussi dans l'en-tête de l'écran de récitation) |
| **Fautes détectées** | mot erroné, mot oublié, mot en trop, verset sauté ; une répétition volontaire n'est pas comptée ; isti'adha et basmala acceptées sans être exigées |
| **Mémorisation** | texte masqué (tout, premier mot de chaque verset, début de verset, un mot sur deux), bouton « Indice » |
| **Interrogation** | verset au hasard dans une zone : réciter le suivant, le précédent ou compléter le verset |
| **Suivi** | historique, précision par séance, versets les plus ratés, progression par sourate (non vue / en cours / acquise) |
| **Révision espacée** | SM-2 simplifié par verset, file « Révision du jour » |
| **Écoute** | récitateurs EveryAyah (Husary, Minshawi, Alafasy, Abdul Basit, Sudais…), lecture en boucle, cache hors ligne |
| **Paramètres** | taille du texte, thème clair/sombre/auto, tajwid coloré simplifié, sensibilité stricte/souple, langue (français, arabe, anglais) |
| **Données** | tout reste sur l'appareil (IndexedDB), export/import JSON, aucun compte |

Démo : sur l'écran d'accueil, les boutons **Al-Fatiha** et **Al-Ikhlas** ouvrent directement la récitation corrigée. Sans micro ni serveur, choisissez **Paramètres → Reconnaissance vocale → Simulation**. Vous pourrez alors taper ce que vous « récitez » (le bouton « Verset attendu » préremplit le verset courant).

## Architecture

```
quran-recitation/
├── data-scripts/          build-quran-data.mjs (Tanzil → JSON), make-icons.mjs
├── frontend/              React + TypeScript + Vite + vite-plugin-pwa
│   ├── public/            pcm-worklet.js (capture micro 16 kHz), data/quran.json (généré), icons/
│   ├── src/core/          ⚙️ logique pure, testée : arabic.ts, align.ts, tracker.ts, quran.ts, srs.ts
│   ├── src/engine/        moteurs de reconnaissance interchangeables (serveur WebSocket, simulation)
│   ├── src/lib/           IndexedDB, réglages, i18n, audio, tajwid, hook useRecitation
│   ├── src/screens/       Accueil, Sélection, Récitation, Interrogation, Révision, Stats, Paramètres, À propos
│   ├── tests/             Vitest (normalisation, alignement, suivi, SM-2, rejeu de flux réels)
│   └── e2e/               Playwright (parcours complets sur le build PWA)
├── backend/               FastAPI + faster-whisper (CTranslate2)
│   ├── app/               main.py (WebSocket), streaming.py (VAD + découpage), engines.py, vad.py
│   ├── scripts/           convert_model.py, benchmark.py, stream_file.py
│   └── tests/             pytest
├── Dockerfile, docker-compose.yml
└── LIMITES.md
```

**Le backend ne fait que transcrire.** Toute la correction (normalisation, alignement, confirmation des fautes) tourne dans le navigateur, derrière l'interface `RecognitionEngine` (`frontend/src/engine/types.ts`). Pour passer à un modèle embarqué (transformers.js / WebGPU), il suffit d'ajouter un moteur qui émet les mêmes événements `{segment, text, final}` ; la logique de correction ne change pas.

### Flux d'une récitation

1. `getUserMedia` → **AudioWorklet** qui rééchantillonne en PCM 16 kHz / 16 bits, par blocs de 100 ms.
2. **WebSocket** `/ws/asr` → le serveur détecte la parole (VAD par énergie, plancher de bruit adaptatif) et décode la fenêtre courante **toutes les ~500 ms** (partiel). Après **~650 ms de silence**, il produit un **final** et ouvre un nouveau segment. Les segments sont plafonnés à 20 s.
3. Le client **normalise** la transcription (diacritiques, alef/hamza/ya/ta marbuta, petites lettres uthmani, marques de pause) et l'**aligne** sur le texte attendu. L'alignement est semi-global, par programmation dynamique, avec une similarité de Levenshtein par mot. Il accepte la fusion et la coupure de mots (`يا أيها` ↔ `يَـٰٓأَيُّهَا`) et une reprise en arrière sans pénalité. Le départ peut se faire jusqu'au début du verset précédent.
4. **Anti faux positifs** : le dernier mot d'un partiel est ignoré (souvent incomplet). Une faute n'est confirmée que si elle apparaît dans **deux transcriptions successives**, ou dans un final de confiance suffisante.
5. Mode « stop » : le client demande au serveur d'abandonner le segment en cours (`reset`) et attend la reprise.

Latence mesurée (RTX 3060 Laptop, `whisper-small-ar-quran`) : **100 à 190 ms par décodage**. Un mot devient vert environ 0,5 à 1 s après avoir été prononcé, et une faute est signalée en 1 à 1,5 s.

## Installation et lancement (développement)

Prérequis : **Node.js ≥ 20**, **[uv](https://docs.astral.sh/uv/)** (gère Python 3.12) et, pour le GPU, un pilote NVIDIA récent (CUDA 12).

### 1. Données du Coran

```powershell
node data-scripts/build-quran-data.mjs
```

Le script télécharge le texte Tanzil (uthmani + simple-clean) et les métadonnées, puis vérifie les 6236 versets et écrit `frontend/public/data/quran.json`. Il est lancé automatiquement par `npm run dev`, `npm run build` et `npm test` si le fichier manque.

### 2. Backend (reconnaissance vocale)

```powershell
cd backend
uv sync --extra cuda --group convert
```

Sans GPU NVIDIA, utilisez `uv sync --group convert` : l'app tourne alors sur CPU, plus lentement.

```powershell
uv run python scripts/convert_model.py deepdml/whisper-small-ar-quran-mix-norm tarteel-ai/whisper-base-ar-quran
```

```powershell
uv run --extra cuda uvicorn app.main:app --host 0.0.0.0 --port 8000
```

> Gardez `--extra cuda` (sans GPU : retirez-le) : un `uv run` sans cette option resynchronise l'environnement et **désinstalle** les bibliothèques CUDA. Le premier lancement télécharge environ 1 Go.

Variables utiles :

| Variable | Défaut | Rôle |
|---|---|---|
| `ASR_MODEL` | `models/whisper-small-ar-quran-mix-norm-ct2` | dossier du modèle CTranslate2 |
| `ASR_DEVICE` | `auto` | `cuda` / `cpu` |
| `ASR_COMPUTE_TYPE` | `auto` | `float16` (GPU) / `int8` (CPU) |
| `ASR_PARTIAL_MS` | `500` | intervalle entre partiels |
| `ASR_END_SILENCE_MS` | `650` | silence qui clôt un segment |
| `ASR_ENGINE` | `faster-whisper` | `fake` pour tester sans modèle |
| `LOG_TRANSCRIPTS` | `0` | `1` pour journaliser les transcriptions (débogage) |

Sur CPU, préférez `ASR_MODEL=models/whisper-base-ar-quran-ct2` (≈ 3× plus rapide).

### 3. Frontend

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

> Sous Windows PowerShell, `npm` peut être bloqué (« Impossible de charger le fichier npm.ps1… l'exécution de scripts est désactivée »). Utilisez `npm.cmd` comme ci-dessus : même effet, sans modifier la politique d'exécution.

Ouvrez <http://localhost:5173>. Vite relaie `/ws` et `/api` vers le backend sur le port 8000 (modifiable avec `BACKEND_URL`).

Pour servir l'app **et** la reconnaissance depuis une seule origine (comme en production), lancez `npm run build`. Le backend sert alors automatiquement `frontend/dist` sur <http://localhost:8000>.

## Utiliser l'app sur un téléphone (HTTPS)

Les navigateurs n'autorisent le micro qu'en **HTTPS** (ou sur `localhost`). Pour utiliser votre PC (avec son GPU) depuis votre téléphone :

- **Tailscale (recommandé, privé)** : installez Tailscale sur le PC et le téléphone, puis lancez `tailscale serve --bg 8000` sur le PC. L'app est disponible sur `https://<nom-du-pc>.<tailnet>.ts.net`, visible seulement de vos appareils.
- **Cloudflare Tunnel (rapide)** : `cloudflared tunnel --url http://localhost:8000` donne une URL `https://….trycloudflare.com`. Attention : elle est publique tant que le tunnel est ouvert.
- **Serveur avec nom de domaine** : Caddy en reverse proxy (`reverse_proxy localhost:8000`) obtient un certificat automatiquement. Les WebSockets passent sans configuration.

Dans tous les cas, faites d'abord `npm run build` puis lancez le backend : tout est servi sur le port 8000.

## Installer la PWA sur iPhone et Android

**iPhone / iPad (Safari)** : ouvrez l'URL HTTPS dans **Safari**, touchez **Partager** puis **Sur l'écran d'accueil**, puis **Ajouter**. Au premier appui sur le micro, autorisez l'accès. En cas de refus : Réglages → Safari → Microphone (ou Réglages → Confidentialité → Micro).

**Android (Chrome)** : ouvrez l'URL HTTPS, puis menu ⋮ → **Installer l'application** (ou la bannière « Ajouter à l'écran d'accueil »). Autorisez le micro au premier usage.

**Ordinateur (Chrome / Edge)** : icône d'installation dans la barre d'adresse.

Le texte, les réglages et la progression fonctionnent **hors ligne**. L'audio des récitateurs déjà écouté est mis en cache. La correction vocale, elle, a besoin du serveur.

## Déploiement

### Docker (maison ou VPS)

```powershell
docker compose up -d --build
```

Par défaut, l'image est construite pour le CPU avec `tarteel-ai/whisper-base-ar-quran`. Pour un serveur GPU, décommentez dans `docker-compose.yml` les arguments `CUDA: "1"` et `MODEL_ID: deepdml/whisper-small-ar-quran-mix-norm`, ainsi que la section `deploy`. Le NVIDIA Container Toolkit doit être installé sur la machine.

Le Dockerfile compile la PWA, convertit le modèle dans une étape jetable (torch n'est pas dans l'image finale), puis produit une image unique qui sert l'app et le WebSocket sur le port 8000.

> Le Dockerfile n'a pas pu être testé sur la machine de développement (Docker n'y est pas installé). Les commandes qu'il exécute (`npm run build`, `convert_model.py`, `uv sync`, `uvicorn`) ont, elles, été testées individuellement.

### Fly.io / Railway

Les deux plateformes construisent directement le `Dockerfile` :

- **Fly.io** : `fly launch` (port interne 8000), puis `fly deploy`. Prévoyez au moins 2 Go de RAM pour le modèle base sur CPU. HTTPS est fourni.
- **Railway** : « Deploy from repo », variable `PORT` inutile (le port est fixé à 8000 : déclarez-le dans les réglages réseau).

Sur CPU, la latence par décodage est de l'ordre de 0,3 à 1 s selon la machine : c'est utilisable, mais moins réactif qu'avec un GPU.

## Données du Coran et licences

- **Le texte n'est jamais généré par un modèle de langage.** Il provient de **Tanzil.net** (texte uthmani pour l'affichage, simple-clean pour la comparaison), version 1.1. Licence **CC BY 3.0** : le texte est intégré **tel quel**. La seule opération est structurelle : la basmala que Tanzil place en tête du verset 1 est rangée dans un champ séparé. La notice de copyright est conservée dans `quran.json` et affichée dans « À propos ».
- **Métadonnées** (pages du mushaf de Médine, juz', quarts de hizb, sajdas) : Tanzil Quran Metadata, CC BY 3.0.
- **Audio** : EveryAyah.com (un MP3 par verset), téléchargé à la demande depuis le navigateur.
- **Police** : Amiri Quran (SIL OFL 1.1), embarquée.
- **Modèles** : `deepdml/whisper-small-ar-quran-mix-norm` et `tarteel-ai/whisper-base-ar-quran`, tous deux Apache-2.0, dérivés d'OpenAI Whisper (MIT).

## Choix du modèle de reconnaissance

Trois modèles ont été comparés avec `backend/scripts/benchmark.py` sur une RTX 3060 Laptop (float16). Le test porte sur 3 récitateurs × 16 versets, et le résultat est dans `backend/bench-results.json`.

| Modèle | Taille | WER propre | WER bruité¹ | Latence (3 s d'audio) | Fins de verset inventées² | Verset sauté réinséré³ |
|---|---|---|---|---|---|---|
| tarteel-ai/whisper-tiny-ar-quran | 77 Mo | 6,3 % | 36,6 % | 49 ms | 0/36 | 0/9 |
| tarteel-ai/whisper-base-ar-quran | 144 Mo | 4,2 % | 9,4 % | 72 ms | 0/36 | 0/9 |
| **deepdml/whisper-small-ar-quran-mix-norm** | 466 Mo | **2,1 %** | **4,0 %** | 104 ms | 1/36 | 0/9 |

¹ Rapport signal/bruit d'environ 10 dB et tempo +8 %, pour approcher un micro de téléphone dans une pièce.

² Le verset est coupé à 55 % : le modèle ne doit pas « compléter » la fin, sinon il masquerait un oubli.

³ On enchaîne les versets *n* et *n+2* : le verset *n+1* ne doit pas apparaître.

**Choix** : `whisper-small-ar-quran-mix-norm` par défaut sur GPU, car il est nettement plus robuste au bruit pour une latence qui reste faible. `tarteel-ai/whisper-base-ar-quran` est le choix par défaut sur CPU et dans l'image Docker.

**Réserve importante** : ces modèles ont été entraînés sur des récitations d'EveryAyah, la même source que le test. Le WER est donc optimiste, et il faudra valider sur des voix d'amateurs (voir LIMITES.md).

## Confidentialité : ce qui est envoyé où

| Donnée | Où | Conservation |
|---|---|---|
| Audio du micro | **uniquement** au serveur de reconnaissance configuré (le vôtre), par WebSocket, pendant l'écoute | en mémoire, le temps d'un segment (≤ 20 s), puis libéré ; jamais écrit sur disque ni journalisé |
| Transcriptions | renvoyées au navigateur | non journalisées côté serveur (sauf `LOG_TRANSCRIPTS=1`) |
| Historique, progression, réglages | IndexedDB du navigateur | sur l'appareil ; export/import JSON |
| Audio des récitateurs | téléchargé depuis everyayah.com | cache local du navigateur |

Pas de compte, pas de traceur, pas de publicité.

## Tests

```powershell
cd frontend
npm test
```

46 tests Vitest : normalisation, alignement, suivi, SM-2, et rejeu de flux réels enregistrés depuis le serveur.

```powershell
npx playwright install chromium
```

```powershell
npm run e2e
```

5 parcours Playwright (mobile) sur le build PWA : Al-Fatiha sans faute, Al-Ikhlas avec faute et reprise, verset sauté, mémorisation avec indice, hors ligne.

```powershell
cd backend
uv run pytest
```

8 tests : VAD et découpage, WebSocket avec un moteur factice.

```powershell
uv run python scripts/benchmark.py models/whisper-base-ar-quran-ct2 models/whisper-small-ar-quran-mix-norm-ct2
```

Pour diffuser un fichier audio en temps réel dans le serveur et observer partiels et finals :

```powershell
uv run python scripts/stream_file.py chemin/vers/recitation.mp3
```
