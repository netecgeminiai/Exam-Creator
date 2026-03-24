import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { listExams, uploadAndImportPDF, type ExamSummary } from "../api";

export default function ExamSelectorPage() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [examCodeInput, setExamCodeInput] = useState("");
  const [examName, setExamName] = useState("");
  const [vendor, setVendor] = useState("");
  const [domain, setDomain] = useState("");
  const [version, setVersion] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const data = await listExams();
      setExams(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    const code = examCodeInput.trim().toUpperCase();
    if (!file) return setUploadMsg("Selecciona un archivo PDF.");
    if (!code) return setUploadMsg("Escribe el código del examen (ej. AZ-900).");

    setUploading(true);
    setUploadMsg("Subiendo y procesando PDF...");
    try {
      const result = await uploadAndImportPDF(code, file, {
        exam_name: examName || undefined,
        vendor: vendor || undefined,
        domain: domain || undefined,
        version: version || undefined,
      });
      setUploadMsg(`✅ ${result.message}`);
      setExamCodeInput(""); setExamName(""); setVendor(""); setDomain(""); setVersion("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e: any) {
      setUploadMsg(`❌ Error: ${e.message}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 1rem" }}>
      <h1 style={{ marginBottom: "0.25rem" }}>📋 Exam Translator</h1>
      <p style={{ color: "#888", marginBottom: "2rem" }}>Selecciona un examen para administrar o importa uno nuevo.</p>

      {/* Exams list */}
      {loading ? (
        <p>Cargando exámenes...</p>
      ) : exams.length === 0 ? (
        <p style={{ color: "#888" }}>No hay exámenes importados aún. Importa uno abajo.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "2.5rem" }}>
          {exams.map(e => (
            <div
              key={e.exam_code}
              style={{
                border: "1px solid #333",
                borderRadius: 8,
                padding: "1rem 1.25rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#1a1a1a",
              }}
            >
              <div>
                <strong style={{ fontSize: "1.1rem" }}>{e.exam_code}</strong>
                <span style={{ color: "#888", marginLeft: "1rem", fontSize: "0.9rem" }}>
                  {e.total} preguntas · {e.translated} traducidas
                </span>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => navigate(`/simulator?exam=${e.exam_code}&mode=es`)}
                  style={{ padding: "0.4rem 0.9rem", cursor: "pointer" }}
                >
                  🎓 Simular
                </button>
                <button
                  onClick={() => navigate(`/admin?exam=${e.exam_code}`)}
                  style={{ padding: "0.4rem 0.9rem", cursor: "pointer" }}
                >
                  🛠️ Admin
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload new exam */}
      <div style={{ border: "1px solid #333", borderRadius: 8, padding: "1.5rem", background: "#1a1a1a" }}>
        <h3 style={{ marginTop: 0 }}>📥 Importar nuevo examen</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            {[
              { label: "Código *", val: examCodeInput, set: (v: string) => setExamCodeInput(v.toUpperCase()), placeholder: "ej. SCRUM-MASTER", required: true },
              { label: "Nombre del examen", val: examName, set: setExamName, placeholder: "ej. Scrum Master Certified (SMC)" },
              { label: "Vendor / Organización", val: vendor, set: setVendor, placeholder: "ej. SCRUMstudy, Microsoft, PMI" },
              { label: "Dominio", val: domain, set: setDomain, placeholder: "ej. Agile/Scrum, Cloud Computing" },
              { label: "Versión", val: version, set: setVersion, placeholder: "ej. V5, 2024" },
            ].map(({ label, val, set, placeholder, required }) => (
              <div key={label}>
                <label style={{ display: "block", marginBottom: "0.3rem", fontSize: "0.85rem", color: "#aaa" }}>{label}</label>
                <input
                  type="text"
                  placeholder={placeholder}
                  value={val}
                  onChange={e => set(e.target.value)}
                  style={{ padding: "0.45rem 0.7rem", borderRadius: 6, border: `1px solid ${required ? "#666" : "#333"}`, background: "#111", color: "#fff", width: "100%", fontSize: "0.95rem", boxSizing: "border-box" }}
                />
              </div>
            ))}
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.9rem", color: "#aaa" }}>
              Archivo PDF *
            </label>
            <input ref={fileRef} type="file" accept=".pdf" />
          </div>
          <div>
            <button
              onClick={handleUpload}
              disabled={uploading}
              style={{ padding: "0.5rem 1.25rem", cursor: uploading ? "not-allowed" : "pointer" }}
            >
              {uploading ? "Procesando..." : "📤 Subir e importar"}
            </button>
          </div>
          {uploadMsg && (
            <p style={{ margin: 0, color: uploadMsg.startsWith("✅") ? "#4caf50" : uploadMsg.startsWith("❌") ? "#f44336" : "#aaa" }}>
              {uploadMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
