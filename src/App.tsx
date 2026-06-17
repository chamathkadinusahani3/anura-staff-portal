import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import StaffPortal from './pages/DashboardPage';
import { SupervisorPage } from './pages/SupervisorPage';

const SUPERVISOR_ROLES = ['supervisor', 'super_admin'];

function AppRouter() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-[#FFD700] animate-spin"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
            strokeDasharray="40"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  if (SUPERVISOR_ROLES.includes(user.role)) {
    return <SupervisorPage />;
  }

  return <StaffPortal />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}