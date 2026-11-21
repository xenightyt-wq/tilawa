# Limites connues et améliorations futures

## Limites actuelles

### Reconnaissance et correction

- **Mots, pas prononciation.** L'app compare des *mots* transcrits. Elle ne juge ni les makharij, ni les madd, ni la ghunna, l'idgham, la qalqala ou les waqf. Une prononciation fautive transcrite par le bon mot passe inaperçue.
- **Biais des modèles.** Les modèles Whisper affinés « Coran » ont surtout appris sur des récitateurs professionnels (EveryAyah). Leur fiabilité sur des voix d'enfants, de débutants, avec un accent marqué ou dans un environnement bruyant reste à mesurer sur de vraies récitations d'utilisateurs.
- **Le modèle peut « corriger » vers le texte probable.** Un modèle très entraîné sur le Coran peut transcrire le mot juste alors que le récitant s'est trompé de peu (une voyelle, ي/ت). Le banc d'essai montre peu de complétions inventées (1/36 pour le modèle small), mais le risque existe : c'est la principale limite de la correction par transcription.
- **Fautes de voyelles (harakat) non détectées.** La comparaison se fait sans diacritiques, car la transcription des voyelles est trop instable pour arrêter l'utilisateur à coup sûr. Une erreur comme رَبُّ/رَبِّ n'est donc pas signalée.
- **Confusions de lettres proches.** En mode strict, une seule lettre différente sur un mot de 7 lettres au plus est signalée. Sur un mot long, elle peut être tolérée. Le mode souple tolère davantage.
- **Formes acceptées.** Pour chaque mot, l'app accepte l'orthographe uthmani et l'orthographe imla'i (Tanzil simple). Certaines graphies très particulières peuvent encore produire un faux positif, d'où la confirmation sur deux transcriptions.
- **VAD par énergie.** Elle suffit pour une récitation dans une pièce calme. Dans le bruit (ventilateur, conversations), les segments peuvent se couper au mauvais endroit, ce qui allonge la latence.
- **Une seule qirâ'a** : Hafs 'an 'Asim (texte de Médine). Une lecture Warsh ou Qalun sera signalée comme fautive.
- **Latence** : sur GPU, 0,5 à 1,5 s entre la fin d'un mot et sa validation ou son signalement. Sur CPU, compter davantage.

### Application

- **iOS** : Safari peut suspendre le micro quand l'écran se verrouille ou que l'app passe en arrière-plan. La PWA installée demande parfois de réautoriser le micro.
- **Correction vocale hors ligne impossible** : le texte, les statistiques et l'audio déjà écouté marchent hors ligne, mais la reconnaissance a besoin du serveur.
- **Tajwid coloré simplifié** : il se déduit seulement des signes du texte (ghunna, madd, qalqala, lettres muettes). Ce n'est pas un mushaf tajwid complet : ikhfa', idgham, iqlab et tafkhim ne sont pas colorés.
- **Le serveur n'a pas d'authentification.** Exposez-le via Tailscale ou derrière un reverse proxy authentifié si l'URL est publique.
- **Un seul worker** : les décodages de plusieurs utilisateurs simultanés sont mis en file sur le même GPU.
- **Dockerfile non testé** sur la machine de développement (Docker absent). Ses étapes ont été testées séparément.
- **Traductions de l'interface** : le français est complet, l'anglais l'est presque. L'arabe couvre les écrans principaux ; le reste s'affiche en français.

## Améliorations futures

1. **Analyse du tajwid** : ajouter un second moteur derrière la même interface, alignant phonèmes et durées (alignement forcé CTC, modèles wav2vec2 ou phonétiques, ou des projets comme `HisnLabs/tajweed-v2`) pour détecter madd trop court, ghunna absente ou qalqala manquante. Le suivi par mot fournit déjà les positions à analyser.
2. **Contrôle des voyelles** : comparer les harakat quand le modèle les produit avec une confiance élevée (probabilités par mot de faster-whisper, `word_timestamps=True`).
3. **Modèle embarqué hors ligne** : Whisper tiny/base en ONNX via transformers.js (WebGPU, sinon WASM), dans un `RecognitionEngine` « navigateur ». Des conversions ONNX de `tarteel-ai/whisper-tiny-ar-quran` existent déjà. Tout fonctionnerait alors sans serveur, au prix de la précision sur les téléphones modestes.
4. **Plusieurs qirâ'ât** : textes Warsh et Qalun (par exemple ceux du King Fahd Complex), avec choix de la lecture dans les réglages.
5. **Silero VAD** (ONNX) à la place de la VAD par énergie, plus robuste au bruit.
6. **Affinage sur des voix d'amateurs**, avec consentement explicite (aucune donnée n'est collectée aujourd'hui), pour réduire les faux positifs.
7. **Mushaf page par page** (mise en page de Médine, police KFGQPC par page) et tajwid complet à partir de données sous licence compatible.
8. **Traductions et tafsir** (hors MVP), audio mot à mot, objectifs quotidiens, synchronisation chiffrée optionnelle entre appareils.
