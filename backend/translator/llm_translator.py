"""LLM-based translation and structured extraction of exam questions.

TODO: Configure your LLM provider before use.
  - Set env vars: OPENAI_API_KEY or ANTHROPIC_API_KEY
  - Optionally set OPENAI_BASE_URL for Azure / custom endpoints
  - Set LLM_PROVIDER="openai" (default) or "anthropic"
  - Set LLM_MODEL e.g. "gpt-4o" or "claude-3-5-sonnet-20241022"
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional

from ..models.question import (
    AnyQuestion,
    BaseQuestion,
    MultipleChoiceQuestion,
    MultipleSelectQuestion,
    DragAndDropQuestion,
    HotspotQuestion,
    DropdownQuestion,
    QuestionType,
    AnswerOption,
    HotspotRow,
)
from ..parser.question_splitter import RawQuestion

logger = logging.getLogger(__name__)

# ─── System prompt ────────────────────────────────────────────────────────────

def _exam_context(exam_name: str = "", vendor: str = "", domain: str = "") -> str:
    """Build a context string for LLM prompts based on exam metadata."""
    parts = []
    if vendor:
        parts.append(f"vendor: {vendor}")
    if exam_name:
        parts.append(f"exam: {exam_name}")
    if domain:
        parts.append(f"domain: {domain}")
    if parts:
        return f"({', '.join(parts)})"
    return "(Microsoft certification)"


def build_improve_explanation_prompt(exam_name: str = "", vendor: str = "", domain: str = "") -> str:
    ctx = _exam_context(exam_name, vendor, domain)
    return f"""You are a certification exam expert {ctx}.

Given an exam question with its correct answer(s) and an existing explanation (which may be incomplete, too brief, or inaccurate), your job is to:
1. Write a thorough, accurate English explanation (3-6 sentences) that:
   - Clearly states WHY the correct answer(s) are right
   - Briefly explains why the incorrect options are wrong (when relevant)
   - Uses precise terminology for the {domain or 'subject'} domain
   - Is useful for a student studying for the exam
2. Translate that explanation to Mexico Spanish (español de México).

Return ONLY valid JSON:
{{
  "english_explanation": "improved explanation in English",
  "spanish_explanation": "explicación mejorada en español"
}}
No markdown, no extra fields.
"""


def build_review_only_prompt(exam_name: str = "", vendor: str = "", domain: str = "") -> str:
    ctx = _exam_context(exam_name, vendor, domain)
    return f"""You are a certification exam proofreader {ctx}.
Review this exam question for:
1. OCR errors (garbled text, missing spaces, wrong characters)
2. Terminology accuracy for {domain or 'the subject domain'}
3. Grammar issues

Return JSON:
{{
  "stem": "cleaned question text",
  "options": [{{"key":"A","text":"cleaned option text"}}],
  "correct_answer": "A",
  "correct_answers": ["A","D","E"],
  "explanation": "...",
  "review_notes": ["issue 1", "issue 2"],
  "has_issues": true
}}
Return ONLY JSON, no markdown.
"""


def build_translate_only_prompt(exam_name: str = "", vendor: str = "", domain: str = "") -> str:
    ctx = _exam_context(exam_name, vendor, domain)
    return f"""You are an expert certification exam translator (Mexico Spanish locale) {ctx}.

Given a cleaned English exam question (already proofread), translate ALL text to Spanish.
Use correct terminology for the {domain or 'subject'} domain in Mexico Spanish.

For drag_and_drop questions, correct_answers is an array of "Target label: OptionKey" strings.
Translate ONLY the label part (before the last ": KEY") to Spanish; keep the ": KEY" suffix exactly as-is.

Return JSON:
{{"""


# Legacy single-instance prompts (kept for backward compatibility — used when no metadata available)
IMPROVE_EXPLANATION_PROMPT = build_improve_explanation_prompt("MS-900", "Microsoft", "Microsoft 365 / Cloud")
REVIEW_ONLY_PROMPT = build_review_only_prompt("MS-900", "Microsoft", "Microsoft 365 / Cloud")

_TRANSLATE_ONLY_BASE = """You are an expert Microsoft certification exam translator (Mexico Spanish locale).

Given a cleaned English exam question (already proofread), translate ALL text to Spanish.
Use correct Microsoft terminology (e.g. "suscripción", "inquilino", "nube", "centro de administración").

For drag_and_drop questions, correct_answers is an array of "Target label: OptionKey" strings.
Translate ONLY the label part (before the last ": KEY") to Spanish; keep the ": KEY" suffix exactly as-is.

Return JSON:
{
  "spanish_stem": "traducción del enunciado",
  "spanish_options": [{"key":"A","text":"traducción de la opción"}],
  "spanish_correct_answers": ["etiqueta traducida: A", "otra etiqueta: B"],
  "spanish_explanation": "explicación en español",
  "english_explanation": "brief explanation in English of why the answer is correct"
}
If the question is not drag_and_drop, set "spanish_correct_answers" to [].
Return ONLY JSON, no markdown.
"""

TRANSLATE_ONLY_PROMPT = _TRANSLATE_ONLY_BASE

REVIEW_PROMPT = """You are an expert Microsoft certification exam translator and proofreader (Mexico Spanish locale).

Given raw OCR text of a Microsoft exam question, you must:
1. Identify the question type: multiple_choice | multiple_select | drag_and_drop | hotspot | dropdown
2. Extract and CLEAN the original English text (fix OCR artifacts, spacing issues)
3. Translate ALL text to Spanish (Mexico), using correct Microsoft terminology (e.g. "suscripción", "inquilino", "nube", "centro de administración")
4. Flag any spelling or terminology concerns in a "review_notes" field
5. Return ONLY valid JSON — no markdown, no explanation

Return this structure:
{
  "question_type": "multiple_choice|multiple_select|drag_and_drop|hotspot|dropdown",
  "question_number": <int>,
  "english": {
    "stem": "clean English question text",
    "options": [{"key":"A","text":"..."}],
    "correct_answer": "A",
    "correct_answers": [],
    "explanation": "..."
  },
  "spanish": {
    "stem": "traducción al español",
    "options": [{"key":"A","text":"..."}],
    "explanation": "..."
  },
  "review_notes": ["nota 1", "nota 2"]
}

For hotspot, use:
  "english": {"stem":"...","rows":[{"statement":"...","answer":"Yes/No"}]},
  "spanish": {"stem":"...","rows":[{"statement":"..."}]}

For drag_and_drop, use:
  "english": {"stem":"...","items":["..."],"targets":["..."]},
  "spanish": {"stem":"...","items":["..."],"targets":["..."]}
"""

SYSTEM_PROMPT = """You are an expert Microsoft certification exam translator.
You receive raw OCR text from a Microsoft exam question.
Your job is to:
1. Identify the question type: multiple_choice | multiple_select | drag_and_drop | hotspot | dropdown
2. Extract the structured content (question text, answer options, etc.)
3. Translate ALL text fields to Spanish (Mexico locale)
4. Return ONLY valid JSON matching the schema below — no explanation, no markdown fences.

Schema (select the matching type):

multiple_choice:
{
  "question_type": "multiple_choice",
  "question_text": "...",
  "question_text_es": "...",
  "options": [{"key":"A","text":"...","text_es":"..."},...],
  "correct_answer": "A",
  "explanation": "...",
  "explanation_es": "..."
}

multiple_select:
{
  "question_type": "multiple_select",
  "question_text": "...",
  "question_text_es": "...",
  "options": [{"key":"A","text":"...","text_es":"..."},...],
  "correct_answers": ["A","C"],
  "num_correct": 2,
  "explanation": "...",
  "explanation_es": "..."
}

drag_and_drop:
{
  "question_type": "drag_and_drop",
  "scenario_text": "...",
  "scenario_text_es": "...",
  "instruction": "...",
  "instruction_es": "...",
  "items": [{"id":"1","text":"...","text_es":"..."},...],
  "targets": [{"id":"T1","label":"...","label_es":"...","correct_item_id":"1"},...]
}

hotspot:
{
  "question_type": "hotspot",
  "scenario_text": "...",
  "scenario_text_es": "...",
  "rows": [{"statement":"...","statement_es":"...","correct_answer":"Yes"},...]
}

dropdown:
{
  "question_type": "dropdown",
  "full_sentence_es": "...",
  "segments": [
    {"type":"text","text":"...","text_es":"..."},
    {"type":"dropdown","dropdown_id":"D1"},
    ...
  ],
  "dropdowns": [
    {"id":"D1","options":["...","..."],"options_es":["...","..."],"correct_option":"..."}
  ]
}
"""


class LLMTranslator:
    """Translate and structure a RawQuestion using an LLM."""

    def __init__(
        self,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        exam_name: str = "",
        vendor: str = "",
        domain: str = "",
    ):
        self.provider = (provider or os.getenv("LLM_PROVIDER", "openai")).lower()
        self.model = model or os.getenv("LLM_MODEL", "gpt-4o")
        self.api_key = api_key or os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
        self.base_url = base_url or os.getenv("OPENAI_BASE_URL")
        # Exam context for dynamic prompts
        self.exam_name = exam_name
        self.vendor = vendor
        self.domain = domain
        self._client = None

    def _get_client(self):
        if self._client:
            return self._client

        if self.provider == "anthropic":
            # TODO: install anthropic package and configure
            import anthropic  # noqa: F401
            self._client = anthropic.Anthropic(api_key=self.api_key)
        else:
            # Default: OpenAI-compatible
            import openai
            kwargs: Dict[str, Any] = {}
            if self.api_key:
                kwargs["api_key"] = self.api_key
            if self.base_url:
                kwargs["base_url"] = self.base_url
            self._client = openai.OpenAI(**kwargs)

        return self._client

    def _call_llm_with_prompt(self, system_prompt: str, user_content: str) -> Dict[str, Any]:
        """Generic LLM call with a system prompt, returns parsed JSON."""
        client = self._get_client()
        if self.provider == "anthropic":
            import anthropic
            msg = client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=system_prompt,
                messages=[{"role": "user", "content": user_content}],
            )
            content = msg.content[0].text.strip()
        else:
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content.strip()

        # Strip markdown fences if present
        if "```" in content:
            import re
            match = re.search(r"```(?:json)?\s*([\s\S]+?)```", content)
            if match:
                content = match.group(1).strip()
            else:
                content = re.sub(r"```(?:json)?", "", content).strip()

        content = content.strip()

        if not content:
            raise ValueError("LLM returned empty response")

        # Find JSON object in response even if there's surrounding text
        if not content.startswith("{"):
            import re
            match = re.search(r"\{[\s\S]+\}", content)
            if match:
                content = match.group(0)

        return json.loads(content)

    def review_only(self, raw_text: str, question_number: int) -> Dict[str, Any]:
        """Review and clean English text only (no translation). Returns structured dict."""
        if not self.api_key:
            raise ValueError("No API key configured")
        prompt = build_review_only_prompt(self.exam_name, self.vendor, self.domain)
        user_content = f"Question number: {question_number}\n\n{raw_text}\n\nRespond with ONLY a valid JSON object."
        return self._call_llm_with_prompt(prompt, user_content)

    def translate_only(self, question_number: int, stem: str, options: list, correct_answer: str, correct_answers: list) -> Dict[str, Any]:
        """Translate already-reviewed English question to Spanish. Returns translation dict."""
        if not self.api_key:
            raise ValueError("No API key configured")
        prompt = build_translate_only_prompt(self.exam_name, self.vendor, self.domain)
        # Complete the partial prompt (build_translate_only_prompt ends at the opening brace)
        full_prompt = prompt + """
  "spanish_stem": "traducción del enunciado",
  "spanish_options": [{"key":"A","text":"traducción de la opción"}],
  "spanish_correct_answers": ["etiqueta traducida: A", "otra etiqueta: B"],
  "spanish_explanation": "explicación en español",
  "english_explanation": "brief explanation in English of why the answer is correct"
}
If the question is not drag_and_drop, set "spanish_correct_answers" to [].
Return ONLY JSON, no markdown.
"""
        input_data = {
            "question_number": question_number,
            "stem": stem,
            "options": options,
            "correct_answer": correct_answer,
            "correct_answers": correct_answers,
        }
        user_content = f"Translate question {question_number}:\n\n{json.dumps(input_data, ensure_ascii=False)}\n\nRespond with ONLY a valid JSON object."
        return self._call_llm_with_prompt(full_prompt, user_content)

    def improve_explanation(
        self,
        question_number: int,
        stem: str,
        options: list,
        correct_answers: list,
        existing_explanation: str = "",
    ) -> Dict[str, Any]:
        """Ask LLM to improve/rewrite the explanation for a translated question."""
        if not self.api_key:
            raise ValueError("No API key configured")
        prompt = build_improve_explanation_prompt(self.exam_name, self.vendor, self.domain)
        input_data = {
            "question_number": question_number,
            "stem": stem,
            "options": options,
            "correct_answers": correct_answers,
            "existing_explanation": existing_explanation,
        }
        user_content = (
            f"Improve the explanation for question {question_number}:\n\n"
            f"{json.dumps(input_data, ensure_ascii=False)}\n\n"
            "Respond with ONLY a valid JSON object."
        )
        return self._call_llm_with_prompt(prompt, user_content)

    def review_and_translate(self, raw_text: str, question_number: int) -> Dict[str, Any]:
        """Translate + spell/terminology review. Returns raw dict for frontend review."""
        if not self.api_key:
            raise ValueError("No API key configured")
        client = self._get_client()
        prompt = f"{REVIEW_PROMPT}\n\nQuestion number: {question_number}\n\n{raw_text}\n\nRespond with ONLY a valid JSON object, no markdown fences."
        if self.provider == "anthropic":
            import anthropic
            msg = client.messages.create(
                model=self.model,
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )
            content = msg.content[0].text.strip()
            # Strip markdown fences if present
            if content.startswith("```"):
                content = "\n".join(content.split("\n")[1:])
            if content.endswith("```"):
                content = "\n".join(content.split("\n")[:-1])
            content = content.strip()
        else:
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": REVIEW_PROMPT},
                    {"role": "user", "content": f"Question number: {question_number}\n\n{raw_text}"},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content
        logger.debug(f"LLM response Q{question_number}: {content[:200]}")
        return json.loads(content)

    def translate(self, raw_question: RawQuestion) -> AnyQuestion:
        """Call LLM to translate and structure the raw question. Returns typed model."""
        # Guard: no API key configured
        if not self.api_key:
            logger.warning(
                "No API key configured. Returning stub question. "
                "Set OPENAI_API_KEY or ANTHROPIC_API_KEY."
            )
            return self._stub(raw_question)

        try:
            response_json = self._call_llm(raw_question.raw_text)
            return self._build_model(raw_question, response_json)
        except Exception as e:
            logger.error(f"LLM translation failed for Q{raw_question.question_number}: {e}")
            base = self._stub(raw_question)
            base.translation_status = "error"
            base.translation_error = str(e)
            return base

    def _call_llm(self, raw_text: str) -> Dict[str, Any]:
        """Send text to LLM and parse JSON response."""
        client = self._get_client()

        if self.provider == "anthropic":
            import anthropic
            msg = client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": raw_text}],
            )
            content = msg.content[0].text
        else:
            # OpenAI / compatible
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": raw_text},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content

        return json.loads(content)

    def _build_model(self, raw: RawQuestion, data: Dict[str, Any]) -> AnyQuestion:
        """Build the appropriate Pydantic model from LLM JSON output."""
        q_type = data.get("question_type", "multiple_choice")
        base_kwargs = {
            "question_number": raw.question_number,
            "raw_text": raw.raw_text,
            "page_numbers": raw.page_numbers,
            "has_images": raw.has_images,
            "translation_status": "done",
        }

        try:
            if q_type == "multiple_choice":
                return MultipleChoiceQuestion(
                    **base_kwargs,
                    question_text=data.get("question_text"),
                    question_text_es=data.get("question_text_es"),
                    options=[AnswerOption(**o) for o in data.get("options", [])],
                    correct_answer=data.get("correct_answer"),
                    explanation=data.get("explanation"),
                    explanation_es=data.get("explanation_es"),
                )
            elif q_type == "multiple_select":
                return MultipleSelectQuestion(
                    **base_kwargs,
                    question_text=data.get("question_text"),
                    question_text_es=data.get("question_text_es"),
                    options=[AnswerOption(**o) for o in data.get("options", [])],
                    correct_answers=data.get("correct_answers", []),
                    num_correct=data.get("num_correct"),
                    explanation=data.get("explanation"),
                    explanation_es=data.get("explanation_es"),
                )
            elif q_type == "drag_and_drop":
                from ..models.question import DragDropItem, DragDropTarget
                return DragAndDropQuestion(
                    **base_kwargs,
                    scenario_text=data.get("scenario_text"),
                    scenario_text_es=data.get("scenario_text_es"),
                    instruction=data.get("instruction"),
                    instruction_es=data.get("instruction_es"),
                    items=[DragDropItem(**i) for i in data.get("items", [])],
                    targets=[DragDropTarget(**t) for t in data.get("targets", [])],
                )
            elif q_type == "hotspot":
                return HotspotQuestion(
                    **base_kwargs,
                    scenario_text=data.get("scenario_text"),
                    scenario_text_es=data.get("scenario_text_es"),
                    rows=[HotspotRow(**r) for r in data.get("rows", [])],
                )
            elif q_type == "dropdown":
                from ..models.question import DropdownSegment, DropdownGroup
                return DropdownQuestion(
                    **base_kwargs,
                    full_sentence_es=data.get("full_sentence_es"),
                    segments=[DropdownSegment(**s) for s in data.get("segments", [])],
                    dropdowns=[DropdownGroup(**g) for g in data.get("dropdowns", [])],
                )
        except Exception as e:
            logger.error(f"Model build failed for Q{raw.question_number}: {e}")

        # Fallback
        q = BaseQuestion(
            **base_kwargs,
            question_type=QuestionType.unknown,
            translation_status="error",
            translation_error=f"Model build error from LLM data",
        )
        return q

    def _stub(self, raw: RawQuestion) -> BaseQuestion:
        """Return a stub when no API key is available."""
        from .question_classifier_helper import infer_type_from_raw
        q_type = infer_type_from_raw(raw.raw_text)
        return BaseQuestion(
            question_number=raw.question_number,
            question_type=q_type,
            raw_text=raw.raw_text,
            page_numbers=raw.page_numbers,
            has_images=raw.has_images,
            translation_status="pending",
        )


# ─── Small helper imported lazily ─────────────────────────────────────────────
# (avoids circular imports at module level)
