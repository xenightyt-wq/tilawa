import type { Nav } from '../App';
import { TopBar } from '../components/TopBar';
import { useT } from '../lib/i18n';
import { useQuran } from '../lib/quranData';

export function About({ nav }: { nav: Nav }) {
  const t = useT();
  const q = useQuran();
  return (
    <div className="screen">
      <TopBar nav={nav} title={t('about')} />
      <section className="card prose">
        <p>{t('aboutText')}</p>
        <p className="disclaimer">{t('disclaimer')}</p>
        <h2 className="h-small">{t('privacy')}</h2>
        <p>{t('privacyText')}</p>

        <h2 className="h-small">{t('sources')}</h2>
        <ul>
          <li>
            <strong>Texte du Coran</strong> : Tanzil Project —{' '}
            <a href="https://tanzil.net" target="_blank" rel="noreferrer">
              tanzil.net
            </a>{' '}
            (texte uthmani et simple-clean, version {q.meta.textVersion}). Licence Creative Commons Attribution 3.0 ;
            texte reproduit sans modification. Suivi des mises à jour :{' '}
            <a href="https://tanzil.net/updates/" target="_blank" rel="noreferrer">
              tanzil.net/updates
            </a>
            .
          </li>
          <li>
            <strong>Métadonnées</strong> (pages, juz’, hizb) : Tanzil Quran Metadata, CC BY 3.0.
          </li>
          <li>
            <strong>Audio des récitateurs</strong> :{' '}
            <a href="https://everyayah.com" target="_blank" rel="noreferrer">
              EveryAyah.com
            </a>
            , fichiers par verset, téléchargés à la demande.
          </li>
          <li>
            <strong>Reconnaissance vocale</strong> : modèles Whisper affinés sur le Coran,{' '}
            <a href="https://huggingface.co/deepdml/whisper-small-ar-quran-mix-norm" target="_blank" rel="noreferrer">
              deepdml/whisper-small-ar-quran-mix-norm
            </a>{' '}
            et{' '}
            <a href="https://huggingface.co/tarteel-ai/whisper-base-ar-quran" target="_blank" rel="noreferrer">
              tarteel-ai/whisper-base-ar-quran
            </a>{' '}
            (Apache-2.0), basés sur OpenAI Whisper (MIT), exécutés avec faster-whisper / CTranslate2 (MIT).
          </li>
          <li>
            <strong>Police</strong> : Amiri Quran (Khaled Hosny), SIL Open Font License 1.1.
          </li>
        </ul>
        <details>
          <summary>Notice Tanzil (texte uthmani)</summary>
          <pre className="notice">{q.meta.copyrightUthmani}</pre>
        </details>
        <details>
          <summary>Notice Tanzil (texte simple)</summary>
          <pre className="notice">{q.meta.copyrightSimple}</pre>
        </details>
      </section>
    </div>
  );
}
