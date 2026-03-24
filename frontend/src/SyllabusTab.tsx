import { useState, useEffect } from "react";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

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

interface Props {
  examCode: string;
}

export default function SyllabusTab({ examCode }: Props) {
  const [data, setData] = useState<SyllabusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [researching, setResearching] = useState(false);
  const [mapping, setMapping] = useState(false);

  async function load() {
    try {
      const res = await fetch(`${BASE}/exams/${examCode}/syllabus`);
      if (res.ok) setData(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [examCode]);

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
      let offset = 0;

      while (remaining > 0) {
        const res = await fetch(
          `${BASE}/exams/${examCode}/syllabus/map-questions?limit=20&offset=${offset}`,
          { method: "POST" }
        );
        const result = await res.json();
        if (!res.ok) throw new Error(result.detail || "Error");
        totalMapped += result.mapped;
        remaining = result.total_unmapped_remaining;
        offset += 20;
        setStatus(`🔗 Mapeando... ${totalMapped} preguntas asignadas, ${remaining} restantes`);
        if (result.processed === 0) break;
      }

      setStatus(`✅ Mapeo completado: ${totalMapped} preguntas asignadas a tópicos.`);
      await load();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setMapping(false);
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
          <button onClick={handleMapQuestions} disabled={mapping || researching}>
            {mapping ? "Mapeando..." : `🔗 Mapear ${data.unmapped_questions} preguntas`}
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
