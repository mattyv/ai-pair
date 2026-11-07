// An advisory syntax check. Python parses the source from stdin; it never runs it.
import { execFile } from 'node:child_process';

const TIMEOUT_MS = 2000;
const MAX_OUTPUT = 16_384;
const UNAVAILABLE = 'Python syntax check unavailable (python3 missing, failed, or timed out).';
const CHECK = `import ast, json, sys
source = sys.stdin.read()
try:
    ast.parse(source)
    print("null")
except SyntaxError as error:
    line = error.lineno or 1
    print(json.dumps({"line": line, "endLine": error.end_lineno or line, "message": error.msg}))
`;

/** A syntax diagnostic, or a warning that the check could not run. */
export interface PythonCheck {
  diagnostic?: { line: number; endLine: number; message: string; source: string };
  warning?: string;
}

/** Parses Python source in a bounded subprocess without executing it. */
export function pythonDiagnostic(text: string): Promise<PythonCheck> {
  return new Promise((resolve) => {
    const child = execFile('python3', ['-I', '-S', '-c', CHECK], { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT }, (error, stdout) => {
      if (error !== null) {
        resolve({ warning: UNAVAILABLE });
        return;
      }
      try {
        const result: unknown = JSON.parse(stdout);
        if (result === null) {
          resolve({});
        } else if (
          typeof result === 'object' &&
          result !== null &&
          'line' in result &&
          typeof result.line === 'number' &&
          Number.isInteger(result.line) &&
          result.line > 0 &&
          'endLine' in result &&
          typeof result.endLine === 'number' &&
          Number.isInteger(result.endLine) &&
          result.endLine > 0 &&
          'message' in result &&
          typeof result.message === 'string'
        ) {
          resolve({ diagnostic: { line: result.line, endLine: result.endLine, message: result.message, source: 'Python ast' } });
        } else {
          resolve({ warning: UNAVAILABLE });
        }
      } catch {
        resolve({ warning: UNAVAILABLE });
      }
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(text);
  });
}
