import { useEffect } from 'react';

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Sizzle` : 'Sizzle — Restaurant OS';
  }, [title]);
}
