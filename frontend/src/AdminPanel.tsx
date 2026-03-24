import { useState, useEffect, useCallback, Fragment } from "react";
import {
  importExam,
  batchReview,
  getReviewQuestions,
  patchQuestion,
  batchTranslate,
  improveExplanations,
  getExamStats,
  type ExamStats,
  type DBQuestion,
} from "./api";
import QuestionEditor from "./QuestionEditor";

// EXAM_CODE is now passed as a prop; this fallback is unused but kept for safety
const _DEFAULT_EXAM_CODE = "MS-900";

/** Render stem with paragraph breaks, underlines and single line breaks */
function renderStem(text: string) {
  const UNDERLINE_RE = /(__[^_]+__|\[[^\]]+\])/g;

  // Split on double newlines for paragraphs, then single newlines within
  const paragraphs = text.split(/\n{2,}/);

  const renderLine = (line: string, key: number) => {
    const parts = line.split(UNDERLINE_RE);
    return (
      <Fragment key={key}>
        {parts.map((part, i) => {
          if (part.startsWith("__") && part.endsWith("__")) return <u key={i}>{part.slice(2, -2)}</u>;
          if (part.startsWith("[") && part.endsWith("]")) return <u key={i}>{part.slice(1, -1)}</u>;
          return <span key={i}>{part}</span>;
        })}
      </Fragment>
    );
  };

  return (
    <>
      {paragraphs.map((para, pi) => {
        const lines = para.split(/\n/);
        return (
          <p key={pi} style={{ margin: pi > 0 ? "0.6em 0 0" : "0", textAlign: "left", lineHeight: 1.65 }}>
            {lines.map((line, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {renderLine(line, li)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

interface AdminPanelProps {
  onBack: () => void;
  focusQuestion?: number | null;
  examCode?: string;
}

type AdminTab = "dashboard" | "review" | "questions";

export default function AdminPanel({ onBack, focusQuestion, examCode: examCodeProp }: AdminPanelProps) {
  const EXAM_CODE = examCodeProp ?? _DEFAULT_EXAM_CODE;
  const [tab, setTab] = useState<AdminTab>(focusQuestion ? "review" : "dashboard");
  const [stats, setStats] = useState<ExamStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [reviewQuestions, setReviewQuestions] = useState<DBQuestion[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewOffset, setReviewOffset] = useState(0);
  const [reviewFilter, setReviewFilter] = useState<string>("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [reviewTypeFilter, setReviewTypeFilter] = useState<string>("");
  const [reviewQNumber, setReviewQNumber] = useState<string>("");
  const [batchLimit, setBatchLimit] = useState(50);
  const [batchOffset, setBatchOffset] = useState(0);

  const refreshStats = useCallback(async () => {
    try {
      const s = await getExamStats(EXAM_CODE);
      setStats(s);
    } catch {
      // no questions imported yet
    }
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  const handleImport = async () => {
    setLoading(true);
    setStatus("Importando PDF...");
    try {
      const result = await importExam(EXAM_CODE);
      setStatus(`✅ ${result.message}`);
      await refreshStats();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBatchReview = async () => {
    setLoading(true);
    setStatus(`Revisando con LLM (limit=${batchLimit}, offset=${batchOffset})...`);
    try {
      const result = await batchReview(EXAM_CODE, batchLimit, batchOffset);
      setStatus(`✅ Revisadas: ${result.processed}/${result.total} | Errores: ${result.errors}`);
      setBatchOffset(batchOffset + result.processed);
      await refreshStats();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBatchTranslate = async () => {
    setLoading(true);
    setStatus("Traduciendo aprobadas...");
    try {
      const result = await batchTranslate(EXAM_CODE, batchLimit, 0);
      setStatus(`✅ Traducidas: ${result.processed}/${result.total} | Errores: ${result.errors}`);
      await refreshStats();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImproveExplanations = async () => {
    setLoading(true);
    setStatus(`Mejorando explicaciones con LLM (limit=${batchLimit}, offset=${batchOffset})...`);
    try {
      const result = await improveExplanations(EXAM_CODE, batchLimit, batchOffset);
      setStatus(`✅ Explicaciones mejoradas: ${result.processed}/${result.total} | Errores: ${result.errors}`);
      setBatchOffset(batchOffset + result.processed);
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadReviewQuestions = async (filter: string, offset: number, typeFilter?: string, qNumber?: string) => {
    setLoading(true);
    try {
      const qNum = qNumber && /^\d+$/.test(qNumber.trim()) ? parseInt(qNumber.trim()) : undefined;
      const data = await getReviewQuestions(
        EXAM_CODE,
        filter || undefined,
        20,
        offset,
        qNum,
        typeFilter || undefined,
      );
      setReviewQuestions(data.questions);
      setReviewTotal(data.total);
    } catch (e: any) {
      setStatus(`❌ Error cargando preguntas: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // When focusQuestion is set, fetch that specific question and open its editor directly
  useEffect(() => {
    if (!focusQuestion) return;
    (async () => {
      setLoading(true);
      try {
        const data = await getReviewQuestions(EXAM_CODE, undefined, 1, 0, focusQuestion);
        if (data.questions.length > 0) {
          setReviewQuestions(data.questions);
          setReviewTotal(1);
          setEditingId(data.questions[0].id);
        } else {
          setStatus(`⚠️ Pregunta #${focusQuestion} no encontrada en revisión`);
          loadReviewQuestions(reviewFilter, reviewOffset);
        }
      } catch (e: any) {
        setStatus(`❌ Error: ${e.message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [focusQuestion]);

  useEffect(() => {
    if (tab === "review" && !focusQuestion) {
      loadReviewQuestions(reviewFilter, reviewOffset, reviewTypeFilter, reviewQNumber);
    }
  }, [tab, reviewFilter, reviewOffset, reviewTypeFilter]);

  const reloadCurrent = () => loadReviewQuestions(reviewFilter, reviewOffset, reviewTypeFilter, reviewQNumber);

  const handleApprove = async (q: DBQuestion) => {
    try {
      await patchQuestion(EXAM_CODE, q.id, { review_status: "approved" });
      setStatus(`✅ Pregunta ${q.question_number} aprobada`);
      await reloadCurrent();
      await refreshStats();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    }
  };

  const handleSkip = async (q: DBQuestion) => {
    try {
      await patchQuestion(EXAM_CODE, q.id, { review_status: "skipped" });
      setStatus(`⏭️ Pregunta ${q.question_number} saltada`);
      await reloadCurrent();
      await refreshStats();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    }
  };

  const handleEdit = async (q: DBQuestion, patch: Record<string, unknown>) => {
    try {
      await patchQuestion(EXAM_CODE, q.id, patch);
      const approved = patch.review_status === "approved";
      setStatus(approved
        ? `✅ Pregunta ${q.question_number} editada y aprobada`
        : `✏️ Pregunta ${q.question_number} editada`);
      await reloadCurrent();
      await refreshStats();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setEditingId(null);
    }
  };

  const statusColor = (s: string) => {
    if (s === "approved") return "#22c55e";
    if (s === "edited") return "#f59e0b";
    if (s === "skipped") return "#6b7280";
    return "#3b82f6";
  };

  return (
    <div className="admin-panel">
      <header className="admin-header">
        <button className="btn-secondary" onClick={onBack}>← Volver</button>
        <h2>🛠️ Panel de Administración — {EXAM_CODE}</h2>
      </header>

      <nav className="admin-tabs">
        <button className={tab === "dashboard" ? "tab active" : "tab"} onClick={() => setTab("dashboard")}>
          📊 Dashboard
        </button>
        <button className={tab === "review" ? "tab active" : "tab"} onClick={() => setTab("review")}>
          🔍 Revisar
        </button>
      </nav>

      {status && (
        <div className="status-bar">
          {loading && <span className="spinner-sm" />}
          {status}
        </div>
      )}

      {/* ── DASHBOARD TAB ── */}
      {tab === "dashboard" && (
        <div className="dashboard">
          {/* Stats */}
          {stats && (
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-num">{stats.total}</span>
                <span className="stat-label">Total preguntas</span>
              </div>
              <div className="stat-card pending">
                <span className="stat-num">{stats.by_review_status.pending}</span>
                <span className="stat-label">Pendientes</span>
              </div>
              <div className="stat-card approved">
                <span className="stat-num">{stats.by_review_status.approved}</span>
                <span className="stat-label">Aprobadas</span>
              </div>
              <div className="stat-card edited">
                <span className="stat-num">{stats.by_review_status.edited}</span>
                <span className="stat-label">Editadas</span>
              </div>
              <div className="stat-card translated">
                <span className="stat-num">{stats.translated}</span>
                <span className="stat-label">Traducidas</span>
              </div>
            </div>
          )}

          {/* Progress bar */}
          {stats && stats.total > 0 && (
            <div className="progress-section">
              <div className="progress-bar">
                <div
                  className="progress-fill approved"
                  style={{ width: `${(stats.by_review_status.approved / stats.total) * 100}%` }}
                />
                <div
                  className="progress-fill edited"
                  style={{ width: `${(stats.by_review_status.edited / stats.total) * 100}%` }}
                />
              </div>
              <small>
                {Math.round(((stats.by_review_status.approved + stats.by_review_status.edited) / stats.total) * 100)}%
                revisado
              </small>
            </div>
          )}

          {/* Action buttons */}
          <div className="action-section">
            <h3>Acciones</h3>

            <div className="action-row">
              <button className="btn-primary" onClick={handleImport} disabled={loading}>
                📥 Importar {EXAM_CODE}
              </button>
              <small>Parsea el PDF y guarda preguntas en DB (idempotente)</small>
            </div>

            <div className="action-row">
              <div className="batch-controls">
                <label>
                  Limit:
                  <input type="number" value={batchLimit} min={1} max={200}
                    onChange={e => setBatchLimit(Number(e.target.value))} />
                </label>
                <label>
                  Offset:
                  <input type="number" value={batchOffset} min={0}
                    onChange={e => setBatchOffset(Number(e.target.value))} />
                </label>
              </div>
              <button className="btn-warning" onClick={handleBatchReview} disabled={loading || !stats?.total}>
                🤖 Revisar en lote ({batchLimit})
              </button>
              <small>Envía preguntas pendientes al LLM para limpieza OCR y revisión</small>
            </div>

            <div className="action-row">
              <button className="btn-success" onClick={handleBatchTranslate} disabled={loading || !stats?.by_review_status.approved}>
                🌐 Traducir aprobadas ({stats?.by_review_status.approved ?? 0})
              </button>
              <small>Traduce al español todas las preguntas aprobadas</small>
            </div>

            <div className="action-row">
              <button className="btn-improve" onClick={handleImproveExplanations} disabled={loading || !stats?.translated}>
                💡 Mejorar explicaciones ({stats?.translated ?? 0} traducidas)
              </button>
              <small>El LLM reescribe las explicaciones para que sean completas y precisas</small>
            </div>
          </div>
        </div>
      )}

      {/* ── REVIEW TAB ── */}
      {tab === "review" && (
        <div className="review-section">
          <div className="review-filters">
            <label>Estado:</label>
            <select value={reviewFilter} onChange={e => { setReviewFilter(e.target.value); setReviewOffset(0); }}>
              <option value="">Pendientes + Editadas</option>
              <option value="pending">Solo pendientes</option>
              <option value="edited">Solo editadas</option>
              <option value="approved">Aprobadas</option>
              <option value="skipped">Saltadas</option>
            </select>

            <label>Tipo:</label>
            <select value={reviewTypeFilter} onChange={e => { setReviewTypeFilter(e.target.value); setReviewOffset(0); }}>
              <option value="">Todos</option>
              <option value="multiple_choice">Multiple choice</option>
              <option value="multiple_select">Multiple select</option>
              <option value="hotspot">Hotspot</option>
              <option value="drag_and_drop">Drag and drop</option>
              <option value="dropdown">Dropdown</option>
            </select>

            <label>Pregunta #:</label>
            <input
              type="number"
              placeholder="ej. 96"
              value={reviewQNumber}
              min={1}
              style={{ width: 80, background: "#1e293b", border: "1px solid #475569", color: "#e2e8f0", borderRadius: 6, padding: "0.4rem 0.6rem" }}
              onChange={e => setReviewQNumber(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { setReviewOffset(0); loadReviewQuestions(reviewFilter, 0, reviewTypeFilter, reviewQNumber); }}}
            />
            <button
              className="btn-secondary"
              style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
              onClick={() => { setReviewOffset(0); loadReviewQuestions(reviewFilter, 0, reviewTypeFilter, reviewQNumber); }}
            >🔍 Buscar</button>
            <button
              className="btn-secondary"
              style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
              onClick={() => { setReviewFilter(""); setReviewTypeFilter(""); setReviewQNumber(""); setReviewOffset(0); }}
            >✕ Limpiar</button>

            <span className="total-badge">{reviewTotal} preguntas</span>

            <button
              className="btn-secondary"
              style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem", marginLeft: "auto" }}
              title="Descargar JSON con todas las preguntas filtradas (incluye notas LLM y explicaciones)"
              onClick={() => {
                const params = new URLSearchParams();
                if (reviewFilter) params.set("status", reviewFilter);
                if (reviewTypeFilter) params.set("question_type", reviewTypeFilter);
                const url = `http://localhost:8000/exams/${EXAM_CODE}/export?${params.toString()}`;
                window.open(url, "_blank");
              }}
            >
              ⬇️ Exportar JSON
            </button>
          </div>

          <div className="review-list">
            {reviewQuestions.length === 0 && !loading && (
              <div className="empty-state">
                {stats?.total === 0
                  ? "No hay preguntas importadas. Ve al Dashboard e importa el PDF primero."
                  : "No hay preguntas en esta categoría."}
              </div>
            )}

            {reviewQuestions.map(q => (
              <div key={q.id} className="review-card">
                <div className="review-card-header">
                  <span className="q-number">Q{q.question_number}</span>
                  <span className="q-type">{q.question_type}</span>
                  <span className="q-status" style={{ color: statusColor(q.review_status) }}>
                    ● {q.review_status}
                  </span>
                  <div className="review-actions">
                    <button className="btn-approve" onClick={() => handleApprove(q)}>✅ Aprobar</button>
                    <button className="btn-edit" onClick={() => setEditingId(q.id)}>✏️ Editar</button>
                    <button className="btn-skip" onClick={() => handleSkip(q)}>⏭️ Saltar</button>
                  </div>
                </div>

                {/* Review notes from LLM */}
                {q.review_notes && q.review_notes.length > 0 && (
                  <div className="review-notes">
                    <strong>🤖 Notas LLM:</strong>
                    <ul>
                      {q.review_notes.map((note, i) => (
                        <li key={i} style={{ lineHeight: 1.5 }}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Question stem + options — only shown when NOT editing */}
                {editingId === q.id ? (
                  <QuestionEditor
                    question={q}
                    onSave={(patch) => {
                      if (patch._cancel) { setEditingId(null); return; }
                      handleEdit(q, patch);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div className="q-stem">
                      {q.english_stem
                        ? renderStem(q.english_stem)
                        : <em className="raw-text">{q.raw_text?.substring(0, 300)}...</em>}
                    </div>

                    {/* Options — only for non-drag-and-drop (drag editor shows its own) */}
                    {q.english_options && q.english_options.length > 0 && q.question_type !== "drag_and_drop" && (
                      <div className="q-options">
                        {q.english_options.map(opt => (
                          <div key={opt.key} className={`option ${
                            (q.correct_answer === opt.key || q.correct_answers?.includes(opt.key)) ? "correct" : ""
                          }`}>
                            <strong>{opt.key}.</strong> {opt.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {reviewTotal > 20 && (
            <div className="pagination">
              <button disabled={reviewOffset === 0} onClick={() => setReviewOffset(Math.max(0, reviewOffset - 20))}>
                ← Anterior
              </button>
              <span>{Math.floor(reviewOffset / 20) + 1} / {Math.ceil(reviewTotal / 20)}</span>
              <button disabled={reviewOffset + 20 >= reviewTotal} onClick={() => setReviewOffset(reviewOffset + 20)}>
                Siguiente →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
