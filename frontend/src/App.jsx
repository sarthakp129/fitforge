import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, useNavigationType, useNavigate } from 'react-router-dom';
import useStore from './store/useStore.js';
import { api } from './lib/api.js';
import AppLayout from './layout/AppLayout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Landing from './components/Landing.jsx';
import NotFound from './pages/NotFound.jsx';
import { Toaster, Button, Card, Skeleton } from './components/ui.jsx';

const Dashboard = lazy(() => import('./components/Dashboard.jsx'));
const Training = lazy(() => import('./components/Training.jsx'));
const Nutrition = lazy(() => import('./components/Nutrition.jsx'));
const Progress = lazy(() => import('./components/Progress.jsx'));
const Settings = lazy(() => import('./components/Settings.jsx'));
const Onboarding = lazy(() => import('./components/Onboarding.jsx'));

function Loading() {
  return (
    <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 40px)' }}>
      <div className="wrap stack gap-16">
        <Skeleton h={36} w={300} />
        <div className="grid grid-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={116} r={18} />)}</div>
        <Skeleton h={300} r={18} />
      </div>
    </div>
  );
}

/** Scrolls to top on forward navigation; leaves scroll alone on Back (POP). */
function ScrollManager() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    if (type !== 'POP') window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname, type]);
  return null;
}

/** Logged-out visitors get the public site; app routes bounce to '/'. */
function RequireAuth() {
  const { token, user } = useStore();
  const location = useLocation();
  if (!token || !user) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Users without height/weight/birthdate must finish onboarding first. */
function OnboardingGuard() {
  const { profile } = useStore();
  const { pathname } = useLocation();
  const incomplete = !profile.weight_kg || !profile.height_cm || !profile.birth_date;
  if (incomplete && pathname !== '/onboarding' && pathname !== '/settings') {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}

/** '/' shows the public site, or jumps straight in when signed in. */
function HomeGate() {
  const { token, user } = useStore();
  return token && user ? <Navigate to="/dashboard" replace /> : <Landing />;
}

/** /login and /signup get real pages in V5; until then the landing page owns
 *  the auth card, so send people there (signed-in users go to the dashboard). */
function AuthGate() {
  const { token, user } = useStore();
  return token && user ? <Navigate to="/dashboard" replace /> : <Navigate to="/#access" replace />;
}

export default function App() {
  const { booted, boot, toasts, dismissToast } = useStore();
  const [apiDown, setApiDown] = React.useState(false);
  const { token } = useStore();

  useEffect(() => { boot(); }, [boot]);

  // Surface an unreachable API once, prominently, instead of per-request toasts.
  useEffect(() => {
    if (!booted || !token) return;
    api.health().then(() => setApiDown(false)).catch(() => setApiDown(true));
  }, [booted, token]);

  if (!booted) return <div className="app-bg" aria-hidden="true" />;

  return (
    <>
      <div className="app-bg" aria-hidden="true" />
      <ScrollManager />

      {apiDown && token && (
        <div className="wrap" style={{ paddingTop: 'calc(var(--nav-h) + 14px)' }}>
          <Card className="row gap-12" style={{ borderColor: 'rgba(251,191,36,0.35)', background: 'var(--amber-soft)' }}>
            <span className="chip chip-warn">API offline</span>
            <span className="small flex-1">
              The frontend cannot reach the backend. Start it with <span className="mono">docker compose up</span> or
              <span className="mono"> npm --prefix backend start</span>.
            </span>
            <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>Retry</Button>
          </Card>
        </div>
      )}

      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<HomeGate />} />
            <Route path="/login" element={<AuthGate />} />
            <Route path="/signup" element={<AuthGate />} />

            <Route element={<RequireAuth />}>
              <Route element={<OnboardingGuard />}>
                <Route element={<AppLayout />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/training" element={<Training />} />
                  <Route path="/nutrition" element={<Nutrition />} />
                  <Route path="/progress" element={<Progress />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/onboarding" element={<OnboardingShell />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

/** Onboarding sits inside the app chrome; finishing it lands on /dashboard. */
function OnboardingShell() {
  const navigate = useNavigate();
  return <Onboarding onDone={() => navigate('/dashboard')} />;
}
