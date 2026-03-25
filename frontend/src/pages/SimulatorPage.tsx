import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getDBQuestions, getQuestions, getJob } from "../api";
import type { Question, DBQuestion } from "../api";
import ExamSimulator from "../ExamSimulator";

export default function SimulatorPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get("mode") ?? "es";
  const jobId = searchParams.get("job");

  const [questions, setQuestions] = useState<Question[]>([]);
  const [dbQuestions, setDbQuestions] = useState<DBQuestion[]>([]);
  const [simMode, setSimMode] = useState<"legacy" | "translated" | "english">("legacy");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const examCode = searchParams.get("exam") ?? "MS-900";
        if (mode === "es") {
          const data = await getDBQuestions(examCode, true, 500, 0);
          setDbQuestions(data.questions);
          setSimMode("translated");
        } else if (mode === "en") {
          // Try DB questions first (English mode — all approved)
          const data = await getDBQuestions(examCode, false, 500, 0);
          if (data.questions.length > 0) {
            setDbQuestions(data.questions);
            setSimMode("english");
          } else {
            // Fall back to legacy session storage
            const raw = sessionStorage.getItem("sim_questions");
            if (raw) {
              setQuestions(JSON.parse(raw));
              setSimMode("legacy");
            } else {
              navigate("/");
            }
          }
        } else if (mode === "upload" && jobId) {
          // Poll until done
          let job = await getJob(jobId);
          while (job.status !== "done" && job.status !== "error") {
            await new Promise(r => setTimeout(r, 2000));
            job = await getJob(jobId);
          }
          if (job.status === "error") throw new Error(job.error_message ?? "Processing error");
          const qs = await getQuestions(jobId);
          setQuestions(qs);
          setSimMode("legacy");
        } else {
          navigate("/");
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [mode, jobId]);

  const examCode = searchParams.get("exam") ?? "MS-900";

  const handleEditQuestion = (questionNumber: number) => {
    navigate(`/admin/question/${questionNumber}?exam=${examCode}`);
  };

  if (loading) {
    return (
      <div className="processing">
        <div className="spinner" />
        <p>Cargando preguntas...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-panel">
        <h2>⚠️ Error</h2>
        <pre>{error}</pre>
        <button onClick={() => navigate("/")}>Volver al inicio</button>
      </div>
    );
  }

  return (
    <ExamSimulator
      questions={simMode === "legacy" ? questions : []}
      dbQuestions={simMode !== "legacy" ? dbQuestions : []}
      englishMode={simMode === "english"}
      onReset={() => navigate("/")}
      onEditQuestion={handleEditQuestion}
    />
  );
}
