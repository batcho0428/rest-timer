"use client";

import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Camera, Clock, Moon, Sun, Tag, X, Zap } from 'lucide-react';

type Timer = {
  id: string;
  barcode: string;
  startTime: number;
  endTime: number;
  completed: boolean;
};

type LabelMap = Record<string, string>;

type ConfigData = {
  barcode: string;
  label: string;
  hours: number;
  minutes: number;
};

type Html5QrcodeScannerInstance = {
  render(
    onScanSuccess: (decodedText: string) => void,
    onScanError: (errorMessage: string) => void
  ): void;
  clear(): Promise<void> | void;
};

declare global {
  interface Window {
    Html5QrcodeScanner?: new (
      elementId: string,
      config: { fps: number; qrbox: { width: number; height: number } },
      verbose: boolean
    ) => Html5QrcodeScannerInstance;
  }
}

// --- Constants ---
const STORAGE_KEY_TIMERS = 'break_timers_data';
const STORAGE_KEY_LABELS = 'break_labels_map';

export default function App() {
  const [timers, setTimers] = useState<Timer[]>([]);
  const [labelMap, setLabelMap] = useState<LabelMap>({});
  const [isScanning, setIsScanning] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const [isWakeLocked, setIsWakeLocked] = useState(false);
  
  // Modal State
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configData, setConfigData] = useState<ConfigData>({ barcode: '', label: '', hours: 1, minutes: 0 });
  
  const scannerRef = useRef<Html5QrcodeScannerInstance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // --- Initialization ---
  useEffect(() => {
    const savedTimers = localStorage.getItem(STORAGE_KEY_TIMERS);
    const savedLabels = localStorage.getItem(STORAGE_KEY_LABELS);
    
    if (savedTimers) setTimers(JSON.parse(savedTimers));
    if (savedLabels) setLabelMap(JSON.parse(savedLabels));

    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
    }

    // Prepare alarm sound (Using a clearer beep)
    audioRef.current = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
  }, []);

  // --- Wake Lock (Prevent Screen Sleep) ---
  const toggleWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        if (!isWakeLocked) {
          const wakeLock = await navigator.wakeLock?.request('screen');
          if (!wakeLock) {
            return;
          }

          wakeLockRef.current = wakeLock;
          setIsWakeLocked(true);
          wakeLock.addEventListener('release', () => {
            setIsWakeLocked(false);
          });
        } else {
          await wakeLockRef.current?.release();
          wakeLockRef.current = null;
          setIsWakeLocked(false);
        }
      } catch (err) {
        if (err instanceof Error) {
          console.error(`${err.name}, ${err.message}`);
        }
      }
    }
  };

  // --- Persistence ---
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TIMERS, JSON.stringify(timers));
  }, [timers]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_LABELS, JSON.stringify(labelMap));
  }, [labelMap]);

  // --- Timer Logic ---
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      
      const updatedTimers = timers.map(timer => {
        if (!timer.completed && now >= timer.endTime) {
          triggerAlarm(timer);
          changed = true;
          return { ...timer, completed: true };
        }
        return timer;
      });

      if (changed) setTimers(updatedTimers);
    }, 1000);

    return () => clearInterval(interval);
  }, [timers, labelMap]);

  const requestPermission = async () => {
    if ("Notification" in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    }
  };

  const triggerAlarm = (timer: Timer) => {
    const label = labelMap[timer.barcode] || timer.barcode;
    
    // Play Sound
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((error: unknown) => console.log("Audio play blocked", error));
    }

    // Send Notification (This works while locked)
    if (Notification.permission === "granted") {
      new Notification("休憩終了", {
        body: `「${label}」の時間が終了しました。`,
        icon: "https://cdn-icons-png.flaticon.com/512/3602/3602123.png",
        silent: false, // Ensure system sound plays
        requireInteraction: true // Keep on screen
      });
    }
  };

  // --- Barcode Scanner ---
  const startScanner = () => {
    setIsScanning(true);
    const script = document.createElement('script');
    script.src = "https://unpkg.com/html5-qr-scanner";
    script.async = true;
    script.onload = () => {
      if (!window.Html5QrcodeScanner) {
        setIsScanning(false);
        return;
      }

      const html5QrcodeScanner = new window.Html5QrcodeScanner(
        "reader", { fps: 10, qrbox: { width: 300, height: 300 } }, false
      );
      
      html5QrcodeScanner.render((decodedText: string) => {
        handleScannedBarcode(decodedText);
        html5QrcodeScanner.clear();
        setIsScanning(false);
      }, (_error: string) => {});
      scannerRef.current = html5QrcodeScanner;
    };
    document.body.appendChild(script);
  };

  const handleScannedBarcode = (barcode: string) => {
    const cachedLabel = labelMap[barcode] || "";
    setConfigData({
      barcode: barcode,
      label: cachedLabel,
      hours: 1,
      minutes: 0
    });
    setShowConfigModal(true);
  };

  const stopScanner = () => {
    if (scannerRef.current) scannerRef.current.clear();
    setIsScanning(false);
  };

  // --- Actions ---
  const finalizeTimer = () => {
    const durationMs = (configData.hours * 3600 + configData.minutes * 60) * 1000;
    if (durationMs <= 0) return;

    const now = Date.now();
    const newTimer = {
      id: `${configData.barcode}-${now}`,
      barcode: configData.barcode,
      startTime: now,
      endTime: now + durationMs,
      completed: false
    };

    if (configData.label) {
      setLabelMap(prev => ({ ...prev, [configData.barcode]: configData.label }));
    }

    setTimers(prev => [newTimer, ...prev]);
    setShowConfigModal(false);
  };

  const deleteTimer = (id: string) => {
    setTimers(prev => prev.filter(t => t.id !== id));
  };

  const setShortcut = (h: number, m: number) => {
    setConfigData(prev => ({ ...prev, hours: h, minutes: m }));
  };

  const getRemainingTime = (endTime: number) => {
    const diff = endTime - Date.now();
    if (diff <= 0) return "00:00:00";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans">
      <header className="bg-indigo-600 text-white sticky top-0 z-20 shadow-md">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Zap className="fill-yellow-400 text-yellow-400" size={28} />
            休憩タイマー
          </h1>
          <div className="flex items-center gap-2">
            {/* Wake Lock Toggle */}
            <button 
              onClick={toggleWakeLock}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${isWakeLocked ? 'bg-yellow-400 text-slate-900' : 'bg-white/10 text-white'}`}
            >
              {isWakeLocked ? <Sun size={18} /> : <Moon size={18} />}
              <span className="hidden md:inline">{isWakeLocked ? '常時点灯ON' : '常時点灯OFF'}</span>
            </button>
            
            <button 
              onClick={requestPermission}
              className={`p-3 rounded-xl transition-all ${notificationPermission === 'granted' ? 'bg-white/20' : 'bg-amber-400 text-slate-900 shadow-lg animate-pulse'}`}
            >
              {notificationPermission === 'granted' ? <Bell size={24} /> : <BellOff size={24} />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 md:p-8 space-y-8">
        <section className="flex flex-col items-center">
          {!isScanning ? (
            <button 
              onClick={startScanner}
              className="w-full md:w-2/3 lg:w-1/2 bg-white hover:bg-slate-50 text-indigo-600 border-2 border-indigo-600 py-8 rounded-3xl shadow-xl flex flex-col items-center justify-center gap-4 transition-all active:scale-95 group"
            >
              <div className="bg-indigo-100 p-4 rounded-full group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <Camera size={40} />
              </div>
              <span className="text-2xl font-bold">バーコードをスキャン</span>
            </button>
          ) : (
            <div className="w-full md:w-2/3 lg:w-1/2 bg-white p-6 rounded-3xl shadow-2xl border-4 border-indigo-500">
              <div id="reader" className="w-full overflow-hidden rounded-xl"></div>
              <button 
                onClick={stopScanner}
                className="w-full mt-6 py-3 bg-slate-200 text-slate-600 rounded-xl font-bold text-lg"
              >
                キャンセル
              </button>
            </div>
          )}
        </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="text-lg font-bold text-slate-500 flex items-center gap-2">
              <Clock size={20} />
              進行中のタイマー ({timers.length})
            </h2>
          </div>

          {timers.length === 0 && !isScanning && (
            <div className="text-center py-20 bg-white/50 rounded-3xl border-4 border-dashed border-slate-200 text-slate-400">
              <Clock className="mx-auto mb-4 opacity-10" size={80} />
              <p className="text-xl">タイマーがありません</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {timers.map((timer) => (
              <div 
                key={timer.id}
                className={`bg-white p-6 rounded-3xl shadow-lg border-l-8 transition-all relative overflow-hidden ${timer.completed ? 'border-green-500 bg-green-50' : 'border-indigo-500'}`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="space-y-1">
                    <h3 className="text-2xl font-black text-slate-800 truncate pr-8">
                      {labelMap[timer.barcode] || "未設定"}
                    </h3>
                    <p className="text-sm font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded inline-block">ID: {timer.barcode}</p>
                  </div>
                  <button 
                    onClick={() => deleteTimer(timer.id)}
                    className="absolute top-4 right-4 text-slate-300 hover:text-rose-500 p-2 transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>

                <div className="flex flex-col items-center py-4">
                  <span className={`text-6xl font-mono font-black ${timer.completed ? 'text-green-600 animate-bounce' : 'text-indigo-600'}`}>
                    {getRemainingTime(timer.endTime)}
                  </span>
                  {timer.completed && <p className="text-green-600 font-bold mt-2 font-black text-xl">時間終了！</p>}
                </div>

                <div className="flex justify-between items-center mt-6 text-slate-400 font-medium border-t pt-4">
                  <span>開始: {new Date(timer.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>終了: {new Date(timer.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-8 space-y-8">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-black flex items-center gap-2">
                  <Tag className="text-indigo-600" />
                  タイマー設定
                </h2>
                <button onClick={() => setShowConfigModal(false)}><X className="text-slate-400" size={32}/></button>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-widest">名前</label>
                <input 
                  type="text" 
                  value={configData.label}
                  onChange={(e) => setConfigData({...configData, label: e.target.value})}
                  className="w-full text-xl p-5 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:border-indigo-500 outline-none transition-all"
                />
              </div>

              <div className="space-y-4">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-widest">時間</label>
                <div className="flex items-center justify-center gap-4 text-4xl font-black bg-slate-50 p-6 rounded-3xl">
                  <div className="flex flex-col items-center">
                    <input 
                      type="number" 
                      value={configData.hours}
                      onChange={(e) => setConfigData({...configData, hours: parseInt(e.target.value) || 0})}
                      className="w-20 text-center bg-transparent outline-none"
                    />
                    <span className="text-xs font-bold text-slate-400 uppercase">時間</span>
                  </div>
                  <span className="text-slate-300">:</span>
                  <div className="flex flex-col items-center">
                    <input 
                      type="number" 
                      value={configData.minutes}
                      onChange={(e) => setConfigData({...configData, minutes: Math.min(59, parseInt(e.target.value) || 0)})}
                      className="w-20 text-center bg-transparent outline-none"
                    />
                    <span className="text-xs font-bold text-slate-400 uppercase">分</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                  {[
                    { l: '45分', h: 0, m: 45 },
                    { l: '1時間', h: 1, m: 0 },
                    { l: '1.5h', h: 1, m: 30 },
                    { l: '2時間', h: 2, m: 0 },
                    { l: '3時間', h: 3, m: 0 },
                  ].map((s) => (
                    <button
                      key={s.l}
                      onClick={() => setShortcut(s.h, s.m)}
                      className={`py-3 rounded-xl font-bold transition-all ${configData.hours === s.h && configData.minutes === s.m ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {s.l}
                    </button>
                  ))}
                </div>
              </div>

              <button 
                onClick={finalizeTimer}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-6 rounded-2xl text-2xl font-black shadow-xl shadow-indigo-200 transition-all active:scale-95"
              >
                タイマー開始
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="fixed bottom-6 left-1/2 -translate-x-1/2 z-10 w-full px-6 pointer-events-none">
        <div className="max-w-md mx-auto bg-slate-800/90 backdrop-blur-md text-white px-6 py-3 rounded-full shadow-2xl text-center text-sm font-medium">
           {isWakeLocked ? '画面は常に点灯しています' : '画面を常に点灯させると音が確実になります'}
        </div>
      </footer>
    </div>
  );
}