import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { isCanonicalRelativePath, isWithin, resolveWithinRoot, assertRelativeSourcePath } from '../src/core/paths';
import { HostError } from '../src/core/errors';
import { parseMap } from '../src/core/validator';
import schema from '../schemas/code-map-v1.schema.json';

const here = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.join(here, '..', 'examples', 'bag-demo', '.code-detective', 'maps', 'bag-demo.json');
const root = path.resolve(path.sep, 'work', 'project');

test('isWithin 包含根目录本身与子路径', () => {
  assert.equal(isWithin(root, root), true);
  assert.equal(isWithin(root, path.join(root, 'src', 'a.ts')), true);
  assert.equal(isWithin(root, path.join(root, '..foo')), true, '..foo 是根目录内的普通文件名');
});

test('isWithin 拒绝父目录与同名前缀的兄弟目录', () => {
  assert.equal(isWithin(root, path.dirname(root)), false);
  assert.equal(isWithin(root, path.join(root, '..', 'other')), false);
  assert.equal(isWithin(root, `${root}-sibling`), false);
  assert.equal(isWithin(root, path.join(path.dirname(root), '..foo')), false);
  assert.equal(isWithin(root, path.join(root, '..', '..foo', 'x')), false);
});

test('isWithin 使用平台分隔符判断回溯', () => {
  // isWithin is bound to node:path, so exercise the separator the platform actually uses.
  const nested = [root, 'a', 'b'].join(path.sep);
  assert.equal(isWithin(root, nested), true);
  assert.equal(isWithin(nested, root), false);
});

test('isCanonicalRelativePath 只接受规范的相对路径', () => {
  for (const ok of ['a.ts', 'src/a.ts', 'src/..foo/a.ts', 'src/.hidden', 'a b/c d.ts', ' a.ts', '中文/文件.ts', 'my_dir/x.ts']) {
    assert.equal(isCanonicalRelativePath(ok), true, ok);
  }
  for (const bad of ['', ' ', 'src/ /a.ts', '\t', '/abs', 'src//a.ts', 'src/', './a.ts', 'src/./a.ts', '../a.ts',
    'src/..', 'src\\a.ts', 'C:/a.ts', 'file:///a', 'my_dir:x/a.ts', 'a\0b', 'a\nb', 'a\u007fb']) {
    assert.equal(isCanonicalRelativePath(bad), false, JSON.stringify(bad));
  }
});

test('assertRelativeSourcePath 抛出 HostError', () => {
  assert.throws(() => assertRelativeSourcePath('../x'), (error: unknown) =>
    error instanceof HostError && error.code === 'SOURCE_OUTSIDE_ROOT');
  assert.doesNotThrow(() => assertRelativeSourcePath('src/a.ts'));
});

test('resolveWithinRoot 解析到根目录内并拒绝越界', () => {
  assert.equal(resolveWithinRoot(root, 'src/a.ts'), path.join(root, 'src', 'a.ts'));
  assert.equal(resolveWithinRoot(root, '..foo'), path.join(root, '..foo'));
  assert.throws(() => resolveWithinRoot(root, '../outside.ts'), (error: unknown) =>
    error instanceof HostError && error.code === 'SOURCE_OUTSIDE_ROOT');
  assert.throws(() => resolveWithinRoot(root, 'a/../../b'), HostError);
});

const filePattern = new RegExp(
  (schema as any).definitions.source.properties.file.pattern as string,
  'u',
);

function acceptedByParseMap(file: string): boolean {
  const map = JSON.parse(readFileSync(examplePath, 'utf8'));
  const first = Object.keys(map.sources)[0]!;
  map.sources[first].file = file;
  try {
    parseMap(JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

test('schema pattern、parseMap 与 isCanonicalRelativePath 的路径规则一致', () => {
  const table: [string, boolean][] = [
    ['src/a.ts', true],
    ['a.ts', true],
    ['src/..foo/a.ts', true],
    ['.github/workflow.yml', true],
    ['a b/c.ts', true],
    [' lead.ts', true],
    ['中文/文件.ts', true],
    ['emoji/😀.ts', true],
    ['my_dir/x.ts', true],
    ['', false],
    [' ', false],
    ['\u3000', false],
    ['src/ /a.ts', false],
    ['src//a.ts', false],
    ['src/', false],
    ['/etc/passwd', false],
    ['./a.ts', false],
    ['src/./a.ts', false],
    ['..', false],
    ['../a.ts', false],
    ['src/../a.ts', false],
    ['src/..', false],
    ['src\\a.ts', false],
    ['C:/windows', false],
    ['file:///tmp/a.ts', false],
    ['my_dir:x/a.ts', false],
    ['a+b.c-d:x', false],
    ['a\0b', false],
    ['a\nb', false],
    ['a\u007fb', false],
  ];
  for (const [file, expected] of table) {
    const label = JSON.stringify(file);
    assert.equal(isCanonicalRelativePath(file), expected, `paths.ts ${label}`);
    assert.equal(filePattern.test(file), expected, `schema ${label}`);
    assert.equal(acceptedByParseMap(file), expected, `parseMap ${label}`);
  }
});

test('示例地图的 $schema 指向真实的 schema 文件', () => {
  const map = JSON.parse(readFileSync(examplePath, 'utf8')) as { $schema: string };
  const resolved = path.resolve(path.dirname(examplePath), map.$schema);
  assert.equal(existsSync(resolved), true, resolved);
  assert.equal(resolved, path.resolve(here, '..', 'schemas', 'code-map-v1.schema.json'));
});
