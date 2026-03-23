/**
 * HotspotQuestion — handles two formats:
 *
 * FORMAT A (classic Yes/No table):
 *   correctAnswers: ["Box 1: Yes", "Box 2: No", ...]
 *   options: [{ key: "Box 1", text: "Statement..." }, ...]
 *
 * FORMAT B (select-all-that-apply, plain letter answers):
 *   correctAnswers: ["A", "B", "C", "D"]
 *   options: [{ key: "A", text: "Retire" }, ...]
 */
import { useState } from "react";

interface Option { key: string; text: string; }

interface Props {
  stem: string;
  options: Option[];
  correctAnswers: string[];
  submitted: boolean;
  onAnswer: (correct: boolean) => void;
}

function isPlainLetters(correctAnswers: string[]): boolean {
  return correctAnswers.length > 0 && correctAnswers.every(ca => /^[A-F]$/.test(ca.trim()));
}

function parseYesNoCorrect(correctAnswers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const ca of correctAnswers) {
    const idx = ca.lastIndexOf(":");
    if (idx !== -1) map[ca.slice(0, idx).trim()] = ca.slice(idx + 1).trim(); // "Yes" or "No"
  }
  return map;
}

// ── FORMAT B: select-all-that-apply ─────────────────────────────────────────
function SelectAllHotspot({ options, correctAnswers, onAnswer }: {
  options: Option[];
  correctAnswers: string[];
  onAnswer: (correct: boolean) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const toggle = (key: string) => {
    if (answered) return;
    setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleVerify = () => {
    const correct = [...correctAnswers].sort().join(",") === [...selected].sort().join(",");
    setIsCorrect(correct);
    setAnswered(true);
    onAnswer(correct);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {options.map(opt => {
        const isSel = selected.includes(opt.key);
        const isRight = correctAnswers.includes(opt.key);
        let cls = "option";
        if (answered && isRight) cls += " correct";
        if (answered && isSel && !isRight) cls += " wrong";
        if (!answered && isSel) cls += " selected";
        return (
          <div key={opt.key} className={cls} onClick={() => toggle(opt.key)}
            style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: answered ? "default" : "pointer" }}>
            <span style={{
              width: 20, height: 20, border: "2px solid currentColor", borderRadius: 4,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "0.8rem"
            }}>
              {isSel ? "✓" : ""}
            </span>
            <strong>{opt.key}.</strong> {opt.text}
          </div>
        );
      })}
      {!answered && (
        <button className="btn-verify" style={{ marginTop: "0.5rem", alignSelf: "flex-start" }}
          onClick={handleVerify} disabled={selected.length === 0}>
          Verificar
        </button>
      )}
      {answered && (
        <div className={`feedback-banner ${isCorrect ? "correct" : "wrong"}`} style={{ marginTop: "0.5rem" }}>
          {isCorrect ? "✅ ¡Correcto!" : `❌ Incorrecto — Correctas: ${correctAnswers.join(", ")}`}
        </div>
      )}
    </div>
  );
}

// ── FORMAT A: Yes/No table ───────────────────────────────────────────────────
export default function HotspotQuestion({ options, correctAnswers, submitted, onAnswer }: Props) {

  // Delegate to SelectAll if format B
  if (isPlainLetters(correctAnswers)) {
    return (
      <div className="hotspot-container">
        <SelectAllHotspot options={options} correctAnswers={correctAnswers} onAnswer={onAnswer} />
      </div>
    );
  }

  const correctMap = parseYesNoCorrect(correctAnswers);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const toggle = (key: string, val: string) => {
    if (answered || submitted) return;
    setAnswers(prev => ({ ...prev, [key]: val }));
  };

  const allAnswered = options.every(o => answers[o.key]);

  const handleVerify = () => {
    const correct = options.every(o => answers[o.key] === correctMap[o.key]);
    setIsCorrect(correct);
    setAnswered(true);
    onAnswer(correct);
  };

  return (
    <div className="hotspot-container">
      <table className="hotspot-sim-table">
        <thead>
          <tr>
            <th>Afirmación</th>
            <th style={{ width: 80, textAlign: "center" }}>Sí</th>
            <th style={{ width: 80, textAlign: "center" }}>No</th>
          </tr>
        </thead>
        <tbody>
          {options.map(opt => {
            const userAns = answers[opt.key];
            const correctAns = correctMap[opt.key];
            const isRowCorrect = answered && userAns === correctAns;
            const isRowWrong = answered && userAns && userAns !== correctAns;

            return (
              <tr key={opt.key} className={isRowCorrect ? "row-correct" : isRowWrong ? "row-wrong" : ""}>
                <td className="hotspot-stmt">
                  {opt.text}
                  {answered && correctAns && (
                    <span className="hotspot-correct-ans"> → Correcto: <strong>{correctAns === "Yes" ? "Sí" : "No"}</strong></span>
                  )}
                </td>
                <td className="hotspot-yn-cell">
                  <button
                    className={`yn-sim-btn yes ${userAns === "Yes" ? "active" : ""}`}
                    onClick={() => toggle(opt.key, "Yes")}
                    disabled={answered || submitted}
                  >Sí</button>
                </td>
                <td className="hotspot-yn-cell">
                  <button
                    className={`yn-sim-btn no ${userAns === "No" ? "active" : ""}`}
                    onClick={() => toggle(opt.key, "No")}
                    disabled={answered || submitted}
                  >No</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!answered && !submitted && (
        <button
          className="btn-verify"
          disabled={!allAnswered}
          onClick={handleVerify}
          style={{ marginTop: "1rem" }}
        >
          Verificar
        </button>
      )}

      {answered && (
        <div className={`feedback-banner ${isCorrect ? "correct" : "wrong"}`} style={{ marginTop: "1rem" }}>
          {isCorrect ? "✅ ¡Correcto!" : "❌ Incorrecto — revisa las filas marcadas en rojo"}
        </div>
      )}
    </div>
  );
}
