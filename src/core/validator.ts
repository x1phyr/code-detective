import Ajv, { type ErrorObject } from 'ajv';
import { parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser';
import schema from '../../schemas/code-map-v1.schema.json';
import type { CodeMap } from '../../shared/types';
import { isCanonicalRelativePath } from './paths';
import { normalizeLineEndings } from './text';

export const MAP_LIMITS = {
  bytes: 2 * 1024 * 1024,
  nodes: 500,
  edges: 1000,
  sources: 2000,
  steps: 200,
} as const;

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  strictNumbers: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
const validate = ajv.compile<CodeMap>(schema);

function pointerPart(part: string): string {
  return part.replace(/~/g, '~0').replace(/\//g, '~1');
}

function fail(path: string, message: string): never {
  throw new Error(`地图校验失败 ${path || '/'}：${message}`);
}

function location(text: string, offset: number): string {
  const prefix = text.slice(0, offset);
  const line = prefix.split('\n').length;
  const column = offset - prefix.lastIndexOf('\n');
  return `第 ${line} 行，第 ${column} 列`;
}

function rejectDuplicateKeys(root: Node, text: string): void {
  const pending: { node: Node; path: string }[] = [{ node: root, path: '' }];
  while (pending.length) {
    const { node, path } = pending.pop()!;
    if (node.type === 'object') {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const keyNode = property.children?.[0];
        const valueNode = property.children?.[1];
        if (!keyNode || !valueNode) continue;
        const key = String(keyNode.value);
        const propertyPath = `${path}/${pointerPart(key)}`;
        if (keys.has(key)) {
          fail(propertyPath, `重复 JSON 键 ${JSON.stringify(key)}（${location(text, keyNode.offset)}）`);
        }
        keys.add(key);
        pending.push({ node: valueNode, path: propertyPath });
      }
    } else if (node.type === 'array') {
      node.children?.forEach((child, index) => pending.push({ node: child, path: `${path}/${index}` }));
    }
  }
}

function describeSchemaError(error: ErrorObject): string {
  const path = error.instancePath || '/';
  switch (error.keyword) {
    case 'additionalProperties':
      return `${path}：不支持字段 ${JSON.stringify(error.params.additionalProperty)}`;
    case 'required':
      return `${path}：缺少必填字段 ${JSON.stringify(error.params.missingProperty)}`;
    case 'const':
      return `${path}：必须为 ${JSON.stringify(error.params.allowedValue)}；当前仅支持 schemaVersion 1`;
    case 'maxItems':
      return `${path}：数量不能超过 ${error.params.limit}`;
    case 'maxProperties':
      return `${path}：来源数量不能超过 ${error.params.limit}`;
    case 'uniqueItems':
      return `${path}：引用数组内的 ID 不得重复`;
    case 'enum':
      return `${path}：仅允许 ${error.params.allowedValues.join('、')}`;
    default:
      return `${path}：${error.message ?? error.keyword}`;
  }
}

function checkUniqueIds(items: readonly { id: string }[], path: string): Set<string> {
  const ids = new Set<string>();
  items.forEach(({ id }, index) => {
    if (ids.has(id)) fail(`${path}/${index}/id`, `重复 ID ${JSON.stringify(id)}`);
    ids.add(id);
  });
  return ids;
}

function checkReferences(ids: readonly string[], known: ReadonlySet<string>, path: string): void {
  ids.forEach((id, index) => {
    if (!known.has(id)) fail(`${path}/${index}`, `引用了不存在的 ID ${JSON.stringify(id)}`);
  });
}

function checkPath(file: string, path: string): void {
  if (!isCanonicalRelativePath(file)) {
    fail(path, 'file 必须是以 / 分隔的工作区相对文件路径：不能使用绝对路径、URI、反斜杠或控制字符，'
      + '也不能包含 .、..、空白或空路径段');
  }
}

export function parseMap(text: string): CodeMap {
  if (Buffer.byteLength(text, 'utf8') > MAP_LIMITS.bytes) {
    fail('/', '地图超过 2 MiB 上限，请按功能拆分地图');
  }

  const errors: ParseError[] = [];
  let tree: Node | undefined;
  try {
    tree = parseTree(text, errors, {
      allowTrailingComma: false,
      disallowComments: true,
      allowEmptyContent: false,
    });
  } catch {
    fail('/', '无法解析 JSON；请检查嵌套深度和文件内容');
  }
  if (errors.length || !tree) {
    const error = errors[0];
    fail('/', error
      ? `JSON 语法错误：${printParseErrorCode(error.error)}（${location(text, error.offset)}）；只接受完整的标准 JSON`
      : '文件没有完整 JSON 内容');
  }
  rejectDuplicateKeys(tree, text);

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail('/', 'JSON 语法错误；只接受完整的标准 JSON');
  }
  if (!validate(value)) {
    const details = (validate.errors ?? []).slice(0, 5).map(describeSchemaError).join('\n');
    throw new Error(`地图校验失败：\n${details}`);
  }

  const sourceIds = new Set(Object.keys(value.sources));
  const nodeIds = checkUniqueIds(value.nodes, '/nodes');
  const edgeIds = checkUniqueIds(value.edges, '/edges');
  checkUniqueIds(value.walkthrough ?? [], '/walkthrough');

  for (const [id, source] of Object.entries(value.sources)) {
    const base = `/sources/${pointerPart(id)}`;
    checkPath(source.file, `${base}/file`);
    if (source.endLine < source.startLine) fail(base, 'endLine 必须大于或等于 startLine');
    if (source.anchorText !== undefined) {
      const lines = normalizeLineEndings(source.anchorText).split('\n').length;
      if (lines !== source.endLine - source.startLine + 1) {
        fail(`${base}/anchorText`, '必须包含 startLine 至 endLine 的全部完整行，不能只提供其中一段文本');
      }
    }
  }
  value.nodes.forEach((node, index) => checkReferences(node.sourceIds, sourceIds, `/nodes/${index}/sourceIds`));
  value.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from)) fail(`/edges/${index}/from`, `找不到节点 ${JSON.stringify(edge.from)}`);
    if (!nodeIds.has(edge.to)) fail(`/edges/${index}/to`, `找不到节点 ${JSON.stringify(edge.to)}`);
    checkReferences(edge.sourceIds, sourceIds, `/edges/${index}/sourceIds`);
  });
  value.walkthrough?.forEach((step, index) => {
    checkReferences(step.nodeIds, nodeIds, `/walkthrough/${index}/nodeIds`);
    checkReferences(step.edgeIds, edgeIds, `/walkthrough/${index}/edgeIds`);
  });
  return value;
}
