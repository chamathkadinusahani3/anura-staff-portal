import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface StaffUser {
  id:       string;
  name:     string;
  role:     string;
  branch:   string;
  username: string;
}

interface AuthContextType {
  user:    StaffUser | null;
  token:   string | null;
  loading: boolean;
  login:   (username: string, password: string) => Promise<void>;
  logout:  () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null, token: null, loading: true,
  login: async () => {}, logout: () => {},
});

const TOKEN_KEY = 'anura_staff_token';
const USER_KEY  = 'anura_staff_user';

const API = (import.meta.env.VITE_API_URL || 'https://anuratyres-backend-emm1774.vercel.app/api')
  .replace(/\/api$/, '');

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<StaffUser | null>(null);
  const [token,   setToken]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      const savedUser  = localStorage.getItem(USER_KEY);
      if (savedToken && savedUser) {
        // Check token expiry by decoding payload (no library needed)
        const payload = JSON.parse(atob(savedToken.split('.')[1]));
        if (payload.exp * 1000 > Date.now()) {
          setToken(savedToken);
          setUser(JSON.parse(savedUser));
        } else {
          // Token expired — clear it
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        }
      }
    } catch {
      // Corrupted data — clear
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res  = await fetch(`${API}/api/staff?action=login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: username.trim().toLowerCase(), password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invalid credentials');

    // Persist to localStorage
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY,  JSON.stringify(data.staff));

    setToken(data.token);
    setUser(data.staff);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}