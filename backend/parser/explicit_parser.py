"""
Parse questions that have explicit Answer: X format.
Handles formats like:
  NO.1 Question text
  A. Option A
  B. Option B
  Answer: B
  (optional garbage / reference text after)
"""
from __future__ import annotations

import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Matches "Answer: B" or "Answer: B,C" or "Answer: BD" — only capital letters/commas, no words
ANSWER_RE = re.compile(r"\bAnswer\s*:\s*([A-F](?:[,\s]*[A-F])*)\s*(?:\n|$)", re.IGNORECASE)

# Matches option lines: "A. text", "A) text"
OPTION_RE = re.compile(r"^([A-F])[.)]\s+(.+)", re.MULTILINE)

# Cloudflare / junk token pattern
JUNK_RE = re.compile(r"__cf_chl_\w+__=\S+.*", re.DOTALL)


def try_parse_explicit(raw_text: str) -> Optional[dict]:
    """
    If the raw_text contains an explicit 'Answer: X' marker, parse it fully
    without needing an LLM call.

    Returns a dict with: stem, options, correct_answer, correct_answers, review_notes
    or None if this format is not detected.
    """
    # Only apply if explicit answer marker exists
    answer_match = ANSWER_RE.search(raw_text)
    if not answer_match:
        return None

    # Strip junk after the answer line
    clean_text = JUNK_RE.sub("", raw_text).strip()

    # Extract answer(s)
    answer_str = answer_match.group(1).replace(" ", "").replace(",", "")
    correct_answers = list(answer_str.upper())  # e.g. "BD" → ["B", "D"]
    correct_answer = correct_answers[0] if len(correct_answers) == 1 else ""

    # Extract options
    options = []
    for m in OPTION_RE.finditer(clean_text):
        options.append({"key": m.group(1).upper(), "text": m.group(2).strip()})

    # Extract stem: everything before the first option line
    first_option = OPTION_RE.search(clean_text)
    if first_option:
        stem_raw = clean_text[:first_option.start()].strip()
    else:
        # No options found — use text up to Answer: line
        stem_raw = clean_text[:answer_match.start()].strip()

    # Clean up the NO.X prefix from stem
    stem = re.sub(r"^NO\.\s*\d+\s*", "", stem_raw, flags=re.IGNORECASE).strip()

    # Remove "Answer: ..." line from stem if it ended up there
    stem = ANSWER_RE.sub("", stem).strip()

    review_notes = []
    if not options:
        review_notes.append("No options detected — may need manual review")
    if not stem:
        review_notes.append("Empty stem — check raw_text")

    logger.debug(f"Explicit parse: stem={stem[:60]!r}, options={len(options)}, answers={correct_answers}")

    return {
        "stem": stem,
        "options": options,
        "correct_answer": correct_answer,
        "correct_answers": correct_answers,
        "review_notes": review_notes,
        "has_issues": bool(review_notes),
        "parsed_by": "explicit_parser",
    }
