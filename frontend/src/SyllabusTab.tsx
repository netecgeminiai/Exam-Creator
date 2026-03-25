import { useState, useEffect } from "react";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

interface ExamMeta {
  exam_code: string;
  exam_name: string | null;
  vendor: string | null;
  domain: string | null;
  version: string | null;
}

interface Topic {
  id: number;
  topic_key: string;
  topic_name: string;
  description: string;
  weight_pct: number;
  order: number;
  confirmed: boolean;
  source: string;
  questions_mapped: number;
}

interface SyllabusData {
  exam_code: string;
  topics: Topic[];
  total_questions: number;
  mapped_questions: number;
  unmapped_questions: number;
}

interface ValidationStats {
  total: number;
  pending: number;
  valid: number;
  needs_review: number;
  rejected: number;
  validated_pct: number;
  valid_pct: number;
}

interface Props {
  examCode: string;
}

export default function SyllabusTab({ examCode }: Props) {
  const [data, setData] = useState<SyllabusData | null>(null);
  const [valStats, setValStats] = useState<ValidationStats | null>(null);
  const [meta, setMeta] = useState<ExamMeta | null>(null);
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState({ exam_name: "", vendor: "", domain: "", version: "" });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [researching, setResearching] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [validating, setValidating] = useState(false);

  async function load() {
    try {
      const [syl, val, m] = await Promise.all([
        fetch(`${BASE}/exams/${examCode}/syllabus`),
        fetch(`${BASE}/exams/${examCode}/validation-stats`),
        fetch(`${BASE}/exams/${examCode}/metadata`),
      ]);
      if (syl.ok) setData(await syl.json());
      if (val.ok) setValStats(await val.json());
      if (m.ok) {
        const md = await m.json();
        setMeta(md);
        setMetaForm({
          exam_name: md.exam_name || "",
          vendor: md.vendor || "",
          domain: md.domain || "",
          version: md.version || "",
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [examCode]);

  async function handleSaveMeta() {
    try {
      const res = await fetch(`${BASE}/exams/${examCode}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metaForm),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditingMeta(false);
      setStatus("✅ Metadata guardada.");
      await load();
    } catch (e: any) {
      setStatus(`❌ ${e.message}`);
    }
  }

  async function handleResearch() {
    setResearching(true);
    setStatus("🔍 Investigando syllabus oficial con LLM...");
    try {
      const res = await fetch(`${BASE}/exams/${examCode}/syllabus/research`, { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || "Error");
      setStatus(`✅ ${result.topics_generated} tópicos generados. Revísalos y confirma.`);
      await load();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setResearching(false);
    }
  }

  async function handleConfirmAll() {
    try {
      const res = await fetch(`${BASE}/exams/${examCode}/syllabus/confirm-all`, { method: "POST" });
      const result = await res.json();
      setStatus(`✅ ${result.confirmed} tópicos confirmados.`);
      await load();
    } catch (e: any) {
      setStatus(`❌ ${e.message}`);
    }
  }

  async function handleMapQuestions() {
    setMapping(true);
    setStatus("🔗 Mapeando preguntas a tópicos con LLM...");
    try {
      let totalMapped = 0;
      let remaining = data?.unmapped_questions ?? 0;

      while (remaining > 0) {
        // Always offset=0 — backend filters by unmapped so list shrinks each round
        const res = await fetch(
          `${BASE}/exams/${examCode}/syllabus/map-questions?limit=20&offset=0`,
          { method: "POST" }
        );
        const result = await res.json();
        if (!res.ok) throw new Error(result.detail || "Error");
        totalMapped += result.mapped;
        remaining = result.total_unmapped_remaining;
        setStatus(`🔗 Mapeando... ${totalMapped} preguntas asignadas, ${remaining} restantes`);
        if (result.processed === 0 || result.mapped === 0) break;
      }

      setStatus(`✅ Mapeo completado: ${totalMapped} preguntas asignadas a tópicos.`);
      await load();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setMapping(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setStatus("🔎 Validando preguntas contra el syllabus oficial...");
    try {
      let totalValid = 0, totalNeeds = 0, totalRejected = 0, remaining = valStats?.pending ?? 0;

      while (remaining > 0) {
        const res = await fetch(`${BASE}/exams/${examCode}/validate-questions?limit=20&offset=0`, { method: "POST" });
        const result = await res.json();
        if (!res.ok) throw new Error(result.detail || "Error");
        totalValid += result.valid;
        totalNeeds += result.needs_review;
        totalRejected += result.rejected;
        remaining = result.remaining;
        setStatus(`🔎 Validando... ✅ ${totalValid} válidas · ⚠️ ${totalNeeds} revisar · ❌ ${totalRejected} rechazadas · ${remaining} pendientes`);
        if (result.processed === 0) break;
      }

      setStatus(`✅ Validación completa — ✅ ${totalValid} válidas · ⚠️ ${totalNeeds} revisar · ❌ ${totalRejected} rechazadas`);
      await load();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setValidating(false);
    }
  }

  async function handleConfirmTopic(topicId: number, confirmed: boolean) {
    await fetch(`${BASE}/exams/${examCode}/syllabus/${topicId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed }),
    });
    await load();
  }

  const coveragePct = data
    ? Math.round((data.mapped_questions / Math.max(data.total_questions, 1)) * 100)
    : 0;

  const allConfirmed = data?.topics.length ? data.topics.every(t => t.confirmed) : false;

  return (
    <div style={{ padding: "1rem 0" }}>
      {/* Metadata panel */}
      <div style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, padding: "0.9rem 1.1rem", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: editingMeta ? "0.75rem" : 0 }}>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontWeight: "bold", fontSize: "0.95rem" }}>{meta?.exam_name || <em style={{ color: "#666" }}>Sin nombre</em>}</span>
            {meta?.vendor && <span style={{ fontSize: "0.85rem", color: "#888" }}>🏢 {meta.vendor}</span>}
            {meta?.domain && <span style={{ fontSize: "0.85rem", color: "#888" }}>📂 {meta.domain}</span>}
            {meta?.version && <span style={{ fontSize: "0.85rem", color: "#888" }}>v{meta.version}</span>}
            {!meta?.vendor && !meta?.exam_name && (
              <span style={{ fontSize: "0.85rem", color: "#f44336" }}>⚠️ Metadata requerida para investigar syllabus</span>
            )}
          </div>
          <button onClick={() => setEditingMeta(e => !e)} style={{ fontSize: "0.8rem", padding: "0.25rem 0.7rem" }}>
            {editingMeta ? "✕ Cancelar" : "✏️ Editar"}
          </button>
        </div>
        {editingMeta && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            {([
              ["exam_name", "Nombre del examen", "ej. Scrum Master Certified (SMC)"],
              ["vendor", "Vendor / Organización", "ej. SCRUMstudy, Microsoft"],
              ["domain", "Dominio", "ej. Agile/Scrum, Cloud Computing"],
              ["version", "Versión", "ej. V5, 2024"],
            ] as [keyof typeof metaForm, string, string][]).map(([key, label, placeholder]) => (
              <div key={key}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#aaa", marginBottom: "0.25rem" }}>{label}</label>
                <input
                  value={metaForm[key]}
                  onChange={e => setMetaForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  style={{ width: "100%", boxSizing: "border-box", padding: "0.4rem 0.6rem", background: "#111", border: "1px solid #444", color: "#fff", borderRadius: 6, fontSize: "0.87rem" }}
                />
              </div>
            ))}
            <div style={{ gridColumn: "span 2" }}>
              <button onClick={handleSaveMeta} style={{ padding: "0.4rem 1rem" }}>💾 Guardar metadata</button>
            </div>
          </div>
        )}
      </div>

      {/* Header actions */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.25rem", alignItems: "center" }}>
        <button onClick={handleResearch} disabled={researching || mapping}>
          {researching ? "Investigando..." : "🔍 Investigar syllabus"}
        </button>
        {data && data.topics.length > 0 && !allConfirmed && (
          <button onClick={handleConfirmAll} disabled={researching || mapping}>
            ✅ Confirmar todos
          </button>
        )}
        {data && data.topics.length > 0 && allConfirmed && data.unmapped_questions > 0 && (
          <button onClick={handleMapQuestions} disabled={mapping || researching || validating}>
            {mapping ? "Mapeando..." : `🔗 Mapear ${data.unmapped_questions} preguntas`}
          </button>
        )}
        {data && data.unmapped_questions === 0 && data.topics.length > 0 && (valStats?.pending ?? 0) > 0 && (
          <button onClick={handleValidate} disabled={validating || mapping || researching}
            style={{ background: "#1a3a1a", borderColor: "#2a6a2a" }}>
            {validating ? "Validando..." : `🔎 Validar ${valStats?.pending} preguntas`}
          </button>
        )}
        {status && (
          <span style={{ color: status.startsWith("✅") ? "#4caf50" : status.startsWith("❌") ? "#f44336" : "#aaa", fontSize: "0.9rem" }}>
            {status}
          </span>
        )}
      </div>

      {/* Coverage summary */}
      {data && data.topics.length > 0 && (
        <div style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ fontWeight: "bold" }}>Cobertura del syllabus</span>
            <span style={{ color: coveragePct === 100 ? "#4caf50" : "#aaa" }}>
              {data.mapped_questions}/{data.total_questions} preguntas ({coveragePct}%)
            </span>
          </div>
          <div style={{ background: "#333", borderRadius: 4, height: 8 }}>
            <div style={{ background: coveragePct === 100 ? "#4caf50" : "#2196f3", width: `${coveragePct}%`, height: "100%", borderRadius: 4, transition: "width 0.3s" }} />
          </div>
          {data.unmapped_questions > 0 && (
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem", color: "#f44336" }}>
              ⚠️ {data.unmapped_questions} preguntas sin tópico asignado
            </p>
          )}
        </div>
      )}

      {/* Validation stats */}
      {valStats && valStats.total > 0 && (valStats.valid + valStats.needs_review + valStats.rejected) > 0 && (
        <div style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.6rem" }}>
            <span style={{ fontWeight: "bold" }}>Validación de calidad</span>
            <span style={{ color: "#aaa", fontSize: "0.9rem" }}>{valStats.validated_pct}% validado</span>
          </div>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {[
              { label: "✅ Válidas", count: valStats.valid, color: "#4caf50" },
              { label: "⚠️ Revisar", count: valStats.needs_review, color: "#ff9800" },
              { label: "❌ Rechazadas", count: valStats.rejected, color: "#f44336" },
              { label: "⏳ Pendientes", count: valStats.pending, color: "#666" },
            ].map(({ label, count, color }) => (
              <div key={label} style={{ textAlign: "center", minWidth: 80 }}>
                <div style={{ fontSize: "1.4rem", fontWeight: "bold", color }}>{count}</div>
                <div style={{ fontSize: "0.78rem", color: "#888" }}>{label}</div>
              </div>
            ))}
          </div>
          {valStats.valid_pct > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ background: "#333", borderRadius: 4, height: 8, display: "flex", overflow: "hidden" }}>
                <div style={{ background: "#4caf50", width: `${valStats.valid_pct}%`, transition: "width 0.3s" }} />
                <div style={{ background: "#ff9800", width: `${Math.round(valStats.needs_review / valStats.total * 100)}%`, transition: "width 0.3s" }} />
                <div style={{ background: "#f44336", width: `${Math.round(valStats.rejected / valStats.total * 100)}%`, transition: "width 0.3s" }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Topics list */}
      {loading ? (
        <p style={{ color: "#888" }}>Cargando...</p>
      ) : !data || data.topics.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#666" }}>
          <p style={{ fontSize: "1.1rem" }}>No hay syllabus definido</p>
          <p style={{ fontSize: "0.9rem" }}>Haz clic en <strong>"🔍 Investigar syllabus"</strong> para que el LLM busque el syllabus oficial de este examen.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {data.topics.map(t => (
            <div
              key={t.id}
              style={{
                border: `1px solid ${t.confirmed ? "#2a4a2a" : "#3a3a2a"}`,
                borderRadius: 8,
                padding: "0.9rem 1.1rem",
                background: t.confirmed ? "#0d1f0d" : "#1a1a0d",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
                    <span style={{ fontWeight: "bold", fontSize: "1rem" }}>{t.topic_name}</span>
                    <span style={{ fontSize: "0.75rem", color: "#888", background: "#222", padding: "2px 8px", borderRadius: 10 }}>
                      {t.weight_pct}%
                    </span>
                    {t.confirmed
                      ? <span style={{ fontSize: "0.75rem", color: "#4caf50" }}>✅ confirmado</span>
                      : <span style={{ fontSize: "0.75rem", color: "#ff9800" }}>⏳ pendiente</span>
                    }
                    <span style={{ fontSize: "0.75rem", color: t.source === "llm" ? "#64b5f6" : "#aaa" }}>
                      {t.source === "llm" ? "🤖 LLM" : "✋ manual"}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.87rem", color: "#aaa", lineHeight: 1.5 }}>{t.description}</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.4rem", marginLeft: "1rem" }}>
                  <span style={{ fontSize: "0.85rem", color: t.questions_mapped > 0 ? "#4caf50" : "#666" }}>
                    {t.questions_mapped} preguntas
                  </span>
                  {!t.confirmed && (
                    <button
                      onClick={() => handleConfirmTopic(t.id, true)}
                      style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                    >
                      Confirmar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
