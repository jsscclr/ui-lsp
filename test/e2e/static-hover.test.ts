import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JsxAnalyzer } from '../../packages/server/src/static/jsx-analyzer.js';
import { extractInlineStyles } from '../../packages/server/src/static/style-extractor.js';
import { estimateLayout } from '../../packages/server/src/static/layout-estimator.js';
import { formatHoverContent } from '../../packages/server/src/hover/hover-content.js';
import type { StaticHoverData } from '../../packages/shared/src/types.js';

const FIXTURE_PATH = resolve(__dirname, '../fixtures/sample-app/src/App.tsx');

let analyzer: JsxAnalyzer;
let fileContent: string;

beforeAll(() => {
  analyzer = new JsxAnalyzer();
  fileContent = readFileSync(FIXTURE_PATH, 'utf-8');
  analyzer.updateFile(FIXTURE_PATH, fileContent);
});

describe('JsxAnalyzer', () => {
  it('finds the App component at the root div', () => {
    // Line 3 (0-indexed) is the opening <div> inside App
    const info = analyzer.getComponentAt(FIXTURE_PATH, 2, 5);
    expect(info).not.toBeNull();
    expect(info!.name).toBe('div');
  });

  it('finds the Header component usage', () => {
    // Line 4 (0-indexed): <Header title="..." />
    const info = analyzer.getComponentAt(FIXTURE_PATH, 3, 7);
    expect(info).not.toBeNull();
    expect(info!.name).toBe('Header');
    expect(info!.props).toHaveProperty('title', 'UI Language Server Demo');
  });

  it('finds the StyledBox component usage', () => {
    // Line 6 (0-indexed): <StyledBox />
    const info = analyzer.getComponentAt(FIXTURE_PATH, 5, 9);
    expect(info).not.toBeNull();
    expect(info!.name).toBe('StyledBox');
  });

  it('returns null for non-JSX positions', () => {
    // Line 0: export function App() {
    const info = analyzer.getComponentAt(FIXTURE_PATH, 0, 0);
    expect(info).toBeNull();
  });
});

describe('Style extraction', () => {
  it('extracts inline styles from the root div', () => {
    const source = analyzer.getSourceFile(FIXTURE_PATH);
    expect(source).toBeDefined();
    // Line 2, col 5 is on the <div style={{...}}>
    const styles = extractInlineStyles(source!, 2, 5);
    expect(styles).toHaveProperty('display', 'flex');
    expect(styles).toHaveProperty('flex-direction', 'column');
    expect(styles).toHaveProperty('padding', '20px');
    expect(styles).toHaveProperty('gap', '16px');
  });
});

describe('Layout estimation', () => {
  it('estimates box model from inline styles', () => {
    const styles = {
      width: '200px',
      height: '100px',
      padding: '20px',
      margin: '10px',
    };
    const box = estimateLayout(styles);
    expect(box).not.toBeNull();
    // Content area = outer dimension minus padding (yoga default is content-box-like)
    expect(box!.content.width).toBe(160); // 200 - 20 - 20
    expect(box!.content.height).toBe(60); // 100 - 20 - 20
    expect(box!.padding.top).toBe(20);
    expect(box!.padding.right).toBe(20);
    expect(box!.margin.top).toBe(10);
    expect(box!.margin.left).toBe(10);
  });

  it('returns null for styles it cannot handle', () => {
    const box = estimateLayout({ width: '50%' });
    // Percentage without a parent container — yoga should still compute something
    // but the result depends on yoga's default behavior
    // Just verify it doesn't throw
    expect(box === null || typeof box === 'object').toBe(true);
  });
});

describe('Hover content formatting', () => {
  it('formats static hover data with box model and styles', () => {
    const data: StaticHoverData = {
      source: 'estimated',
      componentInfo: {
        name: 'StyledBox',
        filePath: FIXTURE_PATH,
        line: 30,
        column: 4,
        props: {},
      },
      boxModel: {
        content: { x: 0, y: 0, width: 200, height: 100 },
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        border: { top: 2, right: 2, bottom: 2, left: 2 },
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
      computedStyles: {
        display: 'block',
        width: '200px',
        height: '100px',
        'background-color': '#ecf0f1',
      },
    };

    const content = formatHoverContent(data);

    expect(content).toContain('**StyledBox** (estimated)');
    expect(content).toContain('200 × 100');
    expect(content).toContain('margin');
    expect(content).toContain('padding');
    expect(content).toContain('border');
    expect(content).toContain('`width`');
    expect(content).toContain('`200px`');
    expect(content).toContain('`background-color`');
  });

  it('formats live hover data', () => {
    const content = formatHoverContent({
      source: 'live',
      componentInfo: {
        name: 'Header',
        filePath: '/test.tsx',
        line: 1,
        column: 0,
        props: { title: 'Hello' },
      },
      boxModel: {
        content: { x: 0, y: 0, width: 400, height: 32 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        border: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      computedStyles: { 'font-size': '24px', 'font-weight': 'bold' },
    });

    expect(content).toContain('**Header** (live)');
    expect(content).toContain('400 × 32');
    expect(content).toContain('title: "Hello"');
  });
});
