const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let pathname;
function AuthForm() {}
const source = ts.transpileModule(fs.readFileSync(path.join(root, 'components/AuthRouteShell.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exportsObject = {};
new Function('exports', 'require', source)(exportsObject, name => {
  if (name === 'next/navigation') return { usePathname: () => pathname };
  if (name === '@/components/AuthForm') return { default: AuthForm };
  if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }) };
  throw Error('Unexpected import ' + name);
});
const shell = exportsObject.default;

test('login and registration share one unkeyed AuthForm identity while changing its mode', () => {
  pathname = '/login';
  const login = shell({ children: 'login route content' });
  pathname = '/register';
  const register = shell({ children: 'register route content' });
  assert.equal(login.type, AuthForm);
  assert.equal(register.type, login.type);
  assert.equal(login.key, undefined);
  assert.equal(register.key, login.key);
  assert.equal(login.props.mode, 'login');
  assert.equal(register.props.mode, 'register');
});

test('dashboard, trip and invitation routes keep their original page content', () => {
  for (const route of ['/', '/trips', '/trips/new', '/trips/trip-one', '/join/INVITATION', '/login/help', null]) {
    pathname = route;
    const children = { page: route };
    assert.equal(shell({ children }), children, String(route));
  }
});
