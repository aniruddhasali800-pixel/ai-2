import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Download, MapPin, Store } from 'lucide-react';
import { useQuery } from '../../lib/query';
import { mediaUrl } from '../../lib/api';
import type { AppRestaurant } from '../../lib/types';
import { listTracked, forgetTracked } from '../../lib/tracked';
import { stageShortLabel } from '../../lib/statusMaps';
import { timeAgo } from '../../lib/format';
import { MerchantMark, Spinner } from '../../components/ui';
import { toast } from '../../store/toasts';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { useTitle } from '../../hooks/useTitle';

/** What the installed app opens onto: the kitchens you can order from, and your live tickets. */
export function AppLanding() {
  const { data: restaurants, loading } = useQuery<AppRestaurant[]>('app:restaurants', '/public/apps/restaurants');
  const [saved, setSaved] = useState(listTracked);
  const anchor = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { canInstall, promptInstall, installed } = useInstallPrompt();

  useTitle('Sizzle · Order food');

  useEffect(() => {
    if (location.hash === '#track') anchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  return (
    <div className="min-h-screen bg-ink-50 pb-12">
      <header className="bg-ink-900 px-4 pb-14 pt-5 text-white">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <MerchantMark name="Sizzle" logoSrc="/icons/favicon.svg" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="font-display text-[17px] font-800">Sizzle</p>
            <p className="truncate text-[11.5px] text-ink-400">Order in from the kitchens near you</p>
          </div>
          {canInstall && (
            <button
              onClick={() => void promptInstall()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ember-500 px-2.5 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-ember-600"
            >
              <Download size={13} /> Install
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto -mt-10 max-w-md space-y-3 px-4">
        {loading && !restaurants ? (
          <Spinner label="Finding kitchens…" />
        ) : !restaurants?.length ? (
          <div className="card p-6 text-center">
            <Store size={24} className="mx-auto mb-2 text-ink-300" />
            <p className="text-[13.5px] font-semibold text-ink-900">No kitchen is on Sizzle yet</p>
            <p className="mt-1 text-[12.5px] text-ink-500">Ask the restaurant to scan its own QR — the menu appears here.</p>
          </div>
        ) : (
          restaurants.map((r) => (
            <Link
              key={r.slug}
              to={`/eat/${r.slug}`}
              className="card flex items-start gap-3 p-4 transition-[transform,box-shadow] hover:shadow-md active:scale-[0.995]"
            >
              <MerchantMark name={r.name} logoSrc={r.logoUrl ? mediaUrl(r.logoUrl) : undefined} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[16.5px] font-800 text-ink-900">{r.name}</span>
                <span className="mt-0.5 block truncate text-[12.5px] text-ink-500">{r.tagline || r.line1 || 'On Sizzle'}</span>
                <span className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-ink-400">
                  <MapPin size={11} /> {r.city || 'Pune'}
                  {!r.acceptingOrders && <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 ring-1 ring-amber-200">Kitchen resting</span>}
                </span>
              </span>
              <ChevronRight size={16} className="mt-3 shrink-0 text-ink-300" />
            </Link>
          ))
        )}

        <div ref={anchor} id="track" className="pt-2">
          <h2 className="label">Your orders</h2>
          {!saved.length ? (
            <p className="rounded-2xl bg-white px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-500 ring-1 ring-ink-200">
              Nothing to track yet. Every order you place keeps its own live link here — status, rider and bill.
              {installed ? '' : ' Install the app and this screen opens on its own.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {saved.map((t) => {
                return (
                  <li key={t.token} className="card flex items-center gap-3 p-3.5">
                    <Link to={`/track/${t.token}`} className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-ink-900">
                        {t.orderNumber} · <span className="font-normal text-ink-500">{timeAgo(t.at)}</span>
                      </p>
                      <p className="text-[12px] text-ink-500">{stageShortLabel(t.status, t.fulfilment)}</p>
                    </Link>
                    <button
                      onClick={() => {
                        forgetTracked(t.token);
                        setSaved(listTracked());
                        toast(`Stopped tracking ${t.orderNumber}`, 'success');
                      }}
                      className="shrink-0 text-[11.5px] font-semibold text-ink-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="pt-2 text-center text-[11.5px] leading-relaxed text-ink-500">
          Dining in? Scan the QR on your table — that puts the menu and the bill on your phone for this seat.
          <br />
          <Link to="/login" className="font-semibold text-ember-600 underline-offset-2 hover:underline">
            Staff and kitchen sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
