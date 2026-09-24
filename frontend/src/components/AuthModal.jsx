import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import SiyasatLogo from './SiyasatLogo';

const AuthModal = ({ isOpen = true, onClose, onLoginSuccess, API_BASE = (process.env.REACT_APP_API_URL || 'https://siyasat-backend.onrender.com/api') }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setIsLoading(true);

    const baseUrl = process.env.REACT_APP_API_URL || 'https://siyasat-backend.onrender.com/api';
    // Ensure we don't end up with /api/api/auth/login or missing segments
    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const endpoint = cleanBaseUrl.endsWith('/api') ? `${cleanBaseUrl}/auth/login` : `${cleanBaseUrl}/api/auth/login`;
    const payload = { email, password };

    try {
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Check if response is actually JSON before parsing
      const contentType = response.headers.get('content-type');
      let data = {};
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        throw new Error(`Server returned status ${response.status}. Check your backend Express auth route URL.`);
      }

      if (!response.ok) {
        throw new Error(data.message || 'Authentication failed. Please check your inputs.');
      }

      const roleStr = data.user?.role || 'User';
      setSuccessMsg(`Authenticating session... Redirecting to ${roleStr} portal...`);
      
      setTimeout(() => {
        onLoginSuccess(data.token, data.user);
      }, 2000);
      
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-8">
      <div className="relative w-full max-w-5xl bg-[#800000] rounded-3xl shadow-2xl overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[580px] border border-white/10">
        <button onClick={onClose} className="absolute top-4 right-4 md:top-6 md:right-6 z-20 text-slate-400 hover:text-slate-700 bg-white p-2 rounded-full shadow-md cursor-pointer">
          ✕
        </button>

        <div className="md:col-span-5 relative flex flex-col justify-center items-center text-center p-8 text-white bg-[#800000]">
          <div className="relative z-10 space-y-4">
            <div className="flex justify-center mb-2">
              <SiyasatLogo variant="white" size="lg" />
            </div>
            <h2 className="text-xl md:text-2xl font-bold">A Research and Thesis Repository with AI Gap Analysis Tool</h2>
          </div>
        </div>

        <div className="md:col-span-7 bg-white p-8 md:p-12 flex flex-col justify-between">
          <div>
            <div className="border-b-2 border-[#800000] pb-2 mb-6">
              <h2 className="text-3xl font-bold text-[#800000]">Log In</h2>
            </div>

            <p className="text-[#800000] text-sm font-medium mb-8">Hello! Please put your details to continue</p>

            {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">{error}</div>}

            {successMsg ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-5">
                <Loader2 className="w-10 h-10 text-[#800000] animate-spin" />
                <p className="text-[#800000] font-bold text-center text-sm">{successMsg}</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="relative">
                  <input type="email" required id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder=" " className="peer w-full px-4 py-3 rounded-xl border border-gray-400 text-gray-800 focus:outline-none focus:border-[#800000] text-sm bg-transparent" />
                  <label htmlFor="email" className="absolute left-3 -top-2.5 bg-white px-2 text-xs font-bold text-[#800000]">Email</label>
                </div>

                <div className="relative">
                  <input type="password" required id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder=" " className="peer w-full px-4 py-3 rounded-xl border border-gray-400 text-gray-800 focus:outline-none focus:border-[#800000] text-sm bg-transparent" />
                  <label htmlFor="password" className="absolute left-3 -top-2.5 bg-white px-2 text-xs font-bold text-[#800000]">Password</label>
                </div>

                <button type="submit" disabled={isLoading} className="w-full py-3 bg-[#F5B842] text-[#800000] font-bold text-base rounded-xl border border-[#d99e2b] shadow-sm cursor-pointer mt-4">
                  {isLoading ? 'Processing...' : 'Log In'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;