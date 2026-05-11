import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.join(__dirname, '..', 'src');

const COMPOSITION_ROOTS = ['main.ts', 'composition'];

interface Violation {
  file: string;
  specifier: string;
  targetModule: string;
  resolvedPath: string;
}

function getAllTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.spec.ts')) {
      results.push(full);
    }
  }
  return results;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function getOwnerModule(filePath: string): string {
  const rel = normalizePath(path.relative(ROOT, filePath));
  const match = rel.match(/^modules\/([^/]+)\//);
  if (match) return `modules/${match[1]}`;

  if (rel === 'main.ts') return '<composition-root>';
  if (rel.startsWith('composition/')) return '<composition-root>';
  return '<infra>';
}

function isCompositionRoot(filePath: string): boolean {
  const rel = normalizePath(path.relative(ROOT, filePath));
  return rel === 'main.ts' || rel.startsWith('composition/');
}

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
    return null; // npm package
  }

  let resolved: string;
  if (specifier.startsWith('@/')) {
    resolved = path.join(ROOT, specifier.slice(2));
  } else {
    resolved = path.resolve(path.dirname(fromFile), specifier);
  }

  // normalize
  resolved = normalizePath(resolved);
  const srcNorm = normalizePath(ROOT);

  if (!resolved.startsWith(srcNorm)) return null;

  return resolved;
}

function getTargetModule(resolvedPath: string): string | null {
  const rel = normalizePath(path.relative(ROOT, resolvedPath));
  const match = rel.match(/^modules\/([^/]+)/);
  if (match) return `modules/${match[1]}`;
  return null;
}

function isBarrelImport(resolvedPath: string, targetModule: string): boolean {
  const moduleDir = normalizePath(path.join(ROOT, targetModule));
  const indexPaths = [
    `${moduleDir}/index`,
    `${moduleDir}/index.ts`,
    `${moduleDir}`,
  ];
  const norm = normalizePath(resolvedPath);
  return indexPaths.some((p) => norm === p || norm.startsWith(p + '/') === false && norm === p.replace('.ts', ''));
}

function extractImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return imports;
}

function checkFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const source = fs.readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const imports = extractImports(sf);
  const ownerModule = getOwnerModule(filePath);
  const isComp = isCompositionRoot(filePath);

  for (const specifier of imports) {
    const resolved = resolveSpecifier(specifier, filePath);
    if (!resolved) continue;

    const targetModule = getTargetModule(resolved);
    if (!targetModule) continue; // non-module target (shared/, etc.)

    if (targetModule === ownerModule) continue; // same module

    // cross-module import
    if (isComp) continue; // composition roots may deep-import

    // must be a barrel import
    if (!isBarrelImport(resolved, targetModule)) {
      violations.push({
        file: normalizePath(path.relative(ROOT, filePath)),
        specifier,
        targetModule,
        resolvedPath: normalizePath(path.relative(ROOT, resolved)),
      });
    }
  }

  return violations;
}

function main() {
  const files = getAllTsFiles(ROOT);
  const allViolations: Violation[] = [];

  for (const file of files) {
    allViolations.push(...checkFile(file));
  }

  if (allViolations.length === 0) {
    console.log('✓ No module boundary violations found.');
    process.exit(0);
  }

  console.error(`\n[boundary] ${allViolations.length} violation(s) found:\n`);
  for (const v of allViolations) {
    console.error(`  [boundary] ${v.file}`);
    console.error(`    imports "${v.specifier}"`);
    console.error(`    → target module: ${v.targetModule}`);
    console.error(`    → resolved path: ${v.resolvedPath}`);
    console.error(`    Expected: "@/${v.targetModule}" (barrel)\n`);
  }
  process.exit(1);
}

main();
