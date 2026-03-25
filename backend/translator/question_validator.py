"""
LLM-based question validator.
Checks if a question is valid for a given certification exam and syllabus topic.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

VALIDATION_PROMPT = """You are a senior certification exam quality auditor with deep, expert knowledge of the {exam_name} exam by {vendor} and its official body of knowledge ({domain}).

Your task is to validate whether an exam question is suitable for this certification.

Evaluate on these criteria:
- **Relevance**: Does it genuinely test knowledge of the assigned syllabus topic?
- **Accuracy**: Is the marked correct answer actually correct per the official {vendor} body of knowledge?
- **Quality**: Is it well-formed, unambiguous, and at the right difficulty level?
- **Authenticity**: Does it match the style and scope of real {exam_name} exam questions?

IMPORTANT: For every note you write, you MUST cite the specific source in the official body of knowledge.
For {vendor} exams, cite like: "SBOK Guide, Chapter X: [Chapter Name], Section: [Section Name]"
or "SBOK Guide, p. XX" if you know the page.
If the answer is wrong, explain what the correct answer is AND cite where in the official guide it is documented.

Return ONLY valid JSON:
{{
  "verdict": "valid" | "needs_review" | "rejected",
  "confidence": "high" | "medium" | "low",
  "notes": [
    "Specific finding with citation — e.g. 'Answer B is incorrect. Per SBOK Guide Chapter 3 (Scrum Roles), the Scrum Master is responsible for removing impediments, not the Product Owner (Section 3.2).'"
  ],
  "correct_answer_verified": true | false,
  "suggested_correct_answer": "A" | null,
  "sbok_reference": "Chapter X: Title, Section Y: Title"
}}

Verdicts:
- "valid": Accurate, relevant, well-formed, correct answer confirmed
- "needs_review": Potentially valid but ambiguous, debatable, or minor inaccuracy
- "rejected": Wrong answer, off-topic, outdated, or not suitable for this certification
"""


class QuestionValidator:
    def __init__(self, exam_name: str = "", vendor: str = "", domain: str = ""):
        self.exam_name = exam_name or "certification"
        self.vendor = vendor or "the certifying body"
        self.domain = domain or "the subject domain"
        self.provider = os.getenv("LLM_PROVIDER", "openai").lower()
        self.model = os.getenv("LLM_MODEL", "gpt-4o")
        self.api_key = os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")

    def _call_llm(self, system_prompt: str, user_content: str) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("No API key configured")

        if self.provider == "anthropic":
            import anthropic
            client = anthropic.Anthropic(api_key=self.api_key)
            msg = client.messages.create(
                model=self.model,
                max_tokens=1024,
                system=system_prompt,
                messages=[{"role": "user", "content": user_content}],
            )
            content = msg.content[0].text.strip()
        else:
            import openai
            client = openai.OpenAI(api_key=self.api_key, base_url=os.getenv("OPENAI_BASE_URL"))
            resp = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                max_tokens=1024,
                temperature=0.2,
            )
            content = resp.choices[0].message.content.strip()

        match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", content)
        if match:
            content = match.group(1).strip()
        if not content.startswith("{"):
            m = re.search(r"\{[\s\S]+\}", content)
            if m:
                content = m.group(0)

        return json.loads(content)

    def validate_question(
        self,
        question_number: int,
        stem: str,
        options: List[Dict],
        correct_answers: List[str],
        topic_name: str,
        topic_description: str,
    ) -> Dict[str, Any]:
        """Validate a single question against the syllabus topic and exam knowledge."""
        system_prompt = VALIDATION_PROMPT.format(
            exam_name=self.exam_name,
            vendor=self.vendor,
            domain=self.domain,
        )

        options_text = "\n".join(f"{o['key']}. {o['text']}" for o in (options or []))
        correct_str = ", ".join(correct_answers) if correct_answers else "unknown"

        user_content = f"""Syllabus topic: {topic_name}
Topic description: {topic_description}

Question #{question_number}:
{stem}

Options:
{options_text}

Marked correct answer(s): {correct_str}

Validate this question."""

        return self._call_llm(system_prompt, user_content)

    def batch_validate(
        self,
        questions: List[Dict],
        topics_map: Dict[int, Dict],  # topic_id -> {topic_name, topic_description}
    ) -> List[Dict[str, Any]]:
        """Validate a batch of questions. Returns list of results."""
        results = []
        for q in questions:
            try:
                topic = topics_map.get(q.get("syllabus_topic_id")) or {}
                result = self.validate_question(
                    question_number=q.get("question_number", 0),
                    stem=q.get("english_stem") or q.get("raw_text", ""),
                    options=q.get("english_options") or [],
                    correct_answers=q.get("correct_answers") or (
                        [q["correct_answer"]] if q.get("correct_answer") else []
                    ),
                    topic_name=topic.get("topic_name", "Unknown"),
                    topic_description=topic.get("description", ""),
                )
                notes = result.get("notes", [])
                sbok_ref = result.get("sbok_reference")
                if sbok_ref:
                    notes = notes + [f"📖 Referencia: {sbok_ref}"]
                results.append({
                    "question_id": q["id"],
                    "question_number": q.get("question_number"),
                    "verdict": result.get("verdict", "needs_review"),
                    "confidence": result.get("confidence", "low"),
                    "notes": notes,
                    "correct_answer_verified": result.get("correct_answer_verified", False),
                    "suggested_correct_answer": result.get("suggested_correct_answer"),
                })
            except Exception as e:
                logger.error(f"Validation failed Q{q.get('question_number')}: {e}")
                results.append({
                    "question_id": q["id"],
                    "question_number": q.get("question_number"),
                    "verdict": "needs_review",
                    "confidence": "low",
                    "notes": [f"Validation error: {str(e)}"],
                    "correct_answer_verified": False,
                    "suggested_correct_answer": None,
                })
        return results
