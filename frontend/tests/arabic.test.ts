import { describe, expect, it } from 'vitest';
import {
  levenshtein,
  looseForm,
  normalizeWord,
  similarity,
  tokenize,
  wordSimilarity,
} from '../src/core/arabic';

describe('normalizeWord', () => {
  it('retire diacritiques, tatweel et unifie alef wasla', () => {
    expect(normalizeWord('ٱلرَّحْمَـٰنِ')).toBe('الرحمن');
    expect(normalizeWord('بِسْمِ')).toBe('بسم');
  });
  it('unifie hamzas, alef maqsura et ta marbuta', () => {
    expect(normalizeWord('إِيَّاكَ')).toBe('اياك');
    expect(normalizeWord('أَحَدٌ')).toBe('احد');
    expect(normalizeWord('ٱلصِّرَٰطَ')).toBe('الصرط');
    expect(normalizeWord('مُوسَىٰ')).toBe('موسي');
    expect(normalizeWord('جَهْرَةً')).toBe('جهره');
    expect(normalizeWord('شَىْءٍ')).toBe('شي');
    expect(normalizeWord('يُؤْمِنُونَ')).toBe('يومنون');
  });
  it('supprime les marques de pause et petites lettres uthmani', () => {
    expect(normalizeWord('رَيْبَ ۛ')).toBe('ريب');
    expect(normalizeWord('لَهُۥ')).toBe('له');
    expect(normalizeWord('ٱعْبُدُوا۟')).toBe('اعبدوا');
    expect(normalizeWord('۞')).toBe('');
  });
  it('accepte une transcription voyellée de façon imla\'i', () => {
    expect(normalizeWord('الْعَالَمِينَ')).toBe('العالمين');
    expect(normalizeWord('الضَّالِّينَ')).toBe('الضالين');
  });
});

describe('formes souples et similarité', () => {
  it('rapproche alef plein / alef suscrit', () => {
    const uth = normalizeWord('ٱلْعَـٰلَمِينَ'); // العلمين
    expect(uth).toBe('العلمين');
    expect(looseForm('العالمين')).toBe(looseForm(uth));
    expect(wordSimilarity('العالمين', [uth])).toBeGreaterThan(0.95);
  });
  it('distingue des mots réellement différents', () => {
    expect(wordSimilarity('يعلمون', ['تعلمون'])).toBeLessThan(0.86);
    expect(wordSimilarity('نعبد', ['نستعين'])).toBeLessThan(0.7);
  });
  it('levenshtein', () => {
    expect(levenshtein('كتاب', 'كتب')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(similarity('abc', 'abc')).toBe(1);
  });
  it('tokenize ignore la ponctuation et les vides', () => {
    expect(tokenize('قُلْ هُوَ اللَّهُ أَحَدٌ.  ،')).toEqual(['قل', 'هو', 'الله', 'احد']);
  });
});
