import { useState } from 'react';
import {
  ExternalLink,
  Laptop,
  Smartphone,
  Download,
  Check,
  Share2,
  ShieldAlert,
  ArrowRight,
  Flame,
  Armchair,
  CreditCard,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Modal, Button } from './ui';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { useAuth } from '../store/auth';
import { downloadDesktopShortcut, downloadWindowsAppLauncher } from '../lib/installShortcuts';

export interface OperationsAppModalProps {
  open: boolean;
  onClose: () => void;
  slug?: string;
  qrDataUrl?: string;
}

export const OPERATIONS_SYSTEMS = [
  {
    id: 'kitchen',
    name: 'Kitchen System Dashboard',
    role: 'KITCHEN / COOK',
    url: '/kds',
    iconSrc: '/icons/kitchen-icon.svg',
    fallbackIcon: Flame,
    color: 'from-amber-500 to-orange-600',
    accentText: 'text-amber-600',
    accentBg: 'bg-amber-50 border-amber-200',
    description: 'Cook’s live ticket rail, course-by-course firing, veg / non-veg separation, and prep timer.',
  },
  {
    id: 'waiter',
    name: 'Waiter System Dashboard',
    role: 'WAITER / FLOOR',
    url: '/floor',
    iconSrc: '/icons/waiter-icon.svg',
    fallbackIcon: Armchair,
    color: 'from-blue-500 to-indigo-600',
    accentText: 'text-blue-600',
    accentBg: 'bg-blue-50 border-blue-200',
    description: 'Interactive floor plan, instant table seating, order-taking, bill requests, and guest assistance.',
  },
  {
    id: 'cashier',
    name: 'Cashier Dashboard',
    role: 'CASHIER / POS',
    url: '/pos',
    iconSrc: '/icons/cashier-icon.svg',
    fallbackIcon: CreditCard,
    color: 'from-emerald-500 to-green-600',
    accentText: 'text-emerald-600',
    accentBg: 'bg-emerald-50 border-emerald-200',
    description: 'Instant bill settlement, dynamic UPI QR payments, cash drawer tracking, and split payments.',
  },
  {
    id: 'owner',
    name: 'Owner & Manager Dashboard',
    role: 'OWNER / MANAGER',
    url: '/app',
    iconSrc: '/icons/owner-icon.svg',
    fallbackIcon: ShieldCheck,
    color: 'from-purple-500 to-violet-600',
    accentText: 'text-purple-600',
    accentBg: 'bg-purple-50 border-purple-200',
    description: 'Full restaurant operations: live sales telemetry, menu pricing, inventory, staff, and audit trails.',
  },
];

export function OperationsAppModal({ open, onClose, slug, qrDataUrl }: OperationsAppModalProps) {
  const { user } = useAuth();
  const { canInstall, promptInstall, installed, needsManualInstall } = useInstallPrompt();
  const [platform, setPlatform] = useState<'computer' | 'mobile'>('computer');

  function openSystem(path: string) {
    window.open(path, '_blank');
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Operations App & Dashboard Launcher"
      width="max-w-3xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <p className="text-[12px] text-ink-500">
            {user ? `Signed in as ${user.name} (${user.role})` : 'Requires verified staff credentials'}
          </p>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Security / Internal Only Notice */}
        <div className="flex items-start gap-3 rounded-xl border border-ember-200 bg-ember-50/80 p-3.5 text-ember-900">
          <ShieldAlert size={20} className="mt-0.5 shrink-0 text-ember-600" />
          <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
            <span className="font-bold">Strictly Restricted to Operations & Staff.</span> Customers are prohibited from
            accessing these dashboards. Guest food ordering and table booking must be accessed through the public guest
            app.
          </div>
        </div>

        {/* Download & Installation Section (Computer & Mobile) */}
        <div className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 pb-3">
            <div>
              <h3 className="flex items-center gap-2 font-display text-[15px] font-bold text-ink-900">
                <Sparkles size={16} className="text-ember-500" />
                Download & Install Web-Based App Icon
              </h3>
              <p className="text-[12px] text-ink-500">
                Install as a standalone app on your computer desktop or mobile home screen.
              </p>
            </div>
            <div className="flex rounded-lg bg-ink-200/60 p-0.5 text-[12px] font-semibold">
              <button
                type="button"
                onClick={() => setPlatform('computer')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 transition-all ${
                  platform === 'computer' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                <Laptop size={14} /> Computer
              </button>
              <button
                type="button"
                onClick={() => setPlatform('mobile')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 transition-all ${
                  platform === 'mobile' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                <Smartphone size={14} /> Mobile
              </button>
            </div>
          </div>

          <div className="mt-3.5 flex flex-col gap-4 sm:flex-row sm:items-center">
            {qrDataUrl && (
              <div className="flex shrink-0 flex-col items-center justify-center rounded-xl border border-ink-200 bg-white p-2.5 shadow-sm">
                <img src={qrDataUrl} alt="Staff QR" className="h-24 w-24 object-contain" />
                <span className="mt-1 text-[10.5px] font-medium text-ink-500">Scan from Phone</span>
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-2">
              {platform === 'computer' ? (
                <div>
                  <h4 className="text-[13px] font-bold text-ink-800">Computer Desktop App (Windows / Mac)</h4>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-600">
                    Running in Chrome, Edge, or Brave: click the <span className="font-semibold">Install icon</span> in
                    your browser address bar (top-right) or use the buttons below to install/download desktop launchers.
                  </p>
                </div>
              ) : (
                <div>
                  <h4 className="text-[13px] font-bold text-ink-800">Mobile App Icon (iOS / Android)</h4>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-600">
                    Scan the QR code with your phone camera, then tap <span className="font-semibold">Share → Add to Home Screen</span> (iOS)
                    or <span className="font-semibold">Install App</span> (Android) for full-screen touch operation.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {canInstall && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Download size={14} />}
                    onClick={() => void promptInstall()}
                  >
                    Install Browser App Icon
                  </Button>
                )}
                {platform === 'computer' && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Laptop size={14} />}
                      onClick={() => downloadWindowsAppLauncher('Sizzle-Operations-OS', '/staff.html')}
                    >
                      Download Desktop Launcher (.bat)
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ExternalLink size={13} />}
                      onClick={() => downloadDesktopShortcut('Sizzle Operations OS', '/staff.html')}
                    >
                      Download Desktop Shortcut (.url)
                    </Button>
                  </>
                )}
              </div>

              {installed && (
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-leaf-700">
                  <Check size={14} /> App already installed on this device
                </div>
              )}
              {needsManualInstall && (
                <div className="flex items-center gap-1.5 text-[12px] text-ink-600">
                  <Share2 size={13} className="text-ember-600" /> Tap Share and select "Add to Home Screen"
                </div>
              )}
            </div>
          </div>
        </div>

        {/* The 4 Operational Dashboards Grid */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-[15px] font-bold text-ink-900">
              The 4 Operations Dashboards
            </h3>
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
              Direct Web Launchers
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {OPERATIONS_SYSTEMS.map((sys) => {
              const Icon = sys.fallbackIcon;
              return (
                <div
                  key={sys.id}
                  className="flex flex-col justify-between rounded-xl border border-ink-200 bg-white p-3.5 shadow-sm transition-all hover:border-ink-300 hover:shadow-md"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={sys.iconSrc}
                          alt={sys.name}
                          className="h-10 w-10 shrink-0 rounded-xl shadow-sm"
                          onError={(e) => {
                            // Fallback to SVG div if image fails
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                          }}
                        />
                        <div
                          className={`hidden grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${sys.color} text-white shadow-sm`}
                        >
                          <Icon size={20} />
                        </div>
                        <div>
                          <h4 className="text-[13.5px] font-bold text-ink-900 leading-snug">{sys.name}</h4>
                          <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${sys.accentBg} ${sys.accentText}`}>
                            {sys.role}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="text-[12px] leading-relaxed text-ink-500">{sys.description}</p>
                  </div>

                  <div className="mt-3.5 flex items-center justify-between border-t border-ink-100 pt-2.5">
                    <span className="font-mono text-[11px] text-ink-400">{sys.url}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1.5 text-[12px] hover:border-ember-400 hover:text-ember-700"
                      onClick={() => openSystem(sys.url)}
                    >
                      <span>Open</span>
                      <ExternalLink size={12} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Accidental customer redirect */}
        <div className="flex items-center justify-between rounded-xl bg-ink-100/70 px-3.5 py-2.5 text-[12px] text-ink-600">
          <span>Are you a guest looking for food or dining?</span>
          <a
            href={slug ? `/eat/${slug}` : '/eat'}
            className="flex items-center gap-1 font-bold text-ember-600 hover:underline"
          >
            <span>Customer Food Menu</span>
            <ArrowRight size={13} />
          </a>
        </div>
      </div>
    </Modal>
  );
}
