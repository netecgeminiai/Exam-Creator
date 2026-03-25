"""
Parse questions that have explicit Answer: X format.
Handles formats like:
  NO.1 Question text
  A. Option A text that may
     continue on the next line
  B. Option B
  Answer: B
  (optional garbage / reference text after)
"""
from __future__ import annotations

import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Matches "Answer: B" or "Answer: B,C" — only capital letters A-F
ANSWER_RE = re.compile(r"\bAnswer\s*:\s*([A-F](?:[,\s]*[A-F])*)\s*(?:\n|$)", re.IGNORECASE)

# Matches the START of an option line: "A. text" or "A) text"
OPTION_START_RE = re.compile(r"^([A-F])[.)]\s+(.+)", re.MULTILINE)

# Cloudflare / junk token pattern
JUNK_RE = re.compile(r"__cf_chl_\w+__=\S+.*", re.DOTALL)

# PDF watermark / provider branding
WATERMARK_RE = re.compile(r"IT Certification Guaranteed,?\s*The Easy Way!?\s*\n?\s*\d*\s*", re.IGNORECASE)

# Carriage returns
CR_RE = re.compile(r"\r\n?")

# Lines that are clearly NOT a continuation (start of new option, answer, reference, etc.)
NON_CONTINUATION_RE = re.compile(
    r"^(?:[A-F][.)]\s|Answer\s*:|Reference\s*:|Explanation\s*:|NO\.\s*\d+|\s*$)",
    re.IGNORECASE | re.MULTILINE,
)


def _join_continuation_lines(text: str) -> str:
    """
    Join option lines that continue on the next line.
    A continuation line is one that:
    - Does NOT start with A-F. or A-F) (new option)
    - Does NOT start with Answer:, Reference:, Explanation:
    - Is not blank
    """
    lines = text.split("\n")
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # Check if this line starts an option
        if OPTION_START_RE.match(line):
            # Accumulate continuation lines
            combined = line
            j = i + 1
            while j < len(lines):
                next_line = lines[j].strip()
                if not next_line:
                    break  # blank line = end of option
                if NON_CONTINUATION_RE.match(lines[j]):
                    break  # new option or keyword = end of option
                combined += " " + next_line
                j += 1
            result.append(combined)
            i = j
        else:
            result.append(line)
            i += 1
    return "\n".join(result)


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

    # Strip junk / watermarks / carriage returns
    clean_text = JUNK_RE.sub("", raw_text)
    clean_text = WATERMARK_RE.sub("", clean_text)
    clean_text = CR_RE.sub("\n", clean_text)
    clean_text = re.sub(r"\n{3,}", "\n\n", clean_text).strip()

    # Join continuation lines before parsing options
    clean_text = _join_continuation_lines(clean_text)

    # Re-find answer after joining (position may have shifted)
    answer_match = ANSWER_RE.search(clean_text)
    if not answer_match:
        return None

    # Extract answer(s)
    answer_str = answer_match.group(1).replace(" ", "").replace(",", "")
    correct_answers = list(answer_str.upper())
    correct_answer = correct_answers[0] if len(correct_answers) == 1 else ""

    # Extract options
    options = []
    for m in OPTION_START_RE.finditer(clean_text):
        options.append({"key": m.group(1).upper(), "text": m.group(2).strip()})

    # Extract stem: everything before the first option line
    first_option = OPTION_START_RE.search(clean_text)
    if first_option:
        stem_raw = clean_text[:first_option.start()].strip()
    else:
        stem_raw = clean_text[:answer_match.start()].strip()

    # Clean up the NO.X prefix from stem
    stem = re.sub(r"^NO\.\s*\d+\s*", "", stem_raw, flags=re.IGNORECASE).strip()
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
