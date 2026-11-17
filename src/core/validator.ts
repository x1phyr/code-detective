import Ajv, { type ErrorObject } from 'ajv';
import { parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser';
import schema from '../../schemas/code-map-v1.schema.json';
import type { CodeMap } from '../../shared/types';
import { t } from '../../shared/i18n';
import { isCanonicalRelativePath } from './paths';
import { normalizeLineEndings } from './text';
import { findParentCycle } from './hierarchy';

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
  throw new Error(t('core.validateFailedAt', { path: path || '/', message }));
}

function location(text: string, offset: number): string {
  const prefix = text.slice(0, offset);
  const line = prefix.split('\n').length;
  const column = offset - prefix.lastIndexOf('\n');
  return t('core.location', { line, column });
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
          fail(propertyPath, t('core.duplicateJsonKey', { key: JSON.stringify(key), location: location(text, keyNode.offset) }));
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
      return t('core.schemaUnknownField', { path, field: JSON.stringify(error.params.additionalProperty) });
    case 'required':
      return t('core.schemaMissingField', { path, field: JSON.stringify(error.params.missingProperty) });
    case 'const':
      return t('core.schemaConst', { path, value: JSON.stringify(error.params.allowedValue) });
    case 'maxItems':
      return t('core.schemaMaxItems', { path, limit: error.params.limit });
    case 'maxProperties':
      return t('core.schemaMaxSources', { path, limit: error.params.limit });
    case 'uniqueItems':
      return t('core.schemaUniqueItems', { path });
    case 'enum':
      return t('core.schemaEnum', { path, values: error.params.allowedValues.join(t('core.listSeparator')) });
    default:
      return `${path}：${error.message ?? error.keyword}`;
  }
}

function checkUniqueIds(items: readonly { id: string }[], path: string): Set<string> {
  const ids = new Set<string>();
  items.forEach(({ id }, index) => {
    if (ids.has(id)) fail(`${path}/${index}/id`, t('core.duplicateId', { id: JSON.stringify(id) }));
    ids.add(id);
  });
  return ids;
}

function checkReferences(ids: readonly string[], known: ReadonlySet<string>, path: string): void {
  ids.forEach((id, index) => {
    if (!known.has(id)) fail(`${path}/${index}`, t('core.unknownRefId', { id: JSON.stringify(id) }));
  });
}

function checkPath(file: string, path: string): void {
  if (!isCanonicalRelativePath(file)) {
    fail(path, t('core.fileNotCanonical'));
  }
}

export function parseMap(text: string): CodeMap {
  if (Buffer.byteLength(text, 'utf8') > MAP_LIMITS.bytes) {
    fail('/', t('core.mapTooLarge'));
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
    fail('/', t('core.jsonUnparsable'));
  }
  if (errors.length || !tree) {
    const error = errors[0];
    fail('/', error
      ? t('core.jsonSyntaxErrorAt', { code: printParseErrorCode(error.error), location: location(text, error.offset) })
      : t('core.jsonEmpty'));
  }
  rejectDuplicateKeys(tree, text);

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail('/', t('core.jsonSyntaxError'));
  }
  if (!validate(value)) {
    const details = (validate.errors ?? []).slice(0, 5).map(describeSchemaError).join('\n');
    throw new Error(t('core.validateFailed', { details }));
  }

  const sourceIds = new Set(Object.keys(value.sources));
  const nodeIds = checkUniqueIds(value.nodes, '/nodes');
  const edgeIds = checkUniqueIds(value.edges, '/edges');
  checkUniqueIds(value.walkthrough, '/walkthrough');

  for (const [id, source] of Object.entries(value.sources)) {
    const base = `/sources/${pointerPart(id)}`;
    checkPath(source.file, `${base}/file`);
    if (source.endLine < source.startLine) fail(base, t('core.endBeforeStart'));
    if (source.anchorText !== undefined) {
      const lines = normalizeLineEndings(source.anchorText).split('\n').length;
      if (lines !== source.endLine - source.startLine + 1) {
        fail(`${base}/anchorText`, t('core.anchorIncomplete'));
      }
    }
  }

  const nodeMap = new Map(value.nodes.map(node => [node.id, node]));
  value.nodes.forEach((node, index) => {
    checkReferences(node.sourceIds, sourceIds, `/nodes/${index}/sourceIds`);
    if (node.parent !== undefined) {
      if (node.parent === node.id) fail(`/nodes/${index}/parent`, t('core.parentSelf'));
      if (!nodeIds.has(node.parent)) fail(`/nodes/${index}/parent`, t('core.parentNotFound', { id: JSON.stringify(node.parent) }));
    }
  });
  const cycle = findParentCycle(value);
  if (cycle) fail('/nodes', t('core.parentCycle', { id: JSON.stringify(cycle) }));
  value.nodes.forEach((node, index) => {
    if (node.parent !== undefined) {
      const parentNode = nodeMap.get(node.parent);
      if (parentNode?.parent !== undefined) {
        fail(`/nodes/${index}/parent`, t('core.parentTooDeep', { id: JSON.stringify(node.id), parent: JSON.stringify(node.parent) }));
      }
    }
  });

  value.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from)) fail(`/edges/${index}/from`, t('core.edgeNodeNotFound', { id: JSON.stringify(edge.from) }));
    if (!nodeIds.has(edge.to)) fail(`/edges/${index}/to`, t('core.edgeNodeNotFound', { id: JSON.stringify(edge.to) }));
    checkReferences(edge.sourceIds, sourceIds, `/edges/${index}/sourceIds`);
    if (edge.via) checkReferences(edge.via, sourceIds, `/edges/${index}/via`);
  });

  if (!value.walkthrough.some(step => !step.aside)) {
    fail('/walkthrough', t('core.walkthroughEmpty'));
  }
  const steps = new Map(value.walkthrough.map(step => [step.id, step]));
  value.walkthrough.forEach((step, index) => {
    const base = `/walkthrough/${index}`;
    checkReferences(step.nodeIds, nodeIds, `${base}/nodeIds`);
    checkReferences(step.edgeIds, edgeIds, `${base}/edgeIds`);
    if (step.sourceId !== undefined && !sourceIds.has(step.sourceId)) {
      fail(`${base}/sourceId`, t('core.unknownRefId', { id: JSON.stringify(step.sourceId) }));
    }
    if (!step.sourceId && step.nodeIds.length === 0 && step.edgeIds.length === 0) {
      fail(base, t('core.stepNeedsAnchor'));
    }
    step.branches?.forEach((id, at) => {
      const target = steps.get(id);
      if (!target) fail(`${base}/branches/${at}`, t('core.unknownRefId', { id: JSON.stringify(id) }));
      if (id === step.id) fail(`${base}/branches/${at}`, t('core.stepBranchSelf'));
      if (!target.aside) fail(`${base}/branches/${at}`, t('core.stepBranchNotAside', { id: JSON.stringify(id) }));
    });
    if (step.notes) {
      checkUniqueIds(step.notes, `${base}/notes`);
    }
  });
  return value;
}
