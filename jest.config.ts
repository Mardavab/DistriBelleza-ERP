import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  // Excluir Playwright e2e tests — esos los corre `npx playwright test`.
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.svg$': '<rootDir>/__mocks__/fileMock.js',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        allowJs: true,
        strict: false,
      }
    }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!lucide-react|@supabase)/',
  ],
};

export default config;
