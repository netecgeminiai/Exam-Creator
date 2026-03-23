import { useState } from "react";

/** Render explanation: split into sentences, group 2 per paragraph, left-aligned */
function renderExplanation(text: string) {
  if (!text) return null;
  const naturalParas = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  if (naturalParas.length > 1) {
    return (
      <>
        {naturalParas.map((para, i) => (
          <p key={i} style={{ margin: i === 0 ? "0.5rem 0 0" : "0.7rem 0 0", textAlign: "left", lineHeight: 1.7 }}>
            {para}
          </p>
        ))}
      </>
    );
  }
  const sentenceRE = /(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑÜ¡])/g;
  const sentences = text.split(sentenceRE).map(s => s.trim()).filter(Boolean);
  const GROUP = 2;
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += GROUP) {
    paragraphs.push(sentences.slice(i, i + GROUP).join(" "));
  }
  return (
    <>
      {paragraphs.map((para, i) => (
        <p key={i} style={{ margin: i === 0 ? "0.5rem 0 0" : "0.7rem 0 0", textAlign: "left", lineHeight: 1.7 }}>
          {para}
        </p>
      ))}
    </>
  );
}

interface Option { key: string; text: string; }

/** Pre-built data passed in directly — no API call needed */
export interface ReviewData {
  question_number: number;
  english_stem?: string;
  english_options?: Option[];
  correct_answer?: string;
  correct_answers?: string[];
  spanish_stem?: string;
  spanish_options?: Option[];
  spanish_explanation?: string;
  english_explanation?: string;
  review_notes?: string[];
}

const QUESTION_TYPES = [
  "multiple_choice",
  "multiple_select",
  "drag_and_drop",
  "hotspot",
  "dropdown",
] as const;

interface Props {
  questionNumber: number;
  questionId?: number;       // DB id — needed to PATCH question_type
  examCode?: string;         // needed to PATCH
  currentType?: string;      // pre-select the current type
  prefill?: ReviewData;      // if provided, show immediately without API call
  onClose: () => void;
  onTypeChanged?: (newType: string) => void;  // notify parent so it can re-render
}

export default function ReviewPane({ questionNumber, questionId, examCode = "MS-900", currentType, prefill, onClose, onTypeChanged }: Props) {
  const [fetched, setFetched] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedType, setSelectedType] = useState(currentType ?? "");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

  // Use prefilled data if available, otherwise use fetched
  const data = prefill ?? fetched;

  const loadFromAPI = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/translate/${questionNumber}`);
      if (!res.ok) throw new Error(await res.text());
      const raw = await res.json();
      // Normalize the legacy API shape into our ReviewData shape
      setFetched({
        question_number: raw.question_number,
        english_stem: raw.english?.stem,
        english_options: raw.english?.options,
        correct_answer: raw.english?.correct_answer,
        correct_answers: raw.english?.correct_answers,
        spanish_stem: raw.spanish?.stem,
        spanish_options: raw.spanish?.options,
        spanish_explanation: raw.spanish?.explanation,
        english_explanation: raw.english?.explanation,
        review_notes: raw.review_notes,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const saveType = async () => {
    if (!questionId || !selectedType || selectedType === currentType) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${BASE}/exams/${examCode}/questions/${questionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_type: selectedType }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveMsg(`✅ Tipo cambiado a "${selectedType}"`);
      onTypeChanged?.(selectedType);
    } catch (e: any) {
      setSaveMsg(`❌ Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const correctList = data?.correct_answers?.length
    ? data.correct_answers
    : data?.correct_answer ? [data.correct_answer] : [];

  return (
    <div className="review-overlay">
      <div className="review-modal">
        <div className="review-header">
          <h2>🔍 Pregunta {questionNumber} — inglés / español</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Question type selector */}
        {questionId && (
          <div className="type-editor">
            <label htmlFor="qtype-select"><strong>🏷️ Tipo de pregunta:</strong></label>
            <select
              id="qtype-select"
              value={selectedType}
              onChange={e => { setSelectedType(e.target.value); setSaveMsg(""); }}
              style={{ marginLeft: "0.5rem", padding: "0.25rem 0.5rem", borderRadius: 6 }}
            >
              <option value="">— seleccionar —</option>
              {QUESTION_TYPES.map(t => (
                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
              ))}
            </select>
            <button
              className="btn-primary"
              style={{ marginLeft: "0.75rem", padding: "0.25rem 0.75rem" }}
              disabled={!selectedType || selectedType === currentType || saving}
              onClick={saveType}
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
            {saveMsg && <span style={{ marginLeft: "0.75rem", fontSize: "0.9rem" }}>{saveMsg}</span>}
          </div>
        )}

        {/* If no data at all, offer to fetch via LLM */}
        {!data && !loading && !error && (
          <div className="review-cta">
            <p>No hay traducción guardada para esta pregunta.</p>
            <button className="btn-primary" onClick={loadFromAPI}>🤖 Traducir ahora</button>
          </div>
        )}

        {loading && (
          <div className="review-loading">
            <div className="spinner" />
            <p>Cargando traducción...</p>
          </div>
        )}

        {error && (
          <div className="review-error">
            ⚠️ {error}
            <button className="btn-primary" style={{ marginTop: "1rem" }} onClick={loadFromAPI}>
              🔄 Reintentar
            </button>
          </div>
        )}

        {data && (
          <div className="review-content">
            {/* Side-by-side stems */}
            <div className="bilingual-grid">
              <div className="lang-col">
                <div className="lang-label">🇺🇸 Inglés</div>
                <div className="lang-text">{data.english_stem ?? "—"}</div>
              </div>
              <div className="lang-col">
                <div className="lang-label">🇲🇽 Español</div>
                <div className="lang-text">{data.spanish_stem ?? "—"}</div>
              </div>
            </div>

            {/* Options side-by-side */}
            {data.english_options && data.english_options.length > 0 && (
              <div className="options-grid">
                {data.english_options.map((opt, i) => {
                  const esOpt = data.spanish_options?.[i];
                  const isCorrect = correctList.includes(opt.key);
                  return (
                    <div key={opt.key} className={`opt-row ${isCorrect ? "opt-correct" : ""}`}>
                      <span className="opt-key">{opt.key}</span>
                      <span className="opt-en">{opt.text}</span>
                      <span className="opt-arrow">→</span>
                      <span className="opt-es">{esOpt?.text ?? "—"}</span>
                      {isCorrect && <span className="opt-badge">✓</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Review notes */}
            {data.review_notes && data.review_notes.length > 0 && (
              <div className="review-notes">
                <strong>📝 Notas de revisión:</strong>
                <ul>
                  {data.review_notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            )}

            {/* Explanation */}
            {(data.spanish_explanation || data.english_explanation) && (
              <div className="review-explanation">
                <strong>💡 Explicación:</strong>
                {renderExplanation(data.spanish_explanation ?? data.english_explanation ?? "")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
