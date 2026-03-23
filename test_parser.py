#!/usr/bin/env python3
"""Test the PDF parser against MS-900.pdf and print sample questions."""
import sys
import os
import textwrap

# Add backend to Python path so relative imports resolve via package
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

# Import using the package structure
from backend.parser.pdf_extractor import PDFExtractor
from backend.parser.question_splitter import QuestionSplitter
from backend.parser.question_classifier import QuestionClassifier
from backend.models.question import QuestionType

PDF_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "MS-900.pdf")


def print_question(q, q_type: QuestionType):
    print(f"\n{'='*70}")
    print(f"  QUESTION {q.question_number}  |  Type: {q_type.value}  |  Pages: {q.page_numbers}")
    print(f"{'='*70}")
    snippet = q.raw_text[:700].replace("\n", " ")
    print(textwrap.fill(snippet, width=70))
    if len(q.raw_text) > 700:
        print("  [...truncated...]")


def main():
    print(f"Parsing: {os.path.abspath(PDF_PATH)}")
    pages = PDFExtractor().extract(PDF_PATH)
    print(f"✓ Extracted {len(pages)} pages")

    qs = QuestionSplitter().split(pages)
    print(f"✓ Split into {len(qs)} questions")

    clf = QuestionClassifier()

    type_counts = {}
    typed_qs = []
    for q in qs:
        t = clf.classify(q)
        type_counts[t.value] = type_counts.get(t.value, 0) + 1
        typed_qs.append((q, t))

    print("\n--- Question Type Summary ---")
    for k, v in sorted(type_counts.items()):
        print(f"  {k:25s}: {v}")

    print("\n--- Sample Questions (one per type) ---")
    seen_types = set()
    for q, t in typed_qs:
        if t not in seen_types:
            print_question(q, t)
            seen_types.add(t)
        if len(seen_types) >= 5:
            break

    print(f"\n✓ Done. {len(qs)} questions total, {len(seen_types)} distinct types shown.")


if __name__ == "__main__":
    main()
