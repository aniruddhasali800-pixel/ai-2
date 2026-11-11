import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, FolderOpen, LogIn } from 'lucide-react';
import { http } from '../lib/api';
import { useAuth } from '../store/auth';
import { Button, Modal } from './ui';

/** Asked once per browser: what is new on a first launch is this machine, not the account. */
const ASKED_KEY = 'sizzle.first-run-asked';

/** Only the staff side of the app opens restaurants. A guest at a table must never be asked to become an owner. */
const OWNER_PATHS = new Set(['/', '/login', '/app', '/kds', '/floor', '/pos']);

function isStaffEntry(pathname: string): boolean {
  return OWNER_PATHS.has(pathname) || pathname.startsWith('/app/');
}

/**
 * The first screen a new machine shows: an offer to open a restaurant here, with the folder the records
 * will live in named up front, because on this build that folder *is* the database.
 */
export function FirstRun() {
  const { user, ready } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [asked, setAsked] = useState(() => localStorage.getItem(ASKED_KEY) === 'yes');
  const [folder, setFolder] = useState<string | null>(null);

  useEffect(() => {
    if (pathname.startsWith('/register')) done();
  }, [pathname]);

  useEffect(() => {
    http
      .get<{ dataFolder?: string }>('/health')
      .then(({ data }) => setFolder(data.dataFolder ?? null))
      .catch(() => undefined);
  }, []);

  function done() {
    localStorage.setItem(ASKED_KEY, 'yes');
    setAsked(true);
  }

  function start(path: string) {
    done();
    navigate(path);
  }

  if (asked || !ready || user || !isStaffEntry(pathname)) return null;

  return (
    <Modal
      open
      onClose={() => start('/login')}
      width="max-w-md"
      title="Start a new restaurant account"
      subtitle="Nothing has been set up on this machine yet."
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Button variant="secondary" className="grow" icon={<LogIn size={15} />} onClick={() => start('/login')}>
            Sign in to an existing one
          </Button>
          <Button variant="primary" className="grow" icon={<ArrowRight size={15} />} onClick={() => start('/register')}>
            Start a restaurant
          </Button>
        </div>
      }
    >
      <p className="text-[13.5px] leading-relaxed text-ink-600">
        A new account gets its own name, menu, tables, staff and day-by-day reports. The first owner account you create
        runs it.
      </p>
      <div className="mt-4 rounded-xl border border-ink-200 bg-ink-50/60 p-3.5">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-ink-500">
          <FolderOpen size={13} className="text-ember-600" /> Where the records live
        </p>
        {folder && (
          <p className="mt-2 break-all font-mono text-[12px] leading-snug text-ink-800">{folder}</p>
        )}
        <ul className="mt-2.5 space-y-1 text-[12.5px] text-ink-600">
          <li>Bills and orders are written to disk the moment they happen.</li>
          <li>Menus, tables, stock and staff are saved when you press Save.</li>
          <li>Each finished day closes itself into a report you can open or print.</li>
        </ul>
      </div>
    </Modal>
  );
}
