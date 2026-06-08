import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Scanner from './pages/Scanner';
import AdminStudio from './pages/AdminStudio';
import Login from './pages/Login';
import AuthGuard from './components/AuthGuard';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        
        <Route path="/scan" element={
          <AuthGuard>
            <Scanner />
          </AuthGuard>
        } />
        
        {/* The hidden admin route as requested */}
        <Route path="/admin" element={
          <AuthGuard requireAdmin={true}>
            <AdminStudio />
          </AuthGuard>
        } />
        
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
