import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { uploadPDF, preloadMS900, getRawQuestions } from "../api";

export default function HomePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePreloadES = () => {
    // Translated Spanish simulator
    navigate("/simulator?mode=es");
  };

  const handlePreloadEN = async () => {
    try {
      const job = await preloadMS900();
      const qs = await getRawQuestions(job.job_id, 500);
      // Pass via sessionStorage to avoid giant query strings
      sessionStorage.setItem("sim_questions", JSON.stringify(qs));
      sessionStorage.setItem("sim_mode", "legacy");
      navigate("/simulator?mode=en");
    } catch (e: any) {
      alert("Error cargando MS-900: " + e.message);
    }
  };

  const handleFile = async (file: File) => {
    try {
      const job = await uploadPDF(file);
      sessionStorage.setItem("sim_job_id", job.job_id);
      navigate(`/simulator?mode=upload&job=${job.job_id}`);
    } catch (e: any) {
      alert("Error subiendo PDF: " + e.message);
    }
  };

  return (
    <>
      <header>
        <h1>🧠 Exam Translator</h1>
        <p>Microsoft exam PDF → simulador interactivo en Español</p>
        <button className="btn-admin" onClick={() => navigate("/admin")} title="Panel de administración">
          🛠️ Admin
        </button>
      </header>

      <div className="upload-section">
        <div className="preload-box">
          <h2>📋 MS-900 — Simulador</h2>
          <p>El archivo MS-900.pdf ya está cargado en el servidor.</p>
          <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={handlePreloadEN}>
              🇺🇸 Ver preguntas en inglés
            </button>
            <button className="btn-success" onClick={handlePreloadES}>
              🇲🇽 Simulador en Español (traducidas)
            </button>
          </div>
        </div>

        <div className="divider">— o sube otro PDF —</div>

        <div
          className="upload-area"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => fileInputRef.current?.click()}
        >
          <span>📄 Arrastra un PDF aquí, o haz clic para seleccionar</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>
      </div>
    </>
  );
}
