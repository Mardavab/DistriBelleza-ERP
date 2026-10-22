import nextConfig from 'eslint-config-next';
import tseslint from 'typescript-eslint';

/** Módulos de negocio independientes en modules/. No importan entre sí. */
const BUSINESS_MODULES = ['platform-admin', 'major-expenses', 'user-management'];

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
  // Frontera entre módulos de negocio: cada módulo de modules/ es independiente
  // de los demás por diseño. Puede importar de shared/, lib/ y app/, pero nunca
  // de otro módulo. Es lo que impide que vuelvan a acoplarse.
  ...BUSINESS_MODULES.map((own) => ({
    files: [`modules/${own}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: BUSINESS_MODULES.filter((o) => o !== own).flatMap((o) => [
                `**/${o}`,
                `**/${o}/**`,
              ]),
              message: `El módulo '${own}' no puede importar de otros módulos de negocio. Son independientes: usa shared/, lib/ o app/.`,
            },
          ],
        },
      ],
    },
  })),
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
