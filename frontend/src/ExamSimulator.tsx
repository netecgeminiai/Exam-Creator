import { useState } from "react";
import type { Question, DBQuestion } from "./api";

/**
 * Render explanation text: split into sentences and group every 2-3 per paragraph.
 * Handles text that comes as one long block with no newlines.
 */
function renderExplanation(text: string) {
  if (!text) return null;

  // First try natural paragraph breaks (double newline)
  const naturalParas = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  if (naturalParas.length > 1) {
    // Already has paragraph structure — render each
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

  // No natural breaks — split by sentence boundaries then group 2 sentences per paragraph
  // Split on ". " followed by uppercase or "La ", "El ", "Las ", etc.
  const sentenceRE = /(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑÜ¡])/g;
  const sentences = text.split(sentenceRE).map(s => s.trim()).filter(Boolean);
  const GROUP = 2; // sentences per paragraph
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

/** Render __underlined__ and [bracketed] markers as <u> tags, preserving paragraph breaks */
function renderStem(text: string) {
  const paragraphs = text.split(/\n{2,}/);
  // Matches __text__ or [text] as underline markers
  const UNDERLINE_RE = /(__[^_]+__|\[[^\]]+\])/g;
  return (
    <>
      {paragraphs.map((para, pi) => {
        const parts = para.split(UNDERLINE_RE);
        return (
          <p key={pi} style={{ marginBottom: pi < paragraphs.length - 1 ? "0.8em" : 0 }}>
            {parts.map((part, i) => {
              if (part.startsWith("__") && part.endsWith("__"))
                return <u key={i}>{part.slice(2, -2)}</u>;
              if (part.startsWith("[") && part.endsWith("]"))
                return <u key={i}>{part.slice(1, -1)}</u>;
              return <span key={i}>{part}</span>;
            })}
          </p>
        );
      })}
    </>
  );
}
import ReviewPane, { type ReviewData } from "./ReviewPane";
import DragDropQuestion from "./DragDropQuestion";
import HotspotQuestion from "./HotspotQuestion";

/** Parse raw_text into stem + options when structured data isn't available */
function parseRawText(raw: string): { stem: string; options: {key:string; text:string}[]; answer: string; explanation: string } {
  const lines = raw.split(/\n/).map(l => l.trim()).filter(Boolean);
  const optionRegex = /^([A-F])[.\)]\s+(.+)/;
  const answerRegex = /^Answer:\s*(.+)/i;
  const explanationRegex = /^Explanation[:\s]/i;

  const options: {key:string; text:string}[] = [];
  let answer = "";
  let explanation = "";
  const stemLines: string[] = [];
  let inExplanation = false;
  const explanationLines: string[] = [];

  for (const line of lines) {
    if (inExplanation) { explanationLines.push(line); continue; }
    const optMatch = line.match(optionRegex);
    const ansMatch = line.match(answerRegex);
    if (explanationRegex.test(line)) { inExplanation = true; continue; }
    if (ansMatch) { answer = ansMatch[1].trim(); continue; }
    if (optMatch) { options.push({ key: optMatch[1], text: optMatch[2] }); continue; }
    if (options.length === 0) stemLines.push(line);
  }

  // Remove "QUESTION N" prefix from stem
  const stem = stemLines.filter(l => !/^QUESTION\s+\d+/i.test(l)).join("\n").trim();
  explanation = explanationLines.join("\n").trim();
  return { stem, options, answer, explanation };
}

interface Props {
  questions: Question[];
  dbQuestions?: DBQuestion[];
  englishMode?: boolean;
  onReset: () => void;
  onEditQuestion?: (questionNumber: number) => void;
}

/** Normalize a DBQuestion into the Question shape the simulator uses */
function dbToQuestion(dq: DBQuestion): Question {
  const t = dq.translation;
  const spanishOptions = t?.spanish_options?.map((o, i) => ({
    key: o.key,
    text: o.text,                                   // spanish text as primary (shown in simulator)
    text_en: dq.english_options?.[i]?.text ?? o.text, // english for reference
    text_es: o.text,
  })) ?? dq.english_options?.map(o => ({ key: o.key, text: o.text, text_es: o.text })) ?? [];

  // For drag_and_drop, prefer spanish_correct_answers (translated target labels)
  const effectiveCorrectAnswers =
    dq.question_type === "drag_and_drop" && t?.spanish_correct_answers?.length
      ? t.spanish_correct_answers
      : dq.correct_answers ?? [];

  return {
    question_number: dq.question_number,
    question_type: dq.question_type,
    raw_text: dq.raw_text,
    question_text: dq.english_stem,
    question_text_es: t?.spanish_stem ?? dq.english_stem,
    options: spanishOptions,
    correct_answer: dq.correct_answer,
    correct_answers: effectiveCorrectAnswers,
    explanation: t?.spanish_explanation ?? t?.english_explanation,
  };
}

export default function ExamSimulator({ questions, dbQuestions = [], englishMode = false, onReset, onEditQuestion }: Props) {
  // If we have dbQuestions (translated mode), use those; otherwise fall back to legacy
  const allQuestions: Question[] = dbQuestions.length > 0
    ? dbQuestions.map(dbToQuestion)
    : questions;
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [showScore, setShowScore] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [navFilter, setNavFilter] = useState<string>("all");
  // History: store {selected, submitted} per question index so we can go back
  const [history, setHistory] = useState<Record<number, { selected: string[]; submitted: boolean }>>({});

  const q = allQuestions[idx];
  if (!q) return <div>No questions found.</div>;

  // Build ReviewPane prefill from the raw DBQuestion if available
  const dbQ = dbQuestions[idx];
  const reviewPrefill: ReviewData | undefined = dbQ ? {
    question_number: dbQ.question_number,
    english_stem: dbQ.english_stem,
    english_options: dbQ.english_options,
    correct_answer: dbQ.correct_answer,
    correct_answers: dbQ.correct_answers,
    spanish_stem: dbQ.translation?.spanish_stem,
    spanish_options: dbQ.translation?.spanish_options,
    spanish_explanation: dbQ.translation?.spanish_explanation,
    english_explanation: dbQ.translation?.english_explanation,
    review_notes: dbQ.review_notes,
  } : undefined;

  // Parse raw_text if structured data is missing
  const parsed = (!q.options || q.options.length === 0) ? parseRawText(q.raw_text ?? "") : null;
  const displayOptions = q.options && q.options.length > 0 ? q.options : (parsed?.options ?? []);
  const displayStem = englishMode
    ? (q.question_text ?? parsed?.stem ?? q.raw_text)
    : (q.question_text_es ?? q.question_text ?? parsed?.stem ?? q.raw_text);
  const rawAnswer = q.correct_answer ?? parsed?.answer ?? "";
  // Split "ADE" → ["A","D","E"] or "A, D" → ["A","D"]
  const splitAnswers = (ans: string): string[] => {
    if (!ans) return [];
    const cleaned = ans.replace(/\s/g, "");
    // If it looks like multiple letters jammed together (e.g. "ADE"), split each char
    if (/^[A-F]{2,}$/.test(cleaned)) return cleaned.split("");
    // Otherwise split by comma or space
    return ans.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  };
  const correctAnswers = q.correct_answers?.length ? q.correct_answers : splitAnswers(rawAnswer);
  const correctAnswer = correctAnswers.length === 1 ? correctAnswers[0] : rawAnswer;
  const displayExplanation = (q as any).explanation ?? parsed?.explanation ?? "";

  const isCorrect = (): boolean => {
    if (correctAnswers.length === 0) return false;
    // For both MC and MS, compare sorted arrays
    const correct = [...correctAnswers].sort().join(",");
    const sel = [...selected].sort().join(",");
    return sel === correct;
  };

  const handleSelect = (key: string) => {
    if (submitted) return;
    if (q.question_type === "multiple_select") {
      setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    } else {
      setSelected([key]);
    }
  };

  const handleSubmit = () => {
    setSubmitted(true);
    if (isCorrect()) setScore(s => s + 1);
  };

  const handleNext = () => {
    // Save current state in history before moving
    setHistory(h => ({ ...h, [idx]: { selected, submitted } }));
    if (idx + 1 >= allQuestions.length) {
      setShowScore(true);
    } else {
      const next = idx + 1;
      const saved = history[next];
      setIdx(next);
      setSelected(saved?.selected ?? []);
      setSubmitted(saved?.submitted ?? false);
    }
  };

  const handlePrev = () => {
    if (idx === 0) return;
    // Save current state before going back
    setHistory(h => ({ ...h, [idx]: { selected, submitted } }));
    const prev = idx - 1;
    const saved = history[prev];
    setIdx(prev);
    setSelected(saved?.selected ?? []);
    setSubmitted(saved?.submitted ?? false);
  };

  // Unique question types for filter
  const questionTypes = Array.from(new Set(allQuestions.map(q => q.question_type))).sort();

  // Filtered list for nav panel
  const navQuestions = navFilter === "all"
    ? allQuestions
    : allQuestions.filter(q => q.question_type === navFilter);

  const goToQuestion = (targetIdx: number) => {
    setHistory(h => ({ ...h, [idx]: { selected, submitted } }));
    const saved = history[targetIdx];
    setIdx(targetIdx);
    setSelected(saved?.selected ?? []);
    setSubmitted(saved?.submitted ?? false);
    setShowNav(false);
  };

  if (showScore) {
    const pct = Math.round((score / allQuestions.length) * 100);
    return (
      <div className="score-screen">
        <h2>🎉 Examen completado</h2>
        <p className="big-score">{score} / {allQuestions.length} ({pct}%)</p>
        <p>{pct >= 70 ? "✅ ¡Aprobado!" : "❌ No aprobado (mínimo 70%)"}</p>
        <button onClick={onReset}>Subir otro PDF</button>
      </div>
    );
  }

  return (
    <div className="simulator">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${((idx + 1) / allQuestions.length) * 100}%` }} />
      </div>
      <div className="q-header">
        <span>Pregunta {idx + 1} / {allQuestions.length}</span>
        <span className="q-pdf-number">PDF #{q.question_number}</span>
        <span className={`badge badge-${q.question_type}`}>{q.question_type.replace(/_/g, " ")}</span>
        <button className="btn-nav-toggle" onClick={() => setShowNav(v => !v)} title="Ir a pregunta">
          📋 Ir a...
        </button>
        {onEditQuestion && (
          <button className="btn-edit-inline" onClick={() => onEditQuestion(q.question_number)} title="Editar esta pregunta">
            ✏️ Editar
          </button>
        )}
      </div>

      {/* Navigation panel */}
      {showNav && (
        <div className="nav-panel">
          <div className="nav-panel-header">
            <strong>📋 Ir a pregunta</strong>
            <div className="nav-filters">
              <button
                className={`nav-type-btn ${navFilter === "all" ? "active" : ""}`}
                onClick={() => setNavFilter("all")}
              >Todas ({allQuestions.length})</button>
              {questionTypes.map(type => (
                <button
                  key={type}
                  className={`nav-type-btn ${navFilter === type ? "active" : ""}`}
                  onClick={() => setNavFilter(type)}
                >
                  {type.replace(/_/g, " ")} ({allQuestions.filter(q => q.question_type === type).length})
                </button>
              ))}
            </div>
          </div>
          <div className="nav-grid">
            {navQuestions.map((nq) => {
              const realIdx = allQuestions.indexOf(nq);
              const isAnswered = history[realIdx]?.submitted;
              const isCurrent = realIdx === idx;
              return (
                <button
                  key={nq.question_number}
                  className={`nav-cell ${isCurrent ? "current" : ""} ${isAnswered ? "answered" : ""}`}
                  onClick={() => goToQuestion(realIdx)}
                  title={`PDF #${nq.question_number} — ${nq.question_type.replace(/_/g, " ")}`}
                >
                  <span className="nav-cell-num">{realIdx + 1}</span>
                  <span className="nav-cell-pdf">#{nq.question_number}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="question-text">{renderStem(displayStem ?? "")}</div>

      {/* MC / MS options */}
      {(q.question_type === "multiple_choice" || q.question_type === "multiple_select") && displayOptions.length > 0 && (
        <ul className="options">
          {displayOptions.map(opt => {
            const isSel = selected.includes(opt.key);
            const isRight = correctAnswer === opt.key || correctAnswers.includes(opt.key);
            let cls = "option";
            if (submitted && isRight) cls += " correct";
            if (submitted && isSel && !isRight) cls += " wrong";
            if (!submitted && isSel) cls += " selected";
            return (
              <li key={opt.key} className={cls} onClick={() => handleSelect(opt.key)}>
                <strong>{opt.key}.</strong> {englishMode ? ((opt as any).text_en ?? opt.text) : ((opt as any).text_es ?? opt.text)}
              </li>
            );
          })}
        </ul>
      )}

      {/* Hotspot / Yes-No */}
      {q.question_type === "hotspot" && displayOptions.length > 0 && (
        <HotspotQuestion
          stem={displayStem}
          options={displayOptions.map(o => ({ key: o.key, text: englishMode ? ((o as any).text_en ?? o.text) : ((o as any).text_es ?? o.text) }))}
          correctAnswers={correctAnswers}
          submitted={submitted}
          onAnswer={(correct) => { setSubmitted(true); if (correct) setScore(s => s + 1); }}
        />
      )}
      {q.question_type === "hotspot" && displayOptions.length === 0 && (
        <div className="raw-preview"><pre>{q.raw_text}</pre></div>
      )}

      {/* Drag and drop */}
      {q.question_type === "drag_and_drop" && displayOptions.length > 0 && (
        <DragDropQuestion
          stem={displayStem}
          options={displayOptions.map(o => ({ key: o.key, text: englishMode ? ((o as any).text_en ?? o.text) : ((o as any).text_es ?? o.text) }))}
          correctAnswers={correctAnswers}
          submitted={submitted}
          onAnswer={(correct) => { setSubmitted(true); if (correct) setScore(s => s + 1); }}
        />
      )}
      {q.question_type === "drag_and_drop" && displayOptions.length === 0 && (
        <div className="raw-preview"><pre>{q.raw_text}</pre></div>
      )}

      {/* Feedback banner — shown above explanation, full width */}
      {submitted && (q.question_type === "multiple_choice" || q.question_type === "multiple_select") && (
        <div className={isCorrect() ? "feedback-banner correct" : "feedback-banner wrong"}>
          {isCorrect()
            ? "✅ ¡Correcto!"
            : `❌ Incorrecto — Respuesta correcta: ${correctAnswer || correctAnswers.join(", ")}`}
        </div>
      )}

      {/* Explanation after submit */}
      {submitted && displayExplanation && (
        <div className="explanation">
          <strong>💡 Explicación:</strong>
          {renderExplanation(displayExplanation)}
        </div>
      )}

      <button className="btn-review" onClick={() => setReviewing(true)}>
        🔍 Comparar inglés / español
      </button>

      {reviewing && (
        <ReviewPane
          questionNumber={q.question_number}
          questionId={dbQ?.id}
          examCode="MS-900"
          currentType={q.question_type}
          prefill={reviewPrefill}
          onClose={() => setReviewing(false)}
          onTypeChanged={(newType) => {
            // Update the in-memory question type so the simulator re-renders immediately
            if (dbQ) (dbQ as any).question_type = newType;
          }}
        />
      )}

      <div className="actions">
        {idx > 0 && (
          <button className="btn-prev" onClick={handlePrev}>← Anterior</button>
        )}

        {!submitted ? (
          <>
            {(q.question_type === "multiple_choice" || q.question_type === "multiple_select") && selected.length > 0 && (
              <button onClick={handleSubmit}>Verificar</button>
            )}
            <button className="btn-skip" onClick={handleNext}>
              {idx + 1 >= allQuestions.length ? "Ver resultados" : "Saltar →"}
            </button>
          </>
        ) : (
          <button onClick={handleNext}>
            {idx + 1 >= allQuestions.length ? "Ver resultados" : "Siguiente →"}
          </button>
        )}
      </div>
    </div>
  );
}
