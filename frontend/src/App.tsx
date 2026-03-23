import { useState, useEffect, useRef } from "react";
import { uploadPDF, getJob, getQuestions, preloadMS900, getRawQuestions, getDBQuestions } from "./api";
import type { Job, Question, DBQuestion } from "./api";
import ExamSimulator from "./ExamSimulator";
import AdminPanel from "./AdminPanel";
import "./App.css";

type AppState = "upload" | "processing" | "exam" | "admin" | "error";

export default function App() {
  const [state, setState] = useState<AppState>("upload");
  const [job, setJob] = useState<Job | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [dbQuestions, setDbQuestions] = useState<DBQuestion[]>([]);
  const [simMode, setSimMode] = useState<"legacy" | "translated">("legacy");
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    try {
      const newJob = await uploadPDF(file);
      setJob(newJob);
      setState("processing");
    } catch (e: any) {
      setErrorMsg(e.message);
      setState("error");
    }
  };

  const handlePreload = async () => {
    try {
      const newJob = await preloadMS900();
      setJob(newJob);
      const qs = await getRawQuestions(newJob.job_id, 500);
      setQuestions(qs);
      setState("exam");
    } catch (e: any) {
      setErrorMsg(e.message);
      setState("error");
    }
  };

  useEffect(() => {
    if (state !== "processing" || !job) return;
    pollRef.current = setInterval(async () => {
      try {
        const updated = await getJob(job.job_id);
        setJob(updated);
        if (updated.status === "done") {
          clearInterval(pollRef.current!);
          const qs = await getQuestions(updated.job_id);
          setQuestions(qs);
          setState("exam");
        } else if (updated.status === "error") {
          clearInterval(pollRef.current!);
          setErrorMsg(updated.error_message ?? "Unknown error");
          setState("error");
        }
      } catch (e: any) {
        clearInterval(pollRef.current!);
        setErrorMsg(e.message);
        setState("error");
      }
    }, 2000);
    return () => clearInterval(pollRef.current!);
  }, [state, job]);

  const handlePreloadES = async () => {
    try {
      const data = await getDBQuestions("MS-900", true, 500, 0);
      setDbQuestions(data.questions);
      setSimMode("translated");
      setState("exam");
    } catch (e: any) {
      setErrorMsg(e.message);
      setState("error");
    }
  };

  const [editQuestionNumber, setEditQuestionNumber] = useState<number | null>(null);

  const reset = () => {
    setState("upload");
    setJob(null);
    setQuestions([]);
    setDbQuestions([]);
    setSimMode("legacy");
    setErrorMsg("");
    setEditQuestionNumber(null);
  };

  const handleEditQuestion = (questionNumber: number) => {
    setEditQuestionNumber(questionNumber);
    setState("admin");
  };

  const handleBackFromAdmin = async () => {
    setEditQuestionNumber(null);
    // Reload questions to pick up any edits made in the Admin panel
    if (simMode === "translated") {
      try {
        const data = await getDBQuestions("MS-900", true, 500, 0);
        setDbQuestions(data.questions);
      } catch { /* silently ignore, keep old data */ }
    }
    setState("exam");
  };

  if (state === "admin") {
    return <AdminPanel onBack={handleBackFromAdmin} focusQuestion={editQuestionNumber} />;
  }

  return (
    <div className="app">
      <header>
        <h1>🧠 Exam Translator</h1>
        <p>Microsoft exam PDF → simulador interactivo en Español</p>
        <button
          className="btn-admin"
          onClick={() => setState("admin")}
          title="Panel de administración"
        >
          🛠️ Admin
        </button>
      </header>

      {state === "upload" && (
        <div className="upload-section">
          <div className="preload-box">
            <h2>📋 MS-900 — Simulador</h2>
            <p>El archivo MS-900.pdf ya está cargado en el servidor.</p>
            <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
              <button className="btn-primary" onClick={handlePreload}>
                🇺🇸 Ver preguntas en inglés
              </button>
              <button className="btn-success" onClick={handlePreloadES}>
                🇲🇽 Simulador en Español (traducidas)
              </button>
            </div>
          </div>

          <div className="divider">— o sube otro PDF —</div>

          <div className="upload-area"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => fileInputRef.current?.click()}
          >
            <span>📄 Arrastra un PDF aquí, o haz clic para seleccionar</span>
            <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>
        </div>
      )}

      {state === "processing" && job && (
        <div className="processing">
          <div className="spinner" />
          <p><strong>{job.filename}</strong></p>
          <p>Status: <code>{job.status}</code></p>
          {job.total_questions > 0 && (
            <p>Processed {job.processed_questions} / {job.total_questions} questions</p>
          )}
        </div>
      )}

      {state === "exam" && simMode === "translated" && (
        <ExamSimulator questions={[]} dbQuestions={dbQuestions} onReset={reset} onEditQuestion={handleEditQuestion} />
      )}
      {state === "exam" && simMode === "legacy" && (
        <ExamSimulator questions={questions} dbQuestions={[]} onReset={reset} onEditQuestion={handleEditQuestion} />
      )}

      {state === "error" && (
        <div className="error-panel">
          <h2>⚠️ Error</h2>
          <pre>{errorMsg}</pre>
          <button onClick={reset}>Try Again</button>
        </div>
      )}
    </div>
  );
}
