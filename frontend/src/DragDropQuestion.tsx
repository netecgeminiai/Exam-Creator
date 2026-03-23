/**
 * DragDropQuestion — Visual drag-and-drop for exam simulator.
 *
 * correct_answers format: ["TargetLabel: OptionKey", ...]
 * e.g. ["Automatic bibliography: A", "Slide layout: C"]
 *
 * On submit: compare user's drop assignments to correct keys.
 */
import { useState } from "react";

interface Option { key: string; text: string; }

interface Props {
  stem?: string;  // unused — stem is rendered by parent ExamSimulator
  options: Option[];
  correctAnswers: string[];   // ["Feature X: A", "Feature Y: C", ...]
  submitted: boolean;
  onAnswer: (correct: boolean) => void;
}

function parseTargets(correctAnswers: string[]) {
  return correctAnswers.map(ca => {
    const idx = ca.lastIndexOf(":");
    return {
      label: ca.slice(0, idx).trim(),
      correctKey: ca.slice(idx + 1).trim(),
    };
  });
}

export default function DragDropQuestion({ options, correctAnswers, submitted, onAnswer }: Props) {
  const targets = parseTargets(correctAnswers);

  const [assignments, setAssignments] = useState<Record<string, string>>(
    () => Object.fromEntries(targets.map(t => [t.label, ""]))
  );
  // For click-to-place fallback
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // ── Drag handlers — use dataTransfer so drop always gets the key ──
  const onDragStart = (e: React.DragEvent, key: string) => {
    e.dataTransfer.setData("text/plain", key);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e: React.DragEvent, label: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(label);
  };

  const onDragLeave = () => setDragOver(null);

  const onDrop = (e: React.DragEvent, label: string) => {
    e.preventDefault();
    setDragOver(null);
    if (answered || submitted) return;
    const key = e.dataTransfer.getData("text/plain");
    if (!key) return;
    setAssignments(prev => ({ ...prev, [label]: key }));
    setSelectedKey(null);
  };

  // ── Click-to-place fallback ──
  const onChipClick = (key: string) => {
    if (answered || submitted) return;
    setSelectedKey(prev => prev === key ? null : key);
  };

  const onTargetClick = (label: string) => {
    if (answered || submitted) return;
    if (!selectedKey) return;
    setAssignments(prev => ({ ...prev, [label]: selectedKey }));
    setSelectedKey(null);
  };

  const handleRemove = (e: React.MouseEvent, label: string) => {
    e.stopPropagation();
    if (answered || submitted) return;
    setAssignments(prev => ({ ...prev, [label]: "" }));
  };

  const allFilled = targets.every(t => assignments[t.label]);

  const handleVerify = () => {
    const correct = targets.every(t => assignments[t.label] === t.correctKey);
    setIsCorrect(correct);
    setAnswered(true);
    onAnswer(correct);
  };

  const slotColor = (label: string) => {
    if (!answered) return "";
    const target = targets.find(t => t.label === label);
    if (!target) return "";
    return assignments[label] === target.correctKey ? "dd-chip correct" : "dd-chip wrong";
  };

  return (
    <div className="dd-container">
      {/* Chips bank */}
      <div className="dd-bank">
        <div className="dd-bank-label">🟦 Arrastra o haz clic para seleccionar:</div>
        <div className="dd-chips">
          {options.map(opt => (
            <div
              key={opt.key}
              className={`dd-chip ${selectedKey === opt.key ? "selected" : ""}`}
              draggable={!answered && !submitted}
              onDragStart={e => onDragStart(e, opt.key)}
              onClick={() => onChipClick(opt.key)}
              title="Arrastra al destino, o haz clic y luego clic en el destino"
            >
              <span className="dd-chip-key">{opt.key}</span>
              {opt.text}
            </div>
          ))}
        </div>
        {selectedKey && (
          <div className="dd-hint">
            ▶ Seleccionado: <strong>{options.find(o => o.key === selectedKey)?.text}</strong> — ahora haz clic en el destino
          </div>
        )}
      </div>

      {/* Drop zones */}
      <div className="dd-targets">
        <div className="dd-targets-label">🎯 Destinos:</div>
        {targets.map(t => {
          const assignedKey = assignments[t.label];
          const assignedOpt = options.find(o => o.key === assignedKey);
          const isTargetCorrect = answered && assignedKey === t.correctKey;
          const isTargetWrong = answered && assignedKey && assignedKey !== t.correctKey;
          const isHovered = dragOver === t.label;

          return (
            <div
              key={t.label}
              className={`dd-target${isTargetCorrect ? " correct" : ""}${isTargetWrong ? " wrong" : ""}${isHovered ? " drag-hover" : ""}${!answered && !submitted ? " droppable" : ""}`}
              onDragOver={e => onDragOver(e, t.label)}
              onDragLeave={onDragLeave}
              onDrop={e => onDrop(e, t.label)}
              onClick={() => onTargetClick(t.label)}
            >
              <div className="dd-target-label">{t.label}</div>
              <div className="dd-target-slot" style={{ pointerEvents: "none" }}>
                {assignedOpt ? (
                  <div className={`dd-chip placed ${slotColor(t.label)}`}>
                    <span className="dd-chip-key">{assignedOpt.key}</span>
                    {assignedOpt.text}
                  </div>
                ) : (
                  <div className="dd-empty-slot">Soltar aquí</div>
                )}
              </div>
              {/* Remove button — needs pointer-events back */}
              {assignedOpt && !answered && !submitted && (
                <button
                  className="dd-remove-btn"
                  onClick={e => handleRemove(e, t.label)}
                >✕</button>
              )}
              {answered && (
                <div className="dd-correct-hint">
                  Correcto: <strong>{options.find(o => o.key === t.correctKey)?.text ?? t.correctKey}</strong>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!answered && !submitted && (
        <button
          className="btn-verify"
          disabled={!allFilled}
          onClick={handleVerify}
          style={{ marginTop: "1rem" }}
        >
          Verificar
        </button>
      )}

      {answered && (
        <div className={`feedback ${isCorrect ? "correct" : "wrong"}`} style={{ marginTop: "1rem" }}>
          {isCorrect ? "✅ ¡Correcto!" : "❌ Incorrecto — revisa los destinos marcados en rojo"}
        </div>
      )}
    </div>
  );
}
