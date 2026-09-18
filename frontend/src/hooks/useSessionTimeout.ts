import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/apiClient';

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const WARNING_THRESHOLD_MS = 10 * 60 * 1000;  // 10 minutes (5 min warning)
const THROTTLE_ACTIVITY_MS = 30 * 1000;       // 30 seconds throttle for passive events
const STORAGE_KEY = 'session_last_active';

export function useSessionTimeout() {
  const navigate = useNavigate();
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(300);
  const [isKeepingAlive, setIsKeepingAlive] = useState(false);

  const lastActivityReportRef = useRef<number>(Date.now());
  const lastBackendTouchRef = useRef<number>(Date.now());
  const isWarningRef = useRef<boolean>(false);

  // Keep ref synced
  useEffect(() => {
    isWarningRef.current = showWarning;
  }, [showWarning]);

  const handleLogoutDueToInactivity = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event('auth-change'));
    navigate('/login?reason=inactivity');
  }, [navigate]);

  const staySignedIn = useCallback(async () => {
    setIsKeepingAlive(true);
    try {
      await api.post('/auth/keep-alive');
      const now = Date.now();
      localStorage.setItem(STORAGE_KEY, now.toString());
      lastActivityReportRef.current = now;
      setShowWarning(false);
      setRemainingSeconds(300);
    } catch (err: any) {
      console.warn('Keep-alive failed:', err);
      if (err.response?.status === 401) {
        handleLogoutDueToInactivity();
      }
    } finally {
      setIsKeepingAlive(false);
    }
  }, [handleLogoutDueToInactivity]);

  const logoutNow = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.warn('Logout request failed:', err);
    } finally {
      const lastSlug = localStorage.getItem('last_org_slug');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event('auth-change'));
      if (lastSlug) {
        navigate(`/login/${lastSlug}`);
      } else {
        navigate('/portal-access');
      }
    }
  }, [navigate]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    // Initialize timestamp if missing
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
    }

    // Passive activity updater (throttled)
    const recordUserActivity = () => {
      // If warning modal is actively shown, require explicit click on "Stay Signed In"
      if (isWarningRef.current) return;

      const now = Date.now();
      if (now - lastActivityReportRef.current >= THROTTLE_ACTIVITY_MS) {
        lastActivityReportRef.current = now;
        localStorage.setItem(STORAGE_KEY, now.toString());
      }

      // Background touch sync: if user is active and >= 4 minutes elapsed since last backend ping, keep session alive
      if (now - lastBackendTouchRef.current >= 4 * 60 * 1000) {
        lastBackendTouchRef.current = now;
        api.post('/auth/keep-alive').catch(() => {});
      }
    };

    // Events to track passive activity
    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    activityEvents.forEach((evt) => {
      window.addEventListener(evt, recordUserActivity, { passive: true });
    });

    // Check timer status
    const checkSessionState = () => {
      const currentToken = localStorage.getItem('token');
      if (!currentToken) return;

      const storedTimeStr = localStorage.getItem(STORAGE_KEY);
      const lastActive = storedTimeStr ? parseInt(storedTimeStr, 10) : Date.now();
      const elapsed = Date.now() - lastActive;

      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        handleLogoutDueToInactivity();
      } else if (elapsed >= WARNING_THRESHOLD_MS) {
        const remainingMs = Math.max(0, INACTIVITY_TIMEOUT_MS - elapsed);
        setRemainingSeconds(Math.ceil(remainingMs / 1000));
        setShowWarning(true);
      } else {
        setShowWarning(false);
      }
    };

    // Run check state immediately and on an interval
    checkSessionState();
    const intervalId = setInterval(checkSessionState, 1000);

    // Multi-tab storage sync
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        checkSessionState();
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // Handle waking from sleep or switching tabs
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkSessionState();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', checkSessionState);

    return () => {
      clearInterval(intervalId);
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, recordUserActivity);
      });
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', checkSessionState);
    };
  }, [handleLogoutDueToInactivity]);

  return {
    showWarning,
    remainingSeconds,
    isKeepingAlive,
    staySignedIn,
    logoutNow,
  };
}
