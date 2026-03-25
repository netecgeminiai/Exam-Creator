const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export type JobStatus = "queued" | "processing" | "done" | "error";

export interface Job {
  job_id: string;
  filename: string;
  status: JobStatus;
  total_questions: number;
  processed_questions: number;
  error_message?: string;
}

export interface AnswerOption {
  key: string;
  text: string;
  text_es?: string;
}

export interface Question {
  question_number: number;
  question_type: string;
  raw_text: string;
  question_text?: string;
  question_text_es?: string;
  options?: AnswerOption[];
  correct_answer?: string;
  correct_answers?: string[];
  num_correct?: number;
  scenario_text?: string;
  scenario_text_es?: string;
  rows?: Array<{ statement: string; statement_es?: string; correct_answer?: string }>;
  items?: Array<{ id: string; text: string; text_es?: string }>;
  targets?: Array<{ id: string; label: string; label_es?: string; correct_item_id?: string }>;
  segments?: Array<{ type: string; text?: string; text_es?: string; dropdown_id?: string }>;
  dropdowns?: Array<{ id: string; options: string[]; options_es?: string[]; correct_option?: string }>;
  translation_status?: string;
  explanation?: string;
  explanation_en?: string;
}

export async function uploadPDF(file: File): Promise<Job> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getQuestions(jobId: string): Promise<Question[]> {
  const res = await fetch(`${BASE}/exams/${jobId}/questions?limit=500`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.questions;
}

export async function preloadMS900(): Promise<Job> {
  const res = await fetch(`${BASE}/preload`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getRawQuestions(jobId: string, limit = 500): Promise<Question[]> {
  const res = await fetch(`${BASE}/exams/${jobId}/raw_questions?limit=${limit}`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.questions;
}

// ── Admin / DB-backed API ──────────────────────────────────────────────────

export interface ImportResult {
  imported: number;
  updated: number;
  exam_code: string;
  message: string;
}

export interface BatchProgress {
  processed: number;
  total: number;
  errors: number;
}

export interface ExamStats {
  exam_code: string;
  total: number;
  by_review_status: {
    pending: number;
    approved: number;
    edited: number;
    skipped: number;
  };
  translated: number;
}

export interface DBQuestion {
  id: number;
  question_number: number;
  question_type: string;
  review_status: string;
  english_stem?: string;
  english_options?: Array<{ key: string; text: string }>;
  correct_answer?: string;
  correct_answers?: string[];
  review_notes: string[];
  raw_text: string;
  validation_status?: string;
  validation_notes?: string[];
  translation?: {
    spanish_stem?: string;
    spanish_options?: Array<{ key: string; text: string }>;
    spanish_correct_answers?: string[];
    spanish_explanation?: string;
    english_explanation?: string;
    translation_status?: string;
    model_used?: string;
  };
}

export async function importExam(examCode: string): Promise<ImportResult> {
  const res = await fetch(`${BASE}/exams/${examCode}/import`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function batchReview(examCode: string, limit = 50, offset = 0): Promise<BatchProgress> {
  const res = await fetch(`${BASE}/exams/${examCode}/batch-review?limit=${limit}&offset=${offset}`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getReviewQuestions(
  examCode: string,
  status?: string,
  limit = 50,
  offset = 0,
  questionNumber?: number,
  questionType?: string,
): Promise<{ total: number; questions: DBQuestion[] }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) params.set("status", status);
  if (questionNumber) params.set("question_number", String(questionNumber));
  if (questionType) params.set("question_type", questionType);
  const res = await fetch(`${BASE}/exams/${examCode}/review?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function patchQuestion(
  examCode: string,
  qId: number,
  patch: Record<string, unknown>
): Promise<any> {
  const res = await fetch(`${BASE}/exams/${examCode}/questions/${qId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function batchTranslate(examCode: string, limit = 50, offset = 0): Promise<BatchProgress> {
  const res = await fetch(`${BASE}/exams/${examCode}/batch-translate?limit=${limit}&offset=${offset}`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function improveExplanations(examCode: string, limit = 50, offset = 0): Promise<BatchProgress> {
  const res = await fetch(`${BASE}/exams/${examCode}/improve-explanations?limit=${limit}&offset=${offset}`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getExamStats(examCode: string): Promise<ExamStats> {
  const res = await fetch(`${BASE}/exams/${examCode}/stats`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface ExamSummary {
  exam_code: string;
  total: number;
  translated: number;
}

export async function listExams(): Promise<ExamSummary[]> {
  const res = await fetch(`${BASE}/exams`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface ExamMetadataPayload {
  exam_name?: string;
  vendor?: string;
  domain?: string;
  version?: string;
}

export async function uploadAndImportPDF(examCode: string, file: File, meta?: ExamMetadataPayload): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  if (meta?.exam_name) form.append("exam_name", meta.exam_name);
  if (meta?.vendor) form.append("vendor", meta.vendor);
  if (meta?.domain) form.append("domain", meta.domain);
  if (meta?.version) form.append("version", meta.version);
  const res = await fetch(`${BASE}/exams/${examCode}/upload-pdf`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateExamMetadata(examCode: string, meta: ExamMetadataPayload): Promise<any> {
  const res = await fetch(`${BASE}/exams/${examCode}/metadata`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getDBQuestions(
  examCode: string,
  translatedOnly = false,
  limit = 50,
  offset = 0
): Promise<{ total: number; questions: DBQuestion[] }> {
  const params = new URLSearchParams({
    translated_only: String(translatedOnly),
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(`${BASE}/exams/${examCode}/questions?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
