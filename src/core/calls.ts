import type { CodeMap, MapEdge, MapNode, Selection } from '../../shared/types';

export interface CallTokenSpan {
  /** 1-based line number in the document. */
  line: number;
  /** 0-based UTF-16 start column on that line. */
  startCol: number;
  /** 0-based UTF-16 end column (exclusive) on that line. */
  endCol: number;
  callee: string;
}

export interface LineSpan {
  /** 1-based inclusive start line. */
  startLine: number;
  /** 1-based inclusive end line. */
  endLine: number;
}

export interface FocusHighlightPlan {
  spotlightLines: LineSpan[];
  scopeLines?: LineSpan;
  callTokens: CallTokenSpan[];
  noteLine: number;
}

export interface CallCandidate extends CallTokenSpan {
  /** 1-based end line of the balanced call expression `( ... )`. */
  callEndLine: number;
  hasReceiver: boolean;
}

const NON_CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'throw',
  'typeof', 'instanceof', 'void', 'delete', 'await', 'yield',
  'import', 'export', 'super', 'constructor', 'function', 'class',
  'sizeof', 'alignof', 'async',
]);

const DECL_MODIFIERS = new Set([
  'export', 'default', 'async', 'public', 'private', 'protected',
  'readonly', 'static', 'abstract', 'override', 'get', 'set',
]);

const LOW_SIGNAL_CALLEES = new Set([
  'String', 'Number', 'Boolean', 'Array', 'Object', 'Math', 'JSON',
  'stringify', 'parse', 'from', 'isArray', 'keys', 'values', 'entries', 'assign', 'hasOwn',
  'log', 'warn', 'error', 'info', 'debug', 'trace',
]);

const LOW_SIGNAL_RECEIVERS = new Set(['console', 'JSON', 'Math']);

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;

type MaskMode = 'code' | 'single' | 'double' | 'template' | 'blockComment';

/**
 * Replaces comments and string/template literal text with spaces while preserving
 * exact per-line lengths and keeping `${...}` template interpolation expressions active.
 */
export function maskCodeLines(lines: readonly string[]): string[] {
  let mode: MaskMode = 'code';
  const templateBraceStack: number[] = [];
  const out: string[] = [];

  for (const line of lines) {
    const chars = new Array<string>(line.length);
    let i = 0;
    let escapedEol = false;

    while (i < line.length) {
      const ch = line[i]!;
      const next = i + 1 < line.length ? line[i + 1] : '';

      if (mode === 'blockComment') {
        if (ch === '*' && next === '/') {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
          mode = 'code';
        } else {
          chars[i] = ' ';
          i += 1;
        }
        continue;
      }

      if (mode === 'single' || mode === 'double') {
        const quote = mode === 'single' ? '\'' : '"';
        if (ch === '\\') {
          chars[i] = ' ';
          if (i + 1 < line.length) {
            chars[i + 1] = ' ';
            i += 2;
          } else {
            escapedEol = true;
            i += 1;
          }
          continue;
        }
        chars[i] = ' ';
        i += 1;
        if (ch === quote) mode = 'code';
        continue;
      }

      if (mode === 'template') {
        if (ch === '\\') {
          chars[i] = ' ';
          if (i + 1 < line.length) {
            chars[i + 1] = ' ';
            i += 2;
          } else {
            i += 1;
          }
          continue;
        }
        if (ch === '$' && next === '{') {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          templateBraceStack.push(1);
          mode = 'code';
          i += 2;
          continue;
        }
        chars[i] = ' ';
        i += 1;
        if (ch === '`') mode = 'code';
        continue;
      }

      // mode === 'code'
      if (ch === '/' && next === '/') {
        while (i < line.length) {
          chars[i] = ' ';
          i += 1;
        }
        break;
      }
      if (ch === '/' && next === '*') {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        mode = 'blockComment';
        i += 2;
        continue;
      }
      if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]!))) {
        while (i < line.length) {
          chars[i] = ' ';
          i += 1;
        }
        break;
      }
      if (ch === '\'') {
        chars[i] = ' ';
        mode = 'single';
        i += 1;
        continue;
      }
      if (ch === '"') {
        chars[i] = ' ';
        mode = 'double';
        i += 1;
        continue;
      }
      if (ch === '`') {
        chars[i] = ' ';
        mode = 'template';
        i += 1;
        continue;
      }
      if (ch === '{' && templateBraceStack.length > 0) {
        templateBraceStack[templateBraceStack.length - 1]! += 1;
      } else if (ch === '}' && templateBraceStack.length > 0) {
        const remaining = templateBraceStack[templateBraceStack.length - 1]! - 1;
        if (remaining === 0) {
          templateBraceStack.pop();
          chars[i] = ' ';
          mode = 'template';
          i += 1;
          continue;
        }
        templateBraceStack[templateBraceStack.length - 1] = remaining;
      }
      chars[i] = ch;
      i += 1;
    }

    if ((mode === 'single' || mode === 'double') && !escapedEol) {
      mode = 'code';
    }
    out.push(chars.join(''));
  }

  return out;
}

/** Walks balanced `(...)` starting from `openCol` on `lineIdx` across `maskedLines`. */
function findCallClosing(
  maskedLines: readonly string[],
  lineIdx: number,
  openCol: number,
): { endLineIdx: number; closeCol: number; afterCloseText: string } | undefined {
  let depth = 0;
  for (let l = lineIdx; l < maskedLines.length; l += 1) {
    const line = maskedLines[l]!;
    const startCol = l === lineIdx ? openCol : 0;
    for (let c = startCol; c < line.length; c += 1) {
      const ch = line[c];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          const restParts = [line.slice(c + 1)];
          for (let k = l + 1; k < Math.min(maskedLines.length, l + 3); k += 1) {
            restParts.push(maskedLines[k]!);
          }
          return { endLineIdx: l, closeCol: c, afterCloseText: restParts.join('\n') };
        }
      }
    }
  }
  return undefined;
}

interface ScopeEntry {
  name: string;
  kind: 'class' | 'fn';
  declLine: number;
  depth: number;
  opened: boolean;
  /** Minimum `(lineIdx, col)` where the opening `{` of the scope body may appear. */
  braceAfterLine: number;
  braceAfterCol: number;
}

interface IndentScopeEntry {
  name: string;
  kind: 'class' | 'fn';
  declLine: number;
  indent: number;
}

const CLASS_DECL_RE = /^(?:export\s+)?(?:default\s+)?(?:(?:abstract|final|public|private|protected|internal|open|data|sealed)\s+)*(?:class|struct)\s+([A-Za-z_$][\w$]*)/;
const IMPL_DECL_RE = /^(?:pub(?:\([^)]*\))?\s+)?impl(?:\s*<[^>]*>)?\s+(?:[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*\s+for\s+)?([A-Za-z_]\w*)/;
const FN_DECL_RE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/;
const RUST_GO_FN_RE = /^(?:(?:pub(?:\([^)]*\))?|async|unsafe|extern(?:\s+"[^"]*")?)\s+)*(?:fn|func)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*(?:<[^>]*>|\[[^\]]*\])?\s*\(/;
const ARROW_FN_RE = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>\s*\{/;
const METHOD_DECL_RE = /^(?:(?:public|private|protected|readonly|static|abstract|override|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/;
const PY_CLASS_RE = /^class\s+([A-Za-z_]\w*)(?:\s*\([^)]*\))?\s*:\s*$/;
const PY_DEF_RE = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;

function findOpeningBracePosition(
  maskedLines: readonly string[],
  startLineIdx: number,
  startCol: number,
): { lineIdx: number; col: number } | undefined {
  const limit = Math.min(maskedLines.length, startLineIdx + 3);
  let angleDepth = 0;
  for (let l = startLineIdx; l < limit; l += 1) {
    const line = maskedLines[l]!;
    const from = l === startLineIdx ? startCol : 0;
    for (let c = from; c < line.length; c += 1) {
      const ch = line[c]!;
      if (ch === '<') angleDepth += 1;
      else if (ch === '>' && angleDepth > 0) angleDepth -= 1;
      else if (ch === '{') return { lineIdx: l, col: c };
      else if ((ch === ';' || ch === '=') && angleDepth === 0) return undefined;
    }
  }
  return undefined;
}

function detectBraceDecl(
  maskedLines: readonly string[],
  lineIdx: number,
  hasActiveFn: boolean,
): { name: string; kind: 'class' | 'fn'; braceLine: number; braceCol: number } | undefined {
  const line = maskedLines[lineIdx]!;
  const lead = line.length - line.trimStart().length;
  const trimmed = line.slice(lead).trimEnd();
  if (!trimmed) return undefined;

  const classMatch = CLASS_DECL_RE.exec(trimmed) ?? IMPL_DECL_RE.exec(trimmed);
  if (classMatch && !trimmed.endsWith(':')) {
    const brace = findOpeningBracePosition(maskedLines, lineIdx, lead + classMatch[0].length);
    if (brace) {
      return { name: classMatch[1]!, kind: 'class', braceLine: brace.lineIdx, braceCol: brace.col };
    }
  }

  const arrowMatch = ARROW_FN_RE.exec(trimmed);
  if (arrowMatch) {
    const braceOffset = line.indexOf('{', lead + arrowMatch[0].length - 1);
    return { name: arrowMatch[1]!, kind: 'fn', braceLine: lineIdx, braceCol: Math.max(lead, braceOffset) };
  }

  const explicitFn = FN_DECL_RE.exec(trimmed) ?? RUST_GO_FN_RE.exec(trimmed);
  if (explicitFn) {
    const openCol = lead + explicitFn[0].length - 1;
    const closed = findCallClosing(maskedLines, lineIdx, openCol);
    if (closed) {
      const brace = findOpeningBracePosition(maskedLines, closed.endLineIdx, closed.closeCol + 1);
      if (brace) {
        return { name: explicitFn[1]!, kind: 'fn', braceLine: brace.lineIdx, braceCol: brace.col };
      }
    }
  }

  if (!hasActiveFn) {
    const methodMatch = METHOD_DECL_RE.exec(trimmed);
    if (methodMatch) {
      const name = methodMatch[1]!;
      if (!NON_CALL_KEYWORDS.has(name) || name === 'constructor') {
        const openCol = lead + methodMatch[0].length - 1;
        const closed = findCallClosing(maskedLines, lineIdx, openCol);
        if (closed) {
          const brace = findOpeningBracePosition(maskedLines, closed.endLineIdx, closed.closeCol + 1);
          if (brace) {
            return { name, kind: 'fn', braceLine: brace.lineIdx, braceCol: brace.col };
          }
        }
      }
    }
  }

  return undefined;
}

function formatQualifiedSymbol(scopes: readonly { name: string; kind: 'class' | 'fn' }[]): string | undefined {
  let cls: string | undefined;
  let fn: string | undefined;
  for (const s of scopes) {
    if (s.kind === 'class') cls = s.name;
    else fn = s.name;
  }
  if (cls && fn) return `${cls}.${fn}`;
  return fn ?? cls;
}

/**
 * Infers the enclosing function or `Class.method` symbol covering `[startLine, endLine]` (1-based).
 */
export function inferEnclosingSymbol(
  fileLines: readonly string[],
  startLine: number,
  endLine: number,
): string | undefined {
  if (fileLines.length === 0 || startLine < 1 || endLine < startLine) return undefined;
  const maskedLines = maskCodeLines(fileLines);
  const limit = Math.min(maskedLines.length, endLine);

  let braceDepth = 0;
  const scopes: ScopeEntry[] = [];
  const indentScopes: IndentScopeEntry[] = [];
  let pending: ScopeEntry | undefined;

  let activeAtStart: string | undefined;
  let firstDeclaredInRange: string | undefined;
  let firstClassInRange: string | undefined;

  for (let lineIdx = 0; lineIdx < limit; lineIdx += 1) {
    const docLine = lineIdx + 1;
    const masked = maskedLines[lineIdx]!;
    const trimmed = masked.trim();

    if (trimmed.length > 0) {
      const indent = masked.length - masked.trimStart().length;
      while (indentScopes.length > 0 && indent <= indentScopes.at(-1)!.indent) {
        indentScopes.pop();
      }
    }

    const activeScopesBefore = [...indentScopes, ...scopes];
    const hasActiveFn = activeScopesBefore.some(s => s.kind === 'fn');

    const pyClass = PY_CLASS_RE.exec(trimmed);
    if (pyClass) {
      const indent = masked.length - masked.trimStart().length;
      indentScopes.push({ name: pyClass[1]!, kind: 'class', declLine: docLine, indent });
      if (docLine >= startLine && docLine <= endLine && !firstClassInRange) {
        firstClassInRange = formatQualifiedSymbol([...indentScopes, ...scopes]);
      }
    } else {
      const pyDef = PY_DEF_RE.exec(trimmed);
      if (pyDef && /:\s*$/.test(trimmed)) {
        const indent = masked.length - masked.trimStart().length;
        indentScopes.push({ name: pyDef[1]!, kind: 'fn', declLine: docLine, indent });
        if (docLine >= startLine && docLine <= endLine && !firstDeclaredInRange) {
          firstDeclaredInRange = formatQualifiedSymbol([...indentScopes, ...scopes]);
        }
      }
    }

    if (!pending) {
      const decl = detectBraceDecl(maskedLines, lineIdx, hasActiveFn);
      if (decl) {
        pending = {
          name: decl.name,
          kind: decl.kind,
          declLine: docLine,
          depth: braceDepth + 1,
          opened: false,
          braceAfterLine: decl.braceLine,
          braceAfterCol: decl.braceCol,
        };
        const candidateScopes = [...indentScopes, ...scopes, pending];
        if (docLine >= startLine && docLine <= endLine) {
          if (decl.kind === 'fn' && !firstDeclaredInRange) {
            firstDeclaredInRange = formatQualifiedSymbol(candidateScopes);
          } else if (decl.kind === 'class' && !firstClassInRange) {
            firstClassInRange = formatQualifiedSymbol(candidateScopes);
          }
        }
      }
    }

    if (docLine === startLine) {
      const current = pending ? [...indentScopes, ...scopes, pending] : [...indentScopes, ...scopes];
      activeAtStart = formatQualifiedSymbol(current);
    }

    for (let c = 0; c < masked.length; c += 1) {
      const ch = masked[c]!;
      if (ch === '{') {
        braceDepth += 1;
        if (pending && !pending.opened && (lineIdx > pending.braceAfterLine || (lineIdx === pending.braceAfterLine && c >= pending.braceAfterCol))) {
          pending.depth = braceDepth;
          pending.opened = true;
          scopes.push(pending);
          pending = undefined;
        }
      } else if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        while (scopes.length > 0 && scopes.at(-1)!.opened && braceDepth < scopes.at(-1)!.depth) {
          scopes.pop();
        }
      }
    }
  }

  return firstDeclaredInRange ?? activeAtStart ?? firstClassInRange;
}

/**
 * Fallback symbol extraction from a source snippet's `anchorText` when `symbol` was not recorded.
 */
export function extractSnippetSymbol(anchorText: string | undefined): string | undefined {
  if (!anchorText) return undefined;
  const lines = anchorText.replace(/\r\n|\r|\n/g, '\n').split('\n');
  return inferEnclosingSymbol(lines, 1, lines.length);
}

function isDeclarationAt(
  maskedLines: readonly string[],
  lineIdx: number,
  startCol: number,
  hasReceiver: boolean,
  openCol: number,
): boolean {
  const before = maskedLines[lineIdx]!.slice(0, startCol);
  if (/(?:^|\b)(?:function|def|fn|func)[\s*]+$/.test(before)) return true;
  if (/^\s*func\s*\([^)]*\)\s*$/.test(before)) return true;
  if (hasReceiver) return false;

  const tokens = before.trim().split(/\s+/).filter(Boolean);
  if (!tokens.every(tok => DECL_MODIFIERS.has(tok))) return false;
  const closed = findCallClosing(maskedLines, lineIdx, openCol);
  if (!closed) return false;
  return /^\s*(?::[^{;=]+)?\{/.test(closed.afterCloseText);
}

/**
 * Extracts function/method call candidates from source lines (comments and string text ignored).
 */
export function extractCallCandidates(lines: readonly string[], startLine = 1): CallCandidate[] {
  if (lines.length === 0) return [];
  const maskedLines = maskCodeLines(lines);
  const callRegex = /((?:[A-Za-z_$][\w$]*\??\.)?([A-Za-z_$][\w$]*))(?:<[A-Za-z0-9_$,\s.|&?[\]]+>)?\s*\(/g;
  const candidates: CallCandidate[] = [];

  for (let lineIdx = 0; lineIdx < maskedLines.length; lineIdx += 1) {
    const line = maskedLines[lineIdx]!;
    callRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(line)) !== null) {
      const startCol = match.index;
      if (startCol > 0 && /[A-Za-z0-9_$]/.test(line[startCol - 1]!)) continue;

      const fullToken = match[1]!;
      const callee = match[2]!;
      const endCol = startCol + fullToken.length;
      const openCol = match.index + match[0].length - 1;
      const hasReceiver = fullToken.includes('.')
        || (startCol >= 1 && line[startCol - 1] === '.')
        || (startCol >= 2 && line.slice(startCol - 2, startCol) === '.#');

      if (!hasReceiver && NON_CALL_KEYWORDS.has(callee)) continue;
      if (isDeclarationAt(maskedLines, lineIdx, startCol, hasReceiver, openCol)) continue;

      const docLine = startLine + lineIdx;
      const closed = findCallClosing(maskedLines, lineIdx, openCol);
      const rawEndLine = closed ? startLine + closed.endLineIdx : docLine;
      const callEndLine = Math.min(rawEndLine, docLine + 6, startLine + lines.length - 1);

      candidates.push({
        line: docLine,
        callEndLine,
        startCol,
        endCol,
        callee,
        hasReceiver,
      });
    }
  }

  return candidates;
}

function addExplicitCalls(text: string | undefined, target: Set<string>): void {
  if (!text) return;
  const pattern = /((?:[A-Za-z_$][\w$]*\??\.)?([A-Za-z_$][\w$]*))\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const callee = match[2]!;
    if (callee.length >= 2 && !NON_CALL_KEYWORDS.has(callee)) {
      target.add(callee);
    }
  }
}

function addNodeNames(node: MapNode | undefined, target: Set<string>): void {
  if (!node) return;
  if (IDENTIFIER_PATTERN.test(node.id) && node.id.length >= 2) {
    target.add(node.id);
  }
  const parenPattern = /\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = parenPattern.exec(node.label)) !== null) {
    const ident = match[1]!;
    if (ident.length >= 2 && !NON_CALL_KEYWORDS.has(ident)) target.add(ident);
  }
  addExplicitCalls(node.label, target);
}

/**
 * Collects exact callee identifiers pointed to by the current walkthrough step, node, edge, or source note.
 */
export function preferredCalleeNames(
  map: CodeMap,
  sourceId: string,
  focus?: Selection,
  declaredFnName?: string,
): Set<string> {
  const names = new Set<string>();
  const nodeById = new Map(map.nodes.map(n => [n.id, n]));
  const edgeById = new Map(map.edges.map(e => [e.id, e]));

  addExplicitCalls(map.sources[sourceId]?.note, names);

  if (focus?.kind === 'step') {
    const step = map.walkthrough.find(s => s.id === focus.id);
    if (step) {
      addExplicitCalls(step.title, names);
      const stepEdges: MapEdge[] = step.edgeIds
        .map(id => edgeById.get(id))
        .filter((e): e is MapEdge => e !== undefined);
      if (stepEdges.length > 0) {
        for (const edge of stepEdges) {
          addExplicitCalls(edge.label, names);
          addNodeNames(nodeById.get(edge.to), names);
        }
      } else {
        const outgoing = map.edges.filter(e => step.nodeIds.includes(e.from));
        const preferredEdges = step.aside
          ? outgoing
          : (() => {
              const mainEdges = outgoing.filter(e => !e.branch);
              return mainEdges.length > 0 ? mainEdges : outgoing;
            })();
        for (const edge of preferredEdges) {
          addExplicitCalls(edge.label, names);
          addNodeNames(nodeById.get(edge.to), names);
        }
      }
      for (const nodeId of step.nodeIds) {
        addNodeNames(nodeById.get(nodeId), names);
      }
    }
  } else if (focus?.kind === 'edge') {
    const edge = edgeById.get(focus.id);
    if (edge) {
      addExplicitCalls(edge.label, names);
      addNodeNames(nodeById.get(edge.to), names);
    }
  } else if (focus?.kind === 'node') {
    const node = nodeById.get(focus.id);
    addNodeNames(node, names);
    for (const edge of map.edges.filter(e => e.from === focus.id)) {
      addExplicitCalls(edge.label, names);
      addNodeNames(nodeById.get(edge.to), names);
    }
  }

  if (declaredFnName) names.delete(declaredFnName);
  return names;
}

function detectWholeFunctionName(lines: readonly string[]): string | undefined {
  if (lines.length < 4) return undefined;
  const firstIdx = lines.findIndex(line => line.trim().length > 0);
  if (firstIdx < 0) return undefined;
  let lastIdx = -1;
  for (let i = lines.length - 1; i > firstIdx; i -= 1) {
    if (lines[i]!.trim().length > 0) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx <= firstIdx) return undefined;
  if (!/^\}(?:\s*\/\/.*)?$/.test(lines[lastIdx]!.trim())) return undefined;

  const first = lines[firstIdx]!.trim();
  const fnMatch = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/.exec(first);
  if (fnMatch) return fnMatch[1];

  const arrowMatch = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>\s*\{/.exec(first);
  if (arrowMatch) return arrowMatch[1];

  const rustGoMatch = /^(?:(?:pub(?:\([^)]*\))?|async)\s+)*(?:fn|func)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(first);
  if (rustGoMatch) return rustGoMatch[1];

  const methodMatch = /^(?:(?:public|private|protected|readonly|static|abstract|override|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/.exec(first);
  if (methodMatch && !NON_CALL_KEYWORDS.has(methodMatch[1]!)) return methodMatch[1];

  return undefined;
}

function isLowSignalCall(candidate: CallCandidate, lineText: string): boolean {
  if (LOW_SIGNAL_CALLEES.has(candidate.callee)) return true;
  if (candidate.hasReceiver) {
    const token = lineText.slice(candidate.startCol, candidate.endCol);
    const receiver = token.split(/\??\./)[0];
    if (receiver && LOW_SIGNAL_RECEIVERS.has(receiver)) return true;
  }
  return false;
}

function mergeLineSpans(spans: readonly LineSpan[]): LineSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const merged: LineSpan[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const prev = merged[merged.length - 1]!;
    if (cur.startLine <= prev.endLine + 1) {
      prev.endLine = Math.max(prev.endLine, cur.endLine);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function inLineSpans(line: number, spans: readonly LineSpan[]): boolean {
  return spans.some(span => line >= span.startLine && line <= span.endLine);
}

/**
 * Plans the spotlight lines, optional enclosing function scope, inline call tokens,
 * and note line for a focused source snippet.
 */
export function planFocusHighlight(options: {
  startLine: number;
  lines: readonly string[];
  map?: CodeMap;
  sourceId?: string;
  focus?: Selection;
}): FocusHighlightPlan {
  const { startLine, lines, map, sourceId, focus } = options;
  if (lines.length === 0) {
    return {
      spotlightLines: [{ startLine, endLine: startLine }],
      callTokens: [],
      noteLine: startLine,
    };
  }

  const endLine = startLine + lines.length - 1;
  const declaredFnName = detectWholeFunctionName(lines);
  const isWholeFunctionBlock = declaredFnName !== undefined;
  const candidates = extractCallCandidates(lines, startLine);

  let keyCalls: CallCandidate[] = [];
  if (map && sourceId) {
    const preferred = preferredCalleeNames(map, sourceId, focus, declaredFnName);
    keyCalls = candidates.filter(c => preferred.has(c.callee));
  }
  if (keyCalls.length === 0 && candidates.length > 0) {
    const meaningful = candidates.filter(c => !isLowSignalCall(c, lines[c.line - startLine]!));
    keyCalls = meaningful.length > 0 ? meaningful : candidates;
  }

  const spotlightLines: LineSpan[] = isWholeFunctionBlock && keyCalls.length > 0
    ? mergeLineSpans(keyCalls.map(c => ({ startLine: c.line, endLine: c.callEndLine })))
    : [{ startLine, endLine }];
  const scopeLines: LineSpan | undefined = isWholeFunctionBlock && keyCalls.length > 0
    ? { startLine, endLine }
    : undefined;

  const callTokens: CallTokenSpan[] = keyCalls
    .filter(c => inLineSpans(c.line, spotlightLines))
    .map(({ line, startCol, endCol, callee }) => ({ line, startCol, endCol, callee }));

  return {
    spotlightLines,
    ...(scopeLines ? { scopeLines } : {}),
    callTokens,
    noteLine: spotlightLines[0]!.startLine,
  };
}
