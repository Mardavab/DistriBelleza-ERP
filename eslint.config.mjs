import nextConfig from 'eslint-config-next';
import tseslint from 'typescript-eslint';

export default [
  ...nextConfig,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      'no-duplicate-imports': 'error',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    ignores: [
      'node_modules/',
      '.next/',
      'scratch/',
      '__tests__/',
      '__mocks__/',
      '*.config.ts',
      '*.config.js',
    ],
  },
];
