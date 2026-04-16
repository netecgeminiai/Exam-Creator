"""
LLM-based syllabus researcher and question-topic mapper.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


RESEARCH_PROMPT = """You are a certification exam expert. Given information about a certification exam, research and return the official exam syllabus/outline.

Return a JSON array of topics with Bloom's Taxonomy levels:
[
  {
    "topic_key": "short-slug",
    "topic_name": "Full Topic Name",
    "description": "What this topic covers (2-3 sentences)",
    "weight_pct": 15,
    "bloom_level": "understand",
    "bloom_distribution": {"remember": 10, "understand": 40, "apply": 30, "analyze": 15, "evaluate": 5, "create": 0},
    "order": 1
  }
]

Bloom's Taxonomy levels (revised):
1. Remember (recall facts, terms, definitions)
2. Understand (explain ideas, concepts, relationships)
3. Apply (use information in new situations)
4. Analyze (draw connections, distinctions, relationships)
5. Evaluate (justify decisions, choices based on criteria)
6. Create (produce new or original work)

Rules:
- Use your knowledge of the official exam body of knowledge / syllabus
- weight_pct should reflect approximate % of exam questions per topic (must sum to ~100)
- bloom_level: primary cognitive level for this topic (often "understand" or "apply")
- bloom_distribution: estimated % of questions at each level (sum to 100)
- Order topics as they appear in the official guide
- Be specific to this exam's official content, not generic
- Return ONLY valid JSON array, no markdown
"""

MAPPING_PROMPT = """You are a certification exam expert. Given a list of syllabus topics and an exam question, identify which topic this question belongs to.

Return JSON:
{
  "topic_key": "the-matching-topic-key",
  "confidence": "high|medium|low",
  "reason": "brief explanation"
}

If the question doesn't clearly match any topic, use the closest one and set confidence to "low".
Return ONLY valid JSON, no markdown.
"""


class SyllabusResearcher:
    def __init__(self, exam_name: str = "", vendor: str = "", domain: str = ""):
        self.exam_name = exam_name
        self.vendor = vendor
        self.domain = domain
        self.provider = os.getenv("LLM_PROVIDER", "openai").lower()
        self.model = os.getenv("LLM_MODEL", "gpt-4o")
        self.api_key = os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")

    def _call_llm(self, system_prompt: str, user_content: str) -> Any:
        if not self.api_key:
            raise ValueError("No API key configured")

        if self.provider == "anthropic":
            import anthropic
            client = anthropic.Anthropic(api_key=self.api_key)
            msg = client.messages.create(
                model=self.model,
                max_tokens=4096,
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
                max_tokens=4096,
                temperature=0.3,
            )
            content = resp.choices[0].message.content.strip()

        # Strip markdown fences
        match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", content)
        if match:
            content = match.group(1).strip()

        return json.loads(content)

    def research_syllabus(self) -> List[Dict[str, Any]]:
        """Ask LLM to research and return the official syllabus topics."""
        user_content = f"""Exam information:
- Certification: {self.exam_name or 'Unknown'}
- Vendor/Organization: {self.vendor or 'Unknown'}
- Domain: {self.domain or 'Unknown'}

Please research the official syllabus/exam outline for this certification and return the topics as specified."""

        result = self._call_llm(RESEARCH_PROMPT, user_content)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "topics" in result:
            return result["topics"]
        return []

    def map_question_to_topic(self, question_stem: str, options: list, topics: List[Dict]) -> Dict[str, Any]:
        """Map a single question to its syllabus topic."""
        topics_summary = "\n".join(
            f"- {t['topic_key']}: {t['topic_name']} — {t.get('description','')[:100]}"
            for t in topics
        )
        user_content = f"""Syllabus topics:
{topics_summary}

Question:
{question_stem}

Options:
{chr(10).join(f"{o['key']}. {o['text']}" for o in (options or []))}

Which topic does this question belong to?"""

        return self._call_llm(MAPPING_PROMPT, user_content)

    def batch_map_questions(self, questions: List[Dict], topics: List[Dict]) -> List[Dict[str, Any]]:
        """Map multiple questions to topics. Returns list of {question_id, topic_key, confidence}."""
        results = []
        for q in questions:
            try:
                mapping = self.map_question_to_topic(
                    q.get("stem", q.get("english_stem", "")),
                    q.get("options", q.get("english_options", [])),
                    topics,
                )
                results.append({
                    "question_id": q["id"],
                    "question_number": q.get("question_number"),
                    "topic_key": mapping.get("topic_key"),
                    "confidence": mapping.get("confidence", "medium"),
                    "reason": mapping.get("reason", ""),
                })
            except Exception as e:
                logger.error(f"Mapping failed for Q{q.get('question_number')}: {e}")
                results.append({
                    "question_id": q["id"],
                    "question_number": q.get("question_number"),
                    "topic_key": None,
                    "confidence": "error",
                    "reason": str(e),
                })
        return results
