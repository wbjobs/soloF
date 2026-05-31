const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const fs = require('fs');
const path = require('path');

function parseFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();

  const plugins = ['jsx', 'decorators-legacy', 'classProperties', 'classPrivateProperties', 'classPrivateMethods'];
  if (ext === '.ts' || ext === '.tsx') {
    plugins.push('typescript');
  }
  if (ext === '.jsx' || ext === '.tsx') {
    plugins.push('jsx');
  }

  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: plugins,
      errorRecovery: true,
      allowImportExportEverywhere: true,
      allowUndeclaredExports: true
    });
  } catch (e) {
    return {
      file: filePath,
      error: e.message,
      imports: [],
      exports: [],
      reexports: [],
      dynamicImports: []
    };
  }

  const imports = [];
  const exports = [];
  const reexports = [];
  const dynamicImports = [];

  traverse(ast, {
    ImportDeclaration(path) {
      const source = path.node.source.value;
      const specifiers = path.node.specifiers.map(s => {
        if (s.type === 'ImportDefaultSpecifier') {
          return { type: 'default', local: s.local.name };
        } else if (s.type === 'ImportNamespaceSpecifier') {
          return { type: 'namespace', local: s.local.name };
        } else if (s.type === 'ImportSpecifier') {
          return {
            type: 'named',
            imported: s.imported.name || s.imported.value,
            local: s.local.name
          };
        }
        return { type: 'unknown' };
      });
      imports.push({ source, specifiers });
    },

    ExportNamedDeclaration(path) {
      if (path.node.source) {
        const source = path.node.source.value;
        const specifiers = path.node.specifiers.map(s => ({
          exported: s.exported.name || s.exported.value,
          local: s.local ? s.local.name : null
        }));
        reexports.push({ source, specifiers });
      } else {
        const specifiers = [];
        if (path.node.declaration) {
          const decl = path.node.declaration;
          if (decl.type === 'FunctionDeclaration' && decl.id) {
            specifiers.push({ name: decl.id.name, type: 'function' });
          } else if (decl.type === 'ClassDeclaration' && decl.id) {
            specifiers.push({ name: decl.id.name, type: 'class' });
          } else if (decl.type === 'VariableDeclaration') {
            decl.declarations.forEach(d => {
              if (d.id.type === 'Identifier') {
                specifiers.push({ name: d.id.name, type: 'variable' });
              } else if (d.id.type === 'ObjectPattern') {
                d.id.properties.forEach(p => {
                  if (p.value.type === 'Identifier') {
                    specifiers.push({ name: p.value.name, type: 'variable' });
                  }
                });
              }
            });
          } else if (decl.type === 'TSEnumDeclaration' && decl.id) {
            specifiers.push({ name: decl.id.name, type: 'enum' });
          } else if (decl.type === 'TSInterfaceDeclaration' && decl.id) {
            specifiers.push({ name: decl.id.name, type: 'interface' });
          } else if (decl.type === 'TSTypeAliasDeclaration' && decl.id) {
            specifiers.push({ name: decl.id.name, type: 'type' });
          }
        }
        path.node.specifiers.forEach(s => {
          specifiers.push({ name: s.exported.name || s.exported.value, type: 'specifier' });
        });
        if (specifiers.length > 0) {
          exports.push({ specifiers });
        }
      }
    },

    ExportDefaultDeclaration(path) {
      exports.push({ default: true });
    },

    ExportAllDeclaration(path) {
      if (path.node.source) {
        reexports.push({ source: path.node.source.value, all: true });
      }
    },

    CallExpression(path) {
      if (
        path.node.callee.type === 'Import' ||
        (path.node.callee.type === 'MemberExpression' &&
          path.node.callee.object.type === 'Import')
      ) {
        const arg = path.node.arguments[0];
        if (arg && (arg.type === 'StringLiteral' || arg.type === 'TemplateLiteral')) {
          const source = arg.type === 'StringLiteral'
            ? arg.value
            : (arg.quasis[0]?.value?.raw || '');
          if (source) {
            dynamicImports.push({ source });
          }
        }
      }
      if (
        path.node.callee.type === 'Identifier' &&
        path.node.callee.name === 'require' &&
        path.node.arguments.length > 0
      ) {
        const arg = path.node.arguments[0];
        if (arg.type === 'StringLiteral') {
          imports.push({ source: arg.value, specifiers: [{ type: 'require' }], isRequire: true });
        }
      }
    }
  });

  return {
    file: filePath,
    imports,
    exports,
    reexports,
    dynamicImports
  };
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node parse.js <file-path>');
  process.exit(1);
}

try {
  const result = parseFile(filePath);
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
}
