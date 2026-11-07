#!/usr/bin/env python3
import sys
import re

def main():
    if len(sys.argv) < 2:
        return
    log_path = sys.argv[1]
    os_name = sys.argv[2] if len(sys.argv) > 2 else "unknown"
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except Exception as e:
        print(f"::error title=Reporter error on {os_name}::Could not read {log_path}: {e}")
        return

    failed_tests = []
    for i, line in enumerate(lines):
        m = re.search(r"FAIL\s+\[\s*[\d\.]+s\]\s+(\S+)", line)
        if m:
            failed_tests.append(m.group(1))
        if "panicked at" in line:
            ctx = " ".join(lines[j].strip() for j in range(max(0, i), min(len(lines), i+3)) if lines[j].strip())
            ctx = ctx[:400]
            print(f"::error title=Test failure ({os_name})::{ctx}")

    for t in failed_tests[:25]:
        print(f"::error title=Failed test on {os_name}::{t}")

if __name__ == "__main__":
    main()
