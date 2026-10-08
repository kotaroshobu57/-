"""Compatibility CLI: delegate to the production TypeScript Workbook Reader.
No independent XML parser or verification-only extraction rules.
"""
import pathlib, subprocess, sys
root=pathlib.Path(__file__).resolve().parent.parent
if len(sys.argv)!=2:
    raise SystemExit('Usage: python3 scripts/xml-reference.py workbook.xlsx')
raise SystemExit(subprocess.run([str(root/'node_modules/.bin/tsx'),str(root/'scripts/dump-workbook.ts'),sys.argv[1]],cwd=root).returncode)
