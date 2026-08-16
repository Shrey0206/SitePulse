import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // The frontend has its own toolchain and its own tsconfig; this config is for the
    // backend, and pointing it at web/ would lint browser code with Node globals.
    ignores: ['dist/', 'node_modules/', 'web/'],
  },
  {
    rules: {
      // Express recognizes error-handling middleware by its 4-arg arity, so
      // an unused trailing `next` still has to be declared.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
