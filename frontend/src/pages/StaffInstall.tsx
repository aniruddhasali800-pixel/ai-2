import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ExternalLink,
  Laptop,
  Smartphone,
  Download,
  Check,
  Share2,
  ShieldAlert,
  ArrowRight,
  Sparkles,
  LogIn,
  Briefcase,
  Monitor,
} from 'lucide-react';
import { Brand } from '../layouts/AppShell';
import { Button, Modal } from '../components/ui';
import { useAuth } from '../store/auth';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { useTitle } from '../hooks/useTitle';
import { homeFor } from './Login';
import { OPERATIONS_SYSTEMS } from '../components/OperationsAppModal';
import { downloadDesktopShortcut, downloadWindowsAppLauncher } from '../lib/installShortcuts';

/**
 * Operations App & 4 Dashboards Launcher.
 * This is what opens when scanning the Staff QR code or navigating to /staff.html.
 * Dedicated strictly to internal restaurant operations (NOT FOR CUSTOMERS).
 */
export function StaffInstall() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const slug = params.get('r') ?? '';
  const { canInstall, promptInstall, installed, needsManualInstall } = useInstallPrompt();
  const [platform, setPlatform] = useState<'computer' | 'mobile'>('computer');
  // Auto-appears when opening the page so the user can immediately install with one click
  const [installModalOpen, setInstallModalOpen] = useState(true);

  useTitle('Sizzle Operations OS — Staff Dashboards');

  function openSystem(url: string) {
    window.location.href = url;
  }

  return (
    <div className="min-h-screen bg-ink-50 pb-16">
      {/* Header */}
      <header className="bg-ink-950 px-4 pb-20 pt-6 text-white shadow-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <Brand light />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ember-500/20 px-3 py-1 text-[12px] font-bold text-ember-300 ring-1 ring-ember-500/30">
            <Sparkles size={13} />
            Operations OS
          </span>
        </div>
        <div className="mx-auto mt-8 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1 text-[12px] font-semibold text-ink-300">
            <span>Staff &amp; Operations Only</span>
          </div>
          <h1 className="mt-3 font-display text-[32px] font-800 leading-[1.1] tracking-tight sm:text-[38px]">
            The 4 Operational Systems in One App
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-300 sm:text-[15px]">
            Install the web-based app icon on your computer or mobile device to launch the Kitchen System, Waiter System,
            Cashier Till, and Owner Dashboard.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <Button
              variant="primary"
              size="md"
              icon={<Download size={16} />}
              onClick={() => setInstallModalOpen(true)}
              className="shadow-lg shadow-ember-500/25"
            >
              Install Operations OS
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<Laptop size={15} />}
              onClick={() => downloadWindowsAppLauncher('Sizzle-Operations-OS', '/staff.html')}
            >
              Desktop Launcher (.bat)
            </Button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto -mt-10 max-w-2xl space-y-4 px-4">
        {/* Security Warning Notice */}
        <div className="card flex items-start gap-3 border-l-4 border-l-amber-500 bg-amber-50/90 p-4 text-amber-950">
          <ShieldAlert size={22} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
            <span className="font-bold">Restricted to Authorized Restaurant Operations.</span> Customer dining and
            food ordering is strictly blocked on this portal. Customers should scan their table QR or visit the customer menu.
            <div className="mt-2">
              <Link
                to={slug ? `/eat/${slug}` : '/eat'}
                className="inline-flex items-center gap-1 font-bold text-amber-800 hover:underline"
              >
                <span>Guest / Customer Food Menu</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>

        {/* Current Session Banner if Logged In */}
        {user && (
          <div className="card flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-leaf-500 bg-white p-4">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-ink-500">Currently Authenticated</p>
              <p className="text-[15px] font-bold text-ink-900">
                {user.name} <span className="rounded bg-ink-100 px-2 py-0.5 text-[11px] font-bold text-ink-700">{user.role}</span>
              </p>
            </div>
            <Link
              to={homeFor(user.role)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-ink-900 px-4 py-2 text-[13px] font-bold text-white shadow-sm hover:bg-ink-800"
            >
              <span>Continue to My Role Screen</span>
              <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {/* Download & Install Web-Based App Icon Card */}
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 pb-3">
            <div>
              <h2 className="font-display text-[17px] font-800 text-ink-900">Download &amp; Install App Icon</h2>
              <p className="text-[12.5px] text-ink-500">Install web-based icon for instant full-screen operations.</p>
            </div>
            <div className="flex rounded-lg bg-ink-100 p-0.5 text-[12px] font-semibold">
              <button
                type="button"
                onClick={() => setPlatform('computer')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${
                  platform === 'computer' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                <Laptop size={14} /> Computer
              </button>
              <button
                type="button"
                onClick={() => setPlatform('mobile')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${
                  platform === 'mobile' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                <Smartphone size={14} /> Mobile
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-ink-50 p-4">
            {platform === 'computer' ? (
              <div className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink-900">
                  <Laptop size={15} className="text-ember-500" />
                  Install on Computer (Windows PC / Mac / Chrome / Edge)
                </h3>
                <p className="text-[12.5px] leading-relaxed text-ink-600">
                  In Chrome or Edge, look for the <span className="font-semibold text-ink-800">Install app icon</span> (⊞ or ⬇)
                  in your browser's address bar at the top-right. Click it to install Sizzle Operations with a desktop shortcut
                  and taskbar icon. You can also download dedicated Windows launcher scripts below.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Download size={14} />}
                    onClick={() => downloadWindowsAppLauncher('Sizzle-Operations-OS', '/staff.html')}
                  >
                    Download Windows Launcher (.bat)
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<ExternalLink size={13} />}
                    onClick={() => downloadDesktopShortcut('Sizzle Operations OS', '/staff.html')}
                  >
                    Download Desktop Shortcut (.url)
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink-900">
                  <Smartphone size={15} className="text-ember-500" />
                  Install on Mobile Phone (Android &amp; iPhone)
                </h3>
                <p className="text-[12.5px] leading-relaxed text-ink-600">
                  <strong>On iPhone (Safari):</strong> Tap the <span className="font-semibold text-ink-800">Share [↑]</span> button
                  at the bottom, then choose <span className="font-semibold text-ink-800">Add to Home Screen [+]</span>.
                </p>
                <p className="text-[12.5px] leading-relaxed text-ink-600">
                  <strong>On Android (Chrome):</strong> Tap the Install button below or tap menu (⋮) → <span className="font-semibold text-ink-800">Add to Home screen</span>.
                </p>
              </div>
            )}

            {canInstall && (
              <div className="mt-3.5 pt-2">
                <Button variant="primary" size="md" icon={<Download size={15} />} onClick={() => void promptInstall()}>
                  Install Sizzle Operations App
                </Button>
              </div>
            )}
            {installed && (
              <div className="mt-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-leaf-700">
                <Check size={15} /> App is already installed on this device
              </div>
            )}
            {needsManualInstall && (
              <div className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-ink-600">
                <Share2 size={14} className="text-ember-600" /> Tap Share and select "Add to Home Screen"
              </div>
            )}
          </div>
        </div>

        {/* The 4 Operations Dashboards Cards */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[18px] font-800 text-ink-900">The 4 Operations Dashboards</h2>
            <span className="text-[12px] font-semibold text-ink-500">Tap to Launch</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {OPERATIONS_SYSTEMS.map((sys) => {
              const Icon = sys.fallbackIcon;
              return (
                <div
                  key={sys.id}
                  className="card flex flex-col justify-between p-4 transition-all hover:border-ink-300 hover:shadow-md"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-3">
                      <img
                        src={sys.iconSrc}
                        alt={sys.name}
                        className="h-11 w-11 shrink-0 rounded-2xl shadow-sm"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                      <div
                        className={`hidden grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${sys.color} text-white shadow-sm`}
                      >
                        <Icon size={22} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-display text-[15px] font-bold text-ink-900 leading-snug">{sys.name}</h3>
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider ${sys.accentBg} ${sys.accentText}`}>
                          {sys.role}
                        </span>
                      </div>
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-ink-600">{sys.description}</p>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
                    <span className="font-mono text-[11px] text-ink-400">{sys.url}</span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="px-2 text-[11px]"
                        title="Download Windows shortcut for this system"
                        onClick={() => downloadWindowsAppLauncher(sys.name, sys.url)}
                      >
                        <Laptop size={12} className="mr-1" /> .bat
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        className="gap-1 text-[12px]"
                        onClick={() => openSystem(sys.url)}
                      >
                        <span>Launch</span>
                        <ExternalLink size={12} />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Staff Sign-in Shortcut if Not Logged In */}
        {!user && (
          <Link
            to="/login"
            className="card flex items-center gap-3 border-l-4 border-l-ember-500 p-4 transition-shadow hover:shadow-md"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 text-ember-400">
              <LogIn size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold text-ink-900">Sign In to Your Staff Account</span>
              <span className="block text-[12px] text-ink-500">
                Email, phone or one-time shift code. Each staff account opens its authorized operational dashboard.
              </span>
            </div>
            <span className="shrink-0 text-[12px] font-bold text-ember-600">Sign In →</span>
          </Link>
        )}

        {/* Walk-in Job Application */}
        {slug ? (
          <Link
            to={`/apply/${slug}`}
            className="card flex items-center gap-3 border-l-4 border-l-leaf-500 p-4 transition-shadow hover:shadow-md"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-leaf-50 text-leaf-700 ring-1 ring-leaf-200">
              <Briefcase size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold text-ink-900">New Staff Application — Work With Us</span>
              <span className="block text-[12px] text-ink-500">
                Apply for waiter, kitchen, or cashier shifts at {slug}. No prior account needed.
              </span>
            </div>
            <span className="shrink-0 text-[12px] font-bold text-leaf-700">Apply →</span>
          </Link>
        ) : null}

        {/* Footer Note */}
        <p className="pt-2 text-center text-[12px] text-ink-400">
          Sizzle Operations OS · High-Reliability Multi-Tenant Restaurant System
        </p>
      </main>

      {/* Instant Auto-Appearing Install Window / Modal */}
      <Modal
        open={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        title="Install Sizzle Operations OS"
        width="max-w-xl"
        footer={
          <div className="flex w-full items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setInstallModalOpen(false)}>
              Explore Dashboards Without Installing
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setInstallModalOpen(false)}>
              Dismiss
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3.5 rounded-2xl bg-gradient-to-r from-ink-900 to-ink-800 p-4 text-white shadow-md">
            <img src="/icons/icon-192.png" alt="Sizzle OS" className="h-14 w-14 shrink-0 rounded-2xl shadow-md ring-2 ring-white/20" />
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[18px] font-800">Sizzle Operations OS</h3>
              <p className="text-[12.5px] text-ink-300">
                One install adds all 4 operational dashboards to your computer desktop or mobile screen.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-ink-200 bg-ink-50/70 p-3.5">
            <p className="text-[13px] font-semibold text-ink-800">4 Operational Systems Included:</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
              <div className="flex items-center gap-1.5 text-ink-700 font-medium">
                <span className="text-amber-600 font-bold">🍳</span> Kitchen System (KDS)
              </div>
              <div className="flex items-center gap-1.5 text-ink-700 font-medium">
                <span className="text-blue-600 font-bold">🛎️</span> Waiter Floor System
              </div>
              <div className="flex items-center gap-1.5 text-ink-700 font-medium">
                <span className="text-emerald-600 font-bold">💳</span> Cashier POS Till
              </div>
              <div className="flex items-center gap-1.5 text-ink-700 font-medium">
                <span className="text-purple-600 font-bold">📊</span> Owner &amp; Manager Office
              </div>
            </div>
          </div>

          {/* Big One-Click Action Buttons */}
          <div className="space-y-2 pt-1">
            {canInstall ? (
              <Button
                variant="primary"
                size="lg"
                className="w-full text-[15px] font-bold shadow-md shadow-ember-500/25"
                icon={<Download size={18} />}
                onClick={async () => {
                  await promptInstall();
                  setInstallModalOpen(false);
                }}
              >
                Install App in Browser / System Now
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="w-full text-[15px] font-bold shadow-md shadow-ember-500/25"
                icon={<Monitor size={18} />}
                onClick={() => {
                  downloadWindowsAppLauncher('Sizzle-Operations-OS', '/staff.html');
                }}
              >
                Download Windows Desktop App Launcher (.bat)
              </Button>
            )}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="md"
                className="flex-1 text-[12.5px]"
                icon={<Laptop size={15} />}
                onClick={() => downloadWindowsAppLauncher('Sizzle-Operations-OS', '/staff.html')}
              >
                Windows Launcher (.bat)
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="flex-1 text-[12.5px]"
                icon={<ExternalLink size={14} />}
                onClick={() => downloadDesktopShortcut('Sizzle Operations OS', '/staff.html')}
              >
                Desktop Shortcut (.url)
              </Button>
            </div>
          </div>

          {/* Quick instructions for iPhone and Android */}
          <div className="rounded-xl bg-ink-100/70 p-3 text-[12px] leading-relaxed text-ink-600">
            <strong>Mobile Install:</strong> On iPhone Safari, tap <strong>Share [↑]</strong> → <strong>Add to Home Screen [+]</strong>. On Android Chrome, tap <strong>Install App</strong> or <strong>Add to Home screen</strong>.
          </div>
        </div>
      </Modal>
    </div>
  );
}
