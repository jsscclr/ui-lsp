export function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '20px', gap: '16px' }}>
      <Header title="UI Language Server Demo" />
      <Card label="Box Model Example">
        <StyledBox />
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
