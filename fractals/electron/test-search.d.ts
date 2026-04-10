/**
 * Exhaustive search test cases — run with:
 *   cd fractals && npx tsx electron/test-search.ts
 *
 * Tests the space-aware FTS query builder logic (no DB required).
 */
declare const anyAscii: (s: string) => string;
declare function normalizeForSearch(text: string): string;
declare function buildFtsQuery(rawQuery: string): string | null;
interface TestCase {
    input: string;
    description: string;
    expectedFts: string;
}
declare const tests: TestCase[];
declare let passed: number;
declare let failed: number;
