import { describe, expect, it } from 'vitest';
import { normalizeWord as N } from '../src/core/arabic';
import { feed, makeTracker, states, suraPassage } from './helpers';

// Transcriptions "réalistes" : écriture imla'i voyellée, comme la sortie
// des modèles Whisper affinés sur le Coran.
const FATIHA = [
  'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ',
  'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
  'الرَّحْمَنِ الرَّحِيمِ',
  'مَالِكِ يَوْمِ الدِّينِ',
  'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ',
  'اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ',
  'صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ',
];
const IKHLAS = ['قُلْ هُوَ اللَّهُ أَحَدٌ', 'اللَّهُ الصَّمَدُ', 'لَمْ يَلِدْ وَلَمْ يُولَدْ', 'وَلَمْ يَكُنْ لَهُ كُفُوًا أَحَدٌ'];

describe('passage', () => {
  it('Al-Fatiha : 29 mots + isti\'adha optionnelle', () => {
    const p = suraPassage(1);
    expect(p.words.filter((w) => !w.optional)).toHaveLength(29);
    expect(p.words.filter((w) => w.optional === 'istiadha')).toHaveLength(5);
    expect(p.words.some((w) => w.optional === 'basmala')).toBe(false);
  });
  it('Al-Ikhlas : basmala optionnelle, 15 mots', () => {
    const p = suraPassage(112);
    expect(p.words.filter((w) => w.optional === 'basmala')).toHaveLength(4);
    expect(p.words.filter((w) => !w.optional)).toHaveLength(15);
  });
  it('les vocatifs يا sont associés à la forme simple en 2 mots', () => {
    const p = suraPassage(2, 21, 21);
    const w = p.words.find((x) => N(x.display) === 'يايها')!;
    expect(w.forms).toContain('ياايها');
  });
});

describe('récitation correcte', () => {
  it('Al-Fatiha complète, en un seul segment par verset', () => {
    const t = makeTracker(1);
    const ups = feed(t, FATIHA);
    expect(ups.flatMap((u) => u.newErrors)).toEqual([]);
    expect(t.finished).toBe(true);
    expect(states(t).every((s) => s === 'correct')).toBe(true);
  });
  it('Al-Ikhlas avec isti\'adha et basmala', () => {
    const t = makeTracker(112);
    feed(t, [
      'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ',
      'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ',
      ...IKHLAS,
    ]);
    expect(t.errors).toEqual([]);
    expect(t.finished).toBe(true);
  });
  it('Al-Ikhlas sans basmala, tout d\'un trait', () => {
    const t = makeTracker(112);
    feed(t, [IKHLAS.join(' ')]);
    expect(t.errors).toEqual([]);
    expect(t.finished).toBe(true);
  });
  it('tolère des variations de transcription sans voyelles', () => {
    const t = makeTracker(112, { strictness: 'strict' });
    feed(t, ['قل هو الله احد الله الصمد لم يلد ولم يولد ولم يكن له كفوا احد']);
    expect(t.errors).toEqual([]);
    expect(t.finished).toBe(true);
  });
  it('accepte "يا أيها" en deux mots', () => {
    const t = makeTracker(2, {}, 21, 21);
    feed(t, ['يَا أَيُّهَا النَّاسُ اعْبُدُوا رَبَّكُمُ الَّذِي خَلَقَكُمْ وَالَّذِينَ مِنْ قَبْلِكُمْ لَعَلَّكُمْ تَتَّقُونَ']);
    expect(t.errors).toEqual([]);
    expect(t.finished).toBe(true);
  });
  it('une répétition volontaire n\'est pas une faute', () => {
    const t = makeTracker(1);
    feed(t, [
      FATIHA[0],
      'الْحَمْدُ لِلَّهِ رَبِّ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
    ]);
    expect(t.errors).toEqual([]);
  });
  it('reprendre le verset précédent dans un nouveau segment n\'est pas une faute', () => {
    const t = makeTracker(1);
    feed(t, [FATIHA[0], FATIHA[1], FATIHA[1] + ' ' + FATIHA[2]]);
    expect(t.errors).toEqual([]);
    expect(N(t.words[t.pos].display)).toBe(N('مَـٰلِكِ'));
  });
});

describe('détection des fautes', () => {
  it('mot erroné → arrêt immédiat sur le bon mot', () => {
    const t = makeTracker(1);
    const ups = feed(t, [FATIHA[0], 'الْحَمْدُ لِلَّهِ رَبِّ النَّاسِ']);
    const errs = ups.flatMap((u) => u.newErrors);
    expect(errs).toHaveLength(1);
    expect(errs[0].type).toBe('wrong');
    expect(N(t.words[errs[0].wordIdx].display)).toBe(N('ٱلْعَـٰلَمِينَ'));
    expect(t.stopped).toBe(true);
  });
  it('confusion fine ي/ت détectée en mode strict', () => {
    const t = makeTracker(1);
    feed(t, [FATIHA[0], FATIHA[1], FATIHA[2], FATIHA[3], 'إِيَّاكَ يَعْبُدُ']);
    expect(t.errors[0]?.type).toBe('wrong');
    expect(N(t.words[t.errors[0].wordIdx].display)).toBe(N('نَعْبُدُ'));
  });
  it('mot oublié', () => {
    const t = makeTracker(112);
    feed(t, ['قُلْ اللَّهُ أَحَدٌ']);
    expect(t.errors[0]?.type).toBe('missing');
    expect(N(t.words[t.errors[0].wordIdx].display)).toBe(N('هُوَ'));
  });
  it('mot ajouté', () => {
    const t = makeTracker(112);
    feed(t, ['قُلْ هُوَ اللَّهُ الْوَاحِدُ أَحَدٌ']);
    expect(t.errors[0]?.type).toBe('extra');
  });
  it('verset sauté', () => {
    const t = makeTracker(112);
    feed(t, [IKHLAS[0], IKHLAS[2]]);
    const e = t.errors[0];
    expect(e?.type).toBe('ayah_skipped');
    expect(N(t.words[e.wordIdx].display)).toBe(N('ٱللَّهُ'));
  });
  it('pas de faute sur un partiel isolé (anti faux positif)', () => {
    const t = makeTracker(112);
    // Un seul partiel erroné, puis la transcription se corrige.
    t.update({ segment: 1, text: 'قُلْ هُوَ اللَّهُ أَخَذَ وَ', final: false });
    expect(t.errors).toHaveLength(0);
    t.update({ segment: 1, text: 'قُلْ هُوَ اللَّهُ أَحَدٌ', final: true });
    expect(t.errors).toHaveLength(0);
    expect(t.pos).toBeGreaterThan(4);
  });
  it('faute confirmée sur deux partiels successifs', () => {
    const t = makeTracker(112);
    t.update({ segment: 1, text: 'قُلْ هُوَ النَّاسُ أَحَدٌ', final: false });
    expect(t.errors).toHaveLength(0);
    t.update({ segment: 1, text: 'قُلْ هُوَ النَّاسُ أَحَدٌ اللَّهُ', final: false });
    expect(t.errors).toHaveLength(1);
  });
  it('final peu fiable : la faute attend une confirmation', () => {
    const t = makeTracker(112);
    t.update({ segment: 1, text: 'قُلْ هُوَ النَّاسُ', final: true, confidence: -2 });
    expect(t.errors).toHaveLength(0);
  });
});

describe('reprise après faute', () => {
  it('reprend au mot fautif et le marque corrigé', () => {
    const t = makeTracker(112);
    feed(t, ['قُلْ هُوَ النَّاسُ']);
    const e = t.errors[0];
    expect(t.stopped).toBe(true);
    t.resumeAt(e.wordIdx);
    feed(t, ['اللَّهُ أَحَدٌ', IKHLAS[1], IKHLAS[2], IKHLAS[3]], { firstSegment: 10 });
    expect(t.states[e.wordIdx]).toBe('corrected');
    expect(t.finished).toBe(true);
  });
  it('reprend au début du verset', () => {
    const t = makeTracker(112);
    feed(t, [IKHLAS[0], 'اللَّهُ الْأَحَدُ']);
    const e = t.errors[0];
    t.resumeAt(t.ayahStart(e.wordIdx));
    feed(t, [IKHLAS[1], IKHLAS[2], IKHLAS[3]], { firstSegment: 10 });
    expect(t.finished).toBe(true);
    expect(t.errors).toHaveLength(1);
  });
  it('en mode stop, le reste du segment fautif est ignoré', () => {
    const t = makeTracker(112);
    feed(t, ['قُلْ هُوَ النَّاسُ أَحَدٌ اللَّهُ الصَّمَدُ'], { partials: false });
    expect(t.stopped).toBe(true);
    t.update({ segment: 1, text: 'قُلْ هُوَ النَّاسُ أَحَدٌ اللَّهُ الصَّمَدُ لَمْ', final: false });
    expect(t.errors).toHaveLength(1);
  });
});

describe('mode correction à la fin', () => {
  it('continue après les fautes et les comptabilise', () => {
    const t = makeTracker(112, { mode: 'end' });
    feed(t, ['قُلْ هُوَ النَّاسُ أَحَدٌ', IKHLAS[1], 'لَمْ يَلِدْ وَلَمْ', IKHLAS[3]]);
    expect(t.finished).toBe(true);
    expect(t.errors.map((e) => e.type)).toEqual(['wrong', 'missing']);
    const s = t.summary();
    expect(s.totalWords).toBe(15);
    expect(s.correctWords).toBe(13);
  });
  it('verset sauté : saute et continue', () => {
    const t = makeTracker(112, { mode: 'end' });
    feed(t, [IKHLAS[0], IKHLAS[2], IKHLAS[3]]);
    expect(t.errors[0].type).toBe('ayah_skipped');
    expect(t.finished).toBe(true);
    expect(t.states.filter((s) => s === 'skipped')).toHaveLength(2);
  });
});

describe('indices (mode mémorisation)', () => {
  it('hint révèle le mot suivant et avance', () => {
    const t = makeTracker(112);
    feed(t, ['قُلْ هُوَ']);
    const i = t.hint();
    expect(N(t.words[i!].display)).toBe(N('ٱللَّهُ'));
    feed(t, ['أَحَدٌ'], { firstSegment: 5 });
    expect(t.errors).toHaveLength(0);
    expect(t.summary().hints).toBe(1);
  });
});
