#!/usr/bin/env python3
"""Convert a document to plain text for the desk's intake.

One job: take a path, print text. markitdown handles PDF, Word, Excel,
PowerPoint, HTML, CSV and plain text; PDF falls back to pymupdf if markitdown
cannot open it. Nothing is written and no network call is made.

Kept deliberately small so the bridge can shell out to it safely:
  argv[1] = absolute path to an existing file
  argv[2] = optional character cap (default 20000)
"""
import sys

CAP_DEFAULT = 20000


def with_markitdown(path):
    from markitdown import MarkItDown
    return MarkItDown().convert(path).text_content


def with_pymupdf(path):
    import fitz
    doc = fitz.open(path)
    try:
        return "\n\n".join(page.get_text() for page in doc)
    finally:
        doc.close()


def main():
    if len(sys.argv) < 2:
        print("usage: doc_text.py <file> [cap]", file=sys.stderr)
        return 2
    path = sys.argv[1]
    cap = int(sys.argv[2]) if len(sys.argv) > 2 else CAP_DEFAULT
    errors = []
    for fn in (with_markitdown, with_pymupdf):
        try:
            text = fn(path) or ""
        except Exception as exc:  # try the next converter
            errors.append(f"{fn.__name__}: {type(exc).__name__}: {exc}")
            continue
        text = text.strip()
        if text:
            print(text[:cap])
            return 0
        errors.append(f"{fn.__name__}: produced no text")
    print("could not read the document: " + "; ".join(errors), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
