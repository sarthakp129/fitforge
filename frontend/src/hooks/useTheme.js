import { useEffect, useState } from 'react';

const STORAGE_KEY = 'fitforge-theme';

export function getSystemTheme() {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === 'undefined') return 'system';
    return localStorage.getItem(STORAGE_KEY) || 'system';
  });

  const [resolvedTheme, setResolvedTheme] = useState(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved === 'dark' || saved === 'light') return saved;
    return getSystemTheme();
  });

  useEffect(() => {
    const applyTheme = (t) => {
      const resolved = t === 'system' ? getSystemTheme() : t;
      setResolvedTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    };

    applyTheme(theme);

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };

    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = (next) => {
    setThemeState(next);
    if (next === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
  };

  const toggleTheme = () => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  };

  return { theme, resolvedTheme, setTheme, toggleTheme };
}

export default useTheme;
