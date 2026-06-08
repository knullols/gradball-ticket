import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="app-shell" style={{ display: 'grid', placeItems: 'center', height: '100vh', padding: '20px' }}>
      <div className="backdrop backdrop-left" />
      <div className="backdrop backdrop-right" />

      <header style={{ display: 'flex', flexDirection: 'column', textAlign: 'center', padding: '40px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '30px', border: '1px solid rgba(255, 214, 117, 0.15)', backdropFilter: 'blur(20px)', maxWidth: '600px', width: '100%', zIndex: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
          <div className="badge-row" style={{ justifyContent: 'center' }}>
            <span className="badge">Graduating Council</span>
            <span className="badge badge-muted">Field Scanner Edition</span>
          </div>
          <h1 style={{ fontSize: '3.5rem', marginBottom: '16px' }}>Nocturne</h1>
          <p style={{ fontSize: '1.1rem', marginBottom: '40px' }}>
            Fast, secure, and beautiful QR code validation for your events. Access your live database directly from GitHub and scan tickets seamlessly.
          </p>
          
          <button 
            className="primary-button" 
            style={{ fontSize: '1.25rem', padding: '16px 40px', borderRadius: '99px', boxShadow: '0 8px 32px rgba(255, 214, 117, 0.25)' }}
            onClick={() => navigate('/scan')}
          >
            Open Scanner
          </button>
        </div>
      </header>
    </div>
  );
}
