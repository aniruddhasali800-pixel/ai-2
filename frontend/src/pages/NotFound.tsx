import { Link } from 'react-router-dom';
import { Flame } from 'lucide-react';

export function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-100 px-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-ember-500 text-white">
          <Flame size={22} />
        </span>
        <p className="font-display text-[13px] font-700 uppercase tracking-[0.18em] text-ember-600">404</p>
        <h1 className="mt-1 font-display text-2xl font-800 tracking-tight text-ink-900">This page burned off the pass</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          The link you followed no longer exists. If you scanned a table code, ask your waiter to reshare the menu.
        </p>
        <Link
          to="/login"
          className="mt-6 inline-flex h-10 items-center rounded-[10px] border border-ember-600/40 bg-ember-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-ember-600"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
