export function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '20px', gap: '16px' }}>
      <Header title="UI Language Server Demo" />
      <Card label="Box Model Example">
        <StyledBox />
      </Card>

      <Card label="Static Diagnostics">
        <FlexWithoutDisplay />
        <WidthWithFlex />
        <ConflictingDimensions />
      </Card>

      <Card label="Token Diagnostics (set tokensPath to tokens.json)">
        <TokenMatchColor />
        <TokenMatchSpacing />
      </Card>

      <Card label="Live Diagnostics (connect to Chrome)">
        <ZeroSizeElement />
        <OverflowExample />
        <InvisibleElement />
        <ClippedTextExample />
      </Card>

      <button>hello</button>
    </div>
  );
}

function Header({ title }: { title: string }) {
  return (
    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#1a1a2e' }}>
      {title}
    </h1>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px' }}>
      <h2 style={{ fontSize: '16px', marginBottom: '12px', color: '#555' }}>{label}</h2>
      {children}
    </div>
  );
}

function StyledBox() {
  return (
    <div
      style={{
        width: '200px',
        height: '100px',
        margin: '10px',
        padding: '20px',
        border: '2px solid #3498db',
        backgroundColor: '#ecf0f1',
      }}
    >
      Inspect me!
    </div>
  );
}

// ── Static diagnostic examples (fire on file open) ───────────────────

/** flexDirection without display:'flex' → "has no effect without display: flex" */
function FlexWithoutDisplay() {
  return (
    <div style={{ flexDirection: 'row', justifyContent: 'center', padding: '8px' }}>
      <span>I set flex properties but forgot display: flex</span>
    </div>
  );
}

/** width alongside flex:1 → "width may be ignored" */
function WidthWithFlex() {
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      <div style={{ flex: '1', width: '300px', padding: '8px', backgroundColor: '#ffeaa7' }}>
        flex: 1 with explicit width
      </div>
      <div style={{ flex: '1', padding: '8px', backgroundColor: '#dfe6e9' }}>
        flex: 1 only
      </div>
    </div>
  );
}

/** minWidth > width → "minWidth is larger than width" */
function ConflictingDimensions() {
  return (
    <div style={{ width: '100px', minWidth: '200px', padding: '8px', backgroundColor: '#fab1a0' }}>
      minWidth: 200 &gt; width: 100
    </div>
  );
}

// ── Live diagnostic examples (fire when connected to Chrome) ─────────

/** Renders at 0×0 — zero-size diagnostic */
function ZeroSizeElement() {
  return (
    <div>
      <span style={{ fontSize: '14px', color: '#636e72' }}>Zero-size child → </span>
      <div style={{ width: 0, height: 0, border: '1px solid red' }} />
    </div>
  );
}

/** Content overflows container — overflow diagnostic */
function OverflowExample() {
  return (
    <div style={{ width: '150px', height: '40px', border: '1px solid #6c5ce7' }}>
      <div style={{ whiteSpace: 'nowrap' as const }}>
        This text is way too long for a 150px container and will overflow horizontally
      </div>
    </div>
  );
}

/** Element hidden by opacity:0 — invisible diagnostic */
function InvisibleElement() {
  return (
    <div style={{ position: 'relative' as const, height: '30px' }}>
      <span style={{ fontSize: '14px', color: '#636e72' }}>Invisible box → </span>
      <div style={{ opacity: 0, width: '60px', height: '20px', backgroundColor: '#00b894' }}>
        hidden
      </div>
    </div>
  );
}

/** Text clipped with ellipsis — clipped-text diagnostic */
function ClippedTextExample() {
  return (
    <div
      style={{
        width: '120px',
        overflow: 'hidden' as const,
        textOverflow: 'ellipsis' as const,
        whiteSpace: 'nowrap' as const,
        border: '1px solid #fdcb6e',
        padding: '4px',
      }}
    >
      This long sentence is clipped with an ellipsis
    </div>
  );
}

// ── Token diagnostic examples (set uiLanguageServer.tokensPath) ──────

/** color matches tokens.colors.primary → "matches design token 'colors.primary'" */
function TokenMatchColor() {
  return (
    <div style={{ color: 'rgb(26, 115, 232)', padding: '8px' }}>
      This text uses a hardcoded color that matches a design token
    </div>
  );
}

/** padding matches tokens.spacing.medium → "matches design token 'spacing.medium'" */
function TokenMatchSpacing() {
  return (
    <div style={{ padding: '16px', backgroundColor: 'rgb(236, 240, 241)' }}>
      This box uses a hardcoded spacing value that matches a design token
    </div>
  );
}
