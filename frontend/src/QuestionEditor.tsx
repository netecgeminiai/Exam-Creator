import { useState, useRef } from "react";
import type { DBQuestion } from "./api";

/**
 * Parse the compact JSON format shared via chat:
 * { n, t, q, a?, e?, items?, targets?, correct?, options? }
 *
 * t: "d"=drag_and_drop, "mc"=multiple_choice, "ms"=multiple_select, "h"=hotspot
 */
function parseCompactJSON(raw: string): {
  stem?: string;
  options?: { key: string; text: string }[];
  correctAnswers?: string[];
  correctAnswer?: string;
  questionType?: string;
  error?: string;
} {
  try {
    const d = JSON.parse(raw);
    const typeMap: Record<string, string> = {
      d: "drag_and_drop", mc: "multiple_choice", ms: "multiple_select", h: "hotspot",
      drag: "drag_and_drop", multiple_choice: "multiple_choice", multiple_select: "multiple_select", hotspot: "hotspot",
    };
    const questionType = typeMap[d.t ?? ""] ?? d.question_type ?? "multiple_choice";
    const stem = d.q ?? d.question ?? d.stem ?? "";

    if (questionType === "drag_and_drop") {
      const items: string[] = d.items ?? [];
      const targets: string[] = d.targets ?? [];
      const correct: string[] = d.correct ?? [];
      const options = items.map((text, i) => ({ key: String.fromCharCode(65 + i), text }));
      const itemToKey: Record<string, string> = {};
      items.forEach((text, i) => { itemToKey[text] = String.fromCharCode(65 + i); });
      const correctAnswers = targets.map((target, i) => {
        const answerText = correct[i] ?? "";
        const key = itemToKey[answerText] ?? answerText;
        return `${target}: ${key}`;
      });
      return { stem, options, correctAnswers, questionType };
    }

    if (questionType === "hotspot") {
      const stmts: string[] = d.statements ?? d.items ?? d.targets ?? [];
      const correct: string[] = d.correct ?? [];
      const options = stmts.map((text, i) => ({ key: `Box ${i + 1}`, text }));
      const correctAnswers = stmts.map((_, i) => `Box ${i + 1}: ${correct[i] ?? "Yes"}`);
      return { stem, options, correctAnswers, questionType };
    }

    // multiple_choice / multiple_select
    const rawOpts = d.options ?? d.items ?? [];
    const options = rawOpts.map((o: any, i: number) => ({
      key: typeof o === "object" ? o.key ?? String.fromCharCode(65 + i) : String.fromCharCode(65 + i),
      text: typeof o === "object" ? o.text ?? o : o,
    }));
    const correct: string[] = d.correct ?? (d.answer ? [d.answer] : []);
    if (questionType === "multiple_select") {
      return { stem, options, correctAnswers: correct, questionType };
    }
    return { stem, options, correctAnswer: correct[0] ?? "", questionType };
  } catch (e: any) {
    return { error: `JSON inválido: ${e.message}` };
  }
}

/** Button + textarea modal for pasting compact JSON */
function JSONLoader({ onLoad }: { onLoad: (result: ReturnType<typeof parseCompactJSON>) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  const handle = () => {
    const result = parseCompactJSON(text.trim());
    if (result.error) { setErr(result.error); return; }
    onLoad(result);
    setOpen(false);
    setText("");
    setErr("");
  };

  if (!open) return (
    <button type="button" className="btn-secondary"
      style={{ fontSize: "0.82rem", padding: "0.3rem 0.8rem" }}
      onClick={() => setOpen(true)}>
      📋 Cargar desde JSON
    </button>
  );

  return (
    <div style={{ background: "#0f172a", border: "1px solid #3b82f6", borderRadius: 8, padding: "0.8rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <label style={{ color: "#93c5fd", fontSize: "0.82rem", fontWeight: 600 }}>📋 Pega el JSON aquí:</label>
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setErr(""); }}
        rows={6}
        style={{ background: "#1e293b", border: "1px solid #475569", color: "#e2e8f0", borderRadius: 6, padding: "0.6rem", fontFamily: "monospace", fontSize: "0.82rem", resize: "vertical" }}
        placeholder={'{ "n":34, "t":"d", "q":"Stem...", "items":["A","B"], "targets":["T1","T2"], "correct":["A","B"] }'}
      />
      {err && <span style={{ color: "#f87171", fontSize: "0.82rem" }}>⚠️ {err}</span>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="btn-primary" style={{ fontSize: "0.82rem", padding: "0.35rem 0.9rem" }} onClick={handle}>
          ✅ Cargar
        </button>
        <button type="button" className="btn-secondary" style={{ fontSize: "0.82rem", padding: "0.35rem 0.9rem" }} onClick={() => { setOpen(false); setErr(""); setText(""); }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── Rich Stem Editor ─────────────────────────────────────────────────────────
// Stores text with __underline__ markers. Preview renders them as <u>.
function renderStem(text: string) {
  const parts = text.split(/(__[^_]+__)/g);
  return parts.map((part, i) => {
    if (part.startsWith("__") && part.endsWith("__")) {
      return <u key={i}>{part.slice(2, -2)}</u>;
    }
    return <span key={i}>{part}</span>;
  });
}

function RichStemEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  const wrapSelection = (wrap: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = value.slice(start, end);
    if (!sel) return;
    const newVal = value.slice(0, start) + wrap + sel + wrap + value.slice(end);
    onChange(newVal);
    // restore cursor after state update
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + wrap.length, end + wrap.length);
    }, 0);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ color: "#94a3b8", fontSize: "0.8rem" }}>📝 Enunciado</label>
        <button
          type="button"
          className="fmt-btn"
          title="Subrayar selección (o escribe __texto__)"
          onClick={() => wrapSelection("__")}
        >
          <u>U</u>
        </button>
        <button
          type="button"
          className={`fmt-btn ${preview ? "active" : ""}`}
          onClick={() => setPreview(p => !p)}
          title="Vista previa"
        >
          👁
        </button>
        <span style={{ color: "#475569", fontSize: "0.75rem" }}>
          Selecciona texto y presiona <u>U</u> para subrayar
        </span>
      </div>

      {preview ? (
        <div className="stem-preview">
          {renderStem(value)}
        </div>
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={5}
        />
      )}
    </div>
  );
}

interface Option { key: string; text: string; }

interface Props {
  question: DBQuestion;
  onSave: (patch: Record<string, unknown>) => void;
  onCancel?: () => void;
}

function exportToJSON(patch: Record<string, unknown>, questionNumber?: number) {
  const opts = (patch.english_options as { key: string; text: string }[] | undefined) ?? [];
  const cas = (patch.correct_answers as string[] | undefined) ?? [];

  // Detect type from patch
  const isDrag = cas.length > 0 && cas[0]?.includes(":");
  const isHotspot = cas.length > 0 && (cas[0]?.includes("Yes") || cas[0]?.includes("No"));
  const isMultiSelect = !isDrag && !isHotspot && cas.length > 1;

  let out: Record<string, unknown> = {
    n: questionNumber,
    t: isDrag ? "d" : isHotspot ? "h" : isMultiSelect ? "ms" : "mc",
    q: patch.english_stem,
  };

  if (isDrag) {
    const items = opts.map(o => o.text);
    const targets = cas.map(ca => ca.slice(0, ca.lastIndexOf(":")).trim());
    const keyToText: Record<string, string> = {};
    opts.forEach(o => { keyToText[o.key] = o.text; });
    const correct = cas.map(ca => keyToText[ca.slice(ca.lastIndexOf(":") + 1).trim()] ?? "");
    out = { ...out, items, targets, correct };
  } else if (isHotspot) {
    out = {
      ...out,
      statements: opts.map(o => o.text),
      correct: cas.map(ca => ca.slice(ca.indexOf(":") + 1).trim()),
    };
  } else {
    out = {
      ...out,
      options: opts.map(o => ({ key: o.key, text: o.text })),
      correct: isMultiSelect ? cas : [patch.correct_answer as string ?? ""],
    };
  }

  const json = JSON.stringify(out, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `q${questionNumber ?? "x"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function SaveButtons({ onSave, buildPatch, questionNumber }: {
  onSave: (p: Record<string, unknown>) => void;
  buildPatch: () => Record<string, unknown>;
  questionNumber?: number;
}) {
  return (
    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn-primary" onClick={() => onSave(buildPatch())}>💾 Guardar</button>
      <button className="btn-success" onClick={() => onSave({ ...buildPatch(), review_status: "approved" })}>
        ✅ Guardar y Aprobar
      </button>
      <button className="btn-secondary" onClick={() => onSave({ _cancel: true })}>Cancelar</button>
      <button
        type="button"
        className="btn-secondary"
        style={{ marginLeft: "auto", fontSize: "0.82rem", padding: "0.35rem 0.8rem" }}
        onClick={() => exportToJSON(buildPatch(), questionNumber)}
        title="Exportar pregunta como JSON"
      >
        ⬇️ Exportar JSON
      </button>
    </div>
  );
}

// ─── Drag & Drop Editor ────────────────────────────────────────────────────────
function DragDropEditor({ question, onSave }: Props) {
  // Parse targets from stem (lines that look like "Feature → App" table)
  // Targets are stored as correct_answers array, options are the draggable chips
  const [stem, setStem] = useState(question.english_stem || question.raw_text || "");
  const [options, setOptions] = useState<Option[]>(
    question.english_options?.length
      ? question.english_options
      : [{ key: "A", text: "" }]
  );
  // correct_answers for drag_drop: array of "TargetName: OptionKey" strings
  const [targets, setTargets] = useState<{ label: string; answer: string }[]>(() => {
    const raw = question.correct_answers ?? [];
    if (raw.length > 0 && raw[0].includes(":")) {
      return raw.map(r => {
        const idx = r.indexOf(":");
        return { label: r.slice(0, idx).trim(), answer: r.slice(idx + 1).trim() };
      });
    }
    return [{ label: "", answer: "" }];
  });

  const addOption = () => {
    const nextKey = String.fromCharCode(65 + options.length);
    setOptions([...options, { key: nextKey, text: "" }]);
  };
  const removeOption = (i: number) => {
    const next = options.filter((_, idx) => idx !== i).map((o, idx) => ({
      ...o, key: String.fromCharCode(65 + idx)
    }));
    setOptions(next);
  };
  const updateOption = (i: number, text: string) => {
    const next = [...options];
    next[i] = { ...next[i], text };
    setOptions(next);
  };

  const addTarget = () => setTargets([...targets, { label: "", answer: "" }]);
  const removeTarget = (i: number) => setTargets(targets.filter((_, idx) => idx !== i));
  const updateTarget = (i: number, field: "label" | "answer", val: string) => {
    const next = [...targets];
    next[i] = { ...next[i], [field]: val };
    setTargets(next);
  };

  const buildPatch = () => {
    const correct_answers = targets
      .filter(t => t.label.trim())
      .map(t => `${t.label.trim()}: ${t.answer.trim()}`);
    return {
      english_stem: stem,
      english_options: options.filter(o => o.text.trim()),
      correct_answers,
      review_status: "edited",
    };
  };

  return (
    <div className="edit-area">
      <JSONLoader onLoad={r => {
        if (r.stem) setStem(r.stem);
        if (r.options) setOptions(r.options);
        if (r.correctAnswers) {
          setTargets(r.correctAnswers.map(ca => {
            const sep = ca.lastIndexOf(":");
            return { label: ca.slice(0, sep).trim(), answer: ca.slice(sep + 1).trim() };
          }));
        }
      }} />

      <RichStemEditor value={stem} onChange={setStem} />

      {/* Draggable chips (opciones) */}
      <label style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
        🟦 Opciones arrastrables (chips)
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {options.map((opt, i) => (
          <div key={i} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <span className="drag-chip-label">{opt.key}</span>
            <input
              className="drag-chip-input"
              value={opt.text}
              onChange={e => updateOption(i, e.target.value)}
              placeholder={`Opción ${opt.key}`}
            />
            <button className="btn-icon-remove" onClick={() => removeOption(i)} title="Eliminar">✕</button>
          </div>
        ))}
        <button className="btn-add-item" onClick={addOption}>+ Agregar opción</button>
      </div>

      {/* Drop targets */}
      <label style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
        🎯 Zonas de destino → respuesta correcta
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {targets.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              className="drag-chip-input"
              value={t.label}
              onChange={e => updateTarget(i, "label", e.target.value)}
              placeholder="Feature / Destino"
              style={{ flex: 2 }}
            />
            <span style={{ color: "#64748b" }}>→</span>
            <select
              className="drag-chip-input"
              value={t.answer}
              onChange={e => updateTarget(i, "answer", e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">— elegir —</option>
              {options.filter(o => o.text.trim()).map(o => (
                <option key={o.key} value={o.key}>{o.key}: {o.text}</option>
              ))}
            </select>
            <button className="btn-icon-remove" onClick={() => removeTarget(i)} title="Eliminar">✕</button>
          </div>
        ))}
        <button className="btn-add-item" onClick={addTarget}>+ Agregar destino</button>
      </div>

      <SaveButtons onSave={onSave} buildPatch={buildPatch} questionNumber={question.question_number} />
    </div>
  );
}

// ─── Hotspot / Yes-No Editor ───────────────────────────────────────────────────
function HotspotEditor({ question, onSave }: Props) {
  const [stem, setStem] = useState(question.english_stem || question.raw_text || "");
  const [statements, setStatements] = useState<Option[]>(
    question.english_options?.length
      ? question.english_options
      : [{ key: "Box 1", text: "" }]
  );
  // correct_answers like ["Box 1: Yes", "Box 2: No"]
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const ca of question.correct_answers ?? []) {
      const idx = ca.indexOf(":");
      if (idx !== -1) map[ca.slice(0, idx).trim()] = ca.slice(idx + 1).trim();
    }
    return map;
  });

  const loadFromJSON = (r: ReturnType<typeof parseCompactJSON>) => {
    if (r.stem) setStem(r.stem);
    if (r.options) setStatements(r.options);
    if (r.correctAnswers) {
      const map: Record<string, string> = {};
      for (const ca of r.correctAnswers) {
        const idx = ca.indexOf(":");
        if (idx !== -1) map[ca.slice(0, idx).trim()] = ca.slice(idx + 1).trim();
      }
      setAnswers(map);
    }
  };

  const addStatement = () => {
    const next = statements.length + 1;
    setStatements([...statements, { key: `Box ${next}`, text: "" }]);
  };
  const removeStatement = (i: number) => {
    const removed = statements[i].key;
    const next = statements.filter((_, idx) => idx !== i).map((s, idx) => ({
      ...s, key: `Box ${idx + 1}`
    }));
    setStatements(next);
    setAnswers(prev => {
      const copy = { ...prev };
      delete copy[removed];
      return copy;
    });
  };
  const updateStatement = (i: number, text: string) => {
    const next = [...statements];
    next[i] = { ...next[i], text };
    setStatements(next);
  };
  const setAnswer = (key: string, val: string) => {
    setAnswers(prev => ({ ...prev, [key]: val }));
  };

  const buildPatch = () => {
    const correct_answers = statements.map(s => `${s.key}: ${answers[s.key] ?? "Yes"}`);
    return {
      english_stem: stem,
      english_options: statements,
      correct_answers,
      review_status: "edited",
    };
  };

  return (
    <div className="edit-area">
      <JSONLoader onLoad={loadFromJSON} />
      <RichStemEditor value={stem} onChange={setStem} />

      <label style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
        ✅ Afirmaciones — Yes / No
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {statements.map((s, i) => (
          <div key={i} className="hotspot-edit-row">
            <span className="drag-chip-label" style={{ minWidth: 52 }}>{s.key}</span>
            <input
              className="drag-chip-input"
              value={s.text}
              onChange={e => updateStatement(i, e.target.value)}
              placeholder="Afirmación..."
              style={{ flex: 3 }}
            />
            <div className="yn-toggle">
              <button
                className={answers[s.key] === "Yes" || !answers[s.key] ? "yn-btn yn-yes active" : "yn-btn yn-yes"}
                onClick={() => setAnswer(s.key, "Yes")}
              >Yes</button>
              <button
                className={answers[s.key] === "No" ? "yn-btn yn-no active" : "yn-btn yn-no"}
                onClick={() => setAnswer(s.key, "No")}
              >No</button>
            </div>
            <button className="btn-icon-remove" onClick={() => removeStatement(i)}>✕</button>
          </div>
        ))}
        <button className="btn-add-item" onClick={addStatement}>+ Agregar afirmación</button>
      </div>

      <SaveButtons onSave={onSave} buildPatch={buildPatch} questionNumber={question.question_number} />
    </div>
  );
}

// ─── Standard Multiple Choice Editor ──────────────────────────────────────────
function MultipleChoiceEditor({ question, onSave }: Props) {
  const [stem, setStem] = useState(question.english_stem || question.raw_text || "");
  const [options, setOptions] = useState<Option[]>(
    question.english_options?.length
      ? question.english_options
      : [{ key: "A", text: "" }]
  );
  const isMultiSelect = question.question_type === "multiple_select";
  const [selected, setSelected] = useState<string[]>(
    question.correct_answers?.length
      ? question.correct_answers
      : question.correct_answer ? [question.correct_answer] : []
  );

  const addOption = () => {
    const nextKey = String.fromCharCode(65 + options.length);
    setOptions([...options, { key: nextKey, text: "" }]);
  };
  const removeOption = (i: number) => {
    const removed = options[i].key;
    const next = options.filter((_, idx) => idx !== i).map((o, idx) => ({
      ...o, key: String.fromCharCode(65 + idx)
    }));
    setOptions(next);
    setSelected(prev => prev.filter(k => k !== removed));
  };
  const updateOption = (i: number, text: string) => {
    const next = [...options];
    next[i] = { ...next[i], text };
    setOptions(next);
  };
  const toggleAnswer = (key: string) => {
    if (isMultiSelect) {
      setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    } else {
      setSelected([key]);
    }
  };

  const buildPatch = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {
      english_stem: stem,
      english_options: options.filter(o => o.text.trim()),
      review_status: "edited",
    };
    if (isMultiSelect) {
      patch.correct_answers = selected;
    } else {
      patch.correct_answer = selected[0] ?? "";
    }
    return patch;
  };

  return (
    <div className="edit-area">
      <JSONLoader onLoad={r => {
        if (r.stem) setStem(r.stem);
        if (r.options) setOptions(r.options);
        if (r.correctAnswers?.length) setSelected(r.correctAnswers);
        else if (r.correctAnswer) setSelected([r.correctAnswer]);
      }} />
      <RichStemEditor value={stem} onChange={setStem} />

      <label style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
        {isMultiSelect ? "✅ Opciones (selecciona las correctas — varias)" : "🔘 Opciones (selecciona la correcta)"}
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {options.map((opt, i) => (
          <div key={i} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <button
              className={selected.includes(opt.key) ? "opt-select-btn correct" : "opt-select-btn"}
              onClick={() => toggleAnswer(opt.key)}
              title={selected.includes(opt.key) ? "Correcta" : "Marcar como correcta"}
            >
              {opt.key}
            </button>
            <input
              className="drag-chip-input"
              value={opt.text}
              onChange={e => updateOption(i, e.target.value)}
              placeholder={`Opción ${opt.key}`}
            />
            <button className="btn-icon-remove" onClick={() => removeOption(i)}>✕</button>
          </div>
        ))}
        <button className="btn-add-item" onClick={addOption}>+ Agregar opción</button>
      </div>

      <SaveButtons onSave={onSave} buildPatch={buildPatch} questionNumber={question.question_number} />
    </div>
  );
}

// ─── Spanish Translation Editor ───────────────────────────────────────────────
function SpanishEditor({ question, onSave }: Props) {
  const t = (question as any).translation ?? {};
  const [stem, setStem] = useState<string>(t.spanish_stem ?? "");
  const [explanation, setExplanation] = useState<string>(t.spanish_explanation ?? "");
  const [options, setOptions] = useState<Option[]>(
    t.spanish_options?.length
      ? t.spanish_options
      : question.english_options?.map((o: Option) => ({ key: o.key, text: "" })) ?? []
  );

  const updateOption = (i: number, text: string) => {
    const next = [...options];
    next[i] = { ...next[i], text };
    setOptions(next);
  };

  const buildPatch = () => ({
    spanish_stem: stem,
    spanish_options: options,
    spanish_explanation: explanation,
  });

  return (
    <div className="edit-area">
      <RichStemEditor value={stem} onChange={setStem} />

      <label style={{ color: "#94a3b8", fontSize: "0.8rem" }}>🌐 Opciones en español</label>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {options.map((opt, i) => (
          <div key={i} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <span className="drag-chip-label">{opt.key}</span>
            <input
              className="drag-chip-input"
              value={opt.text}
              onChange={e => updateOption(i, e.target.value)}
              placeholder={`Opción ${opt.key} en español`}
            />
          </div>
        ))}
      </div>

      <label style={{ color: "#94a3b8", fontSize: "0.8rem" }}>💡 Explicación en español</label>
      <textarea
        value={explanation}
        onChange={e => setExplanation(e.target.value)}
        rows={5}
        style={{ background: "#1e293b", border: "1px solid #475569", color: "#e2e8f0",
          borderRadius: 6, padding: "0.6rem", fontSize: "0.9rem", resize: "vertical", width: "100%" }}
        placeholder="Explicación de la respuesta correcta..."
      />

      <SaveButtons onSave={onSave} buildPatch={buildPatch} questionNumber={question.question_number} />
    </div>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────
const QUESTION_TYPES = [
  { value: "multiple_choice",  label: "Multiple Choice" },
  { value: "multiple_select",  label: "Multiple Select" },
  { value: "drag_and_drop",    label: "Drag and Drop" },
  { value: "hotspot",          label: "Hotspot / Yes-No" },
  { value: "dropdown",         label: "Dropdown" },
];

export default function QuestionEditor(props: Props) {
  const [activeType, setActiveType] = useState(props.question.question_type);
  const [lang, setLang] = useState<"en" | "es">("en");

  // Wrap onSave to always inject the current question_type
  const wrappedOnSave = (patch: Record<string, unknown>) => {
    if (patch._cancel) { props.onSave(patch); return; }
    props.onSave({ ...patch, question_type: activeType });
  };

  // Build a "virtual" question with the overridden type for the sub-editor
  const virtualQuestion: DBQuestion = { ...props.question, question_type: activeType };
  const subProps: Props = { ...props, question: virtualQuestion, onSave: wrappedOnSave };

  return (
    <div className="edit-area" style={{ gap: "0.75rem" }}>

      {/* Language tabs */}
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button
          type="button"
          onClick={() => setLang("en")}
          style={{
            padding: "0.3rem 1rem", borderRadius: "6px 6px 0 0", border: "1px solid",
            fontSize: "0.85rem", cursor: "pointer",
            background: lang === "en" ? "#1e293b" : "#0f172a",
            borderColor: lang === "en" ? "#3b82f6" : "#334155",
            color: lang === "en" ? "#e2e8f0" : "#64748b",
            fontWeight: lang === "en" ? 700 : 400,
          }}
        >🇺🇸 Inglés</button>
        <button
          type="button"
          onClick={() => setLang("es")}
          style={{
            padding: "0.3rem 1rem", borderRadius: "6px 6px 0 0", border: "1px solid",
            fontSize: "0.85rem", cursor: "pointer",
            background: lang === "es" ? "#1e293b" : "#0f172a",
            borderColor: lang === "es" ? "#3b82f6" : "#334155",
            color: lang === "es" ? "#e2e8f0" : "#64748b",
            fontWeight: lang === "es" ? 700 : 400,
          }}
        >🇲🇽 Español</button>
      </div>

      {lang === "en" && (
        <>
          {/* Type selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap",
            background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 0.8rem" }}>
            <span style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 600 }}>🏷️ Tipo de pregunta:</span>
            {QUESTION_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setActiveType(t.value)}
                style={{
                  padding: "0.25rem 0.7rem", borderRadius: 6, border: "1px solid",
                  fontSize: "0.82rem", cursor: "pointer",
                  background: activeType === t.value ? "#3b82f6" : "#1e293b",
                  borderColor: activeType === t.value ? "#3b82f6" : "#475569",
                  color: activeType === t.value ? "#fff" : "#94a3b8",
                  fontWeight: activeType === t.value ? 700 : 400,
                }}
              >{t.label}</button>
            ))}
            {activeType !== props.question.question_type && (
              <span style={{ color: "#fbbf24", fontSize: "0.8rem" }}>
                ⚠️ Cambiando de <em>{props.question.question_type}</em> → <em>{activeType}</em>
              </span>
            )}
          </div>

          {activeType === "drag_and_drop" && <DragDropEditor {...subProps} />}
          {activeType === "hotspot"       && <HotspotEditor {...subProps} />}
          {(activeType === "multiple_choice" || activeType === "multiple_select" || activeType === "dropdown") &&
            <MultipleChoiceEditor {...subProps} />}
        </>
      )}

      {lang === "es" && <SpanishEditor {...subProps} />}
    </div>
  );
}
