"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  type User,
} from "firebase/auth";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db, firebaseConfigured } from "@/lib/firebase";
import {
  CalendarDays,
  Check,
  CheckCheck,
  CloudSun,
  Copy,
  Download,
  History,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  Plus,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Users,
  Wallet,
  Weight,
  X,
  TentTree,
  Trash2,
  Save,
  Cloud,
  ClipboardCheck,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import TripChat, { parseChatInvitation } from "@/components/TripChat";
import BagPacking from "@/components/BagPacking";
import PrepReminders from "@/components/PrepReminders";
import NotificationCenter from "@/components/NotificationCenter";
import AccountMenu from "@/components/AccountMenu";
import { useLanguage } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import Link from "next/link";

type ItemStatus = "Owned" | "Need to buy" | "Purchased" | "Packed";
type Item = {
  id: string;
  name: string;
  category: string;
  status: ItemStatus;
  assignee: string;
  weight: number;
  price: number;
  paidBy: string;
  comment: string;
  dueDate: string;
  receiptUrl: string;
  bagId?: string;
  bagLocation?: string;
};
type Member = { id: string; name: string };
type Expense = { id: string; name: string; amount: number; payer: string };
type Bag = { id: string; name: string; photoUrl: string; verified: boolean };
type Trip = {
  id: string;
  name: string;
  type: string;
  location: string;
  startDate: string;
  endDate: string;
  prepStartDate?: string;
  people: number;
  budget: number;
  members: Member[];
  items: Item[];
  expenses: Expense[];
  bags: Bag[];
  sharedChatId?: string;
  inviteCode?: string;
  createdAt: string;
};
type Workspace = { trips: Trip[]; activeTripId: string; history: Trip[] };
const templates: Record<string, string[]> = {
  Camping: [
    "Tent",
    "Sleeping bag",
    "Sleeping mat",
    "Flashlight",
    "Portable charger",
    "Water bottle",
    "First aid kit",
    "Rain jacket",
    "Cooking set",
    "Trash bags",
  ],
  "Overseas travel": [
    "Passport",
    "Flight tickets",
    "Wallet",
    "Phone charger",
    "Travel adapter",
    "Clothes",
    "Toiletries",
    "Medication",
    "Travel insurance details",
  ],
  Beach: [
    "Swimwear",
    "Towel",
    "Sunscreen",
    "Sunglasses",
    "Water bottle",
    "Sandals",
    "Change of clothes",
  ],
  Hiking: [
    "Hiking shoes",
    "Water bottle",
    "Trail snacks",
    "First aid kit",
    "Rain jacket",
    "Map / offline map",
    "Headlamp",
    "Warm layer",
  ],
  "School event": [
    "Student ID",
    "Notebook",
    "Pens",
    "Laptop",
    "Charger",
    "Water bottle",
    "Lunch",
    "Umbrella",
  ],
};
const uid = () => Math.random().toString(36).slice(2, 10);
const newItem = (name: string, category = "General"): Item => ({
  id: uid(),
  name,
  category,
  status: "Need to buy",
  assignee: "Unassigned",
  weight: 0,
  price: 0,
  paidBy: "",
  comment: "",
  dueDate: "",
  receiptUrl: "",
});
const normalizeTrip = (t: any): Trip => ({
  ...t,
  items: (t.items || []).map((i: any) => ({
    ...newItem(i.name || "Item"),
    ...i,
    bagId: i.bagId || "",
    bagLocation: i.bagLocation || "",
  })),
  members: t.members || [],
  expenses: t.expenses || [],
  bags: t.bags || [],
});
const normalizeWorkspace = (data: any): Workspace => ({
  trips: (data.trips || []).map(normalizeTrip),
  activeTripId: data.activeTripId || "",
  history: (data.history || []).map(normalizeTrip),
});
const seed: Workspace = {
  trips: [
    {
      id: "demo-trip",
      name: "Osaka Camping Weekend",
      type: "Camping",
      location: "Osaka, Japan",
      startDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10),
      prepStartDate: new Date(Date.now() + 4 * 86400000)
        .toISOString()
        .slice(0, 10),
      people: 3,
      budget: 15000,
      members: [
        { id: "m1", name: "Han" },
        { id: "m2", name: "Aki" },
        { id: "m3", name: "Yuki" },
      ],
      items: templates.Camping.map((n, i) => ({
        ...newItem(n, "Camping"),
        status: i < 3 ? "Owned" : "Need to buy",
        assignee: ["Han", "Aki", "Yuki"][i % 3],
        weight: [2.5, 1.4, 0.8, 0.3, 0.2, 0.6, 0.4, 0.3, 1.2, 0.2][i],
        price: [0, 0, 0, 1200, 1800, 500, 900, 1800, 2500, 300][i],
        paidBy: i === 3 ? "Aki" : "",
      })),
      expenses: [],
      bags: [],
      createdAt: new Date().toISOString(),
    },
  ],
  activeTripId: "demo-trip",
  history: [],
};
const yen = (n: number) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n || 0);
function weatherLabel(code: number, translate: (text: string) => string) {
  if (code === 0) return translate("Clear");
  if ([1, 2, 3].includes(code)) return translate("Partly cloudy");
  if ([45, 48].includes(code)) return translate("Fog");
  if (code >= 51 && code <= 67) return translate("Rain");
  if (code >= 71 && code <= 77) return translate("Snow");
  if (code >= 80 && code <= 82) return translate("Rain showers");
  if (code >= 95) return translate("Thunderstorm");
  return translate("Mixed");
}
export default function Home() {
  const { language, setLanguage, t: tr } = useLanguage();
  const router = useRouter();
  const skipAnonymousSignIn = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>(seed);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [remoteError, setRemoteError] = useState(false);
  const [tab, setTab] = useState("Overview");
  const [showCreateTrip, setShowCreateTrip] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("Camping");
  const [newLocation, setNewLocation] = useState("Osaka, Japan");
  const [newStart, setNewStart] = useState(
    new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  );
  const [newEnd, setNewEnd] = useState(
    new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10),
  );
  const [newBudget, setNewBudget] = useState("15000");
  const [itemName, setItemName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [expenseName, setExpenseName] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expensePayer, setExpensePayer] = useState("");
  const [weather, setWeather] = useState<any>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [advice, setAdvice] = useState<any>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const active =
    workspace.trips.find((t) => t.id === workspace.activeTripId) ||
    workspace.trips[0];
  const updateTrip = (fn: (trip: Trip) => Trip) =>
    setWorkspace((w) => ({
      ...w,
      trips: w.trips.map((t) => (t.id === w.activeTripId ? fn(t) : t)),
    }));
  const toggleSidebar = () =>
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem("motteku-sidebar-collapsed", String(next));
      } catch {}
      return next;
    });
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    skipAnonymousSignIn.current = true;
    try {
      if (auth) await signOut(auth);
      router.replace("/login");
    } catch {
      skipAnonymousSignIn.current = false;
      setLoggingOut(false);
      setNotice(tr("Could not log out. Please try again."));
    }
  };
  useEffect(() => {
    try {
      setSidebarCollapsed(
        localStorage.getItem("motteku-sidebar-collapsed") === "true",
      );
    } catch {}
  }, []);
  useEffect(() => {
    const incoming = parseChatInvitation(window.location.href);
    let pending = incoming;
    try {
      if (incoming) {
        sessionStorage.setItem("motteku-pending-chat-invite", JSON.stringify(incoming));
      } else {
        const saved = JSON.parse(sessionStorage.getItem("motteku-pending-chat-invite") || "null");
        if (saved && typeof saved.roomId === "string" && typeof saved.code === "string") {
          pending = parseChatInvitation(`${window.location.origin}/?joinChat=${encodeURIComponent(saved.roomId)}&inviteCode=${encodeURIComponent(saved.code)}`);
        }
      }
    } catch {}
    if (pending) setTab("Group chat");
  }, []);
  useEffect(() => {
    if (!firebaseConfigured || !auth || !db) {
      try {
        const saved = localStorage.getItem("motteku-workspace");
        if (saved) {
          const parsed = normalizeWorkspace(JSON.parse(saved));
          if (parsed.trips?.length) setWorkspace(parsed);
        }
      } catch {}
      setReady(true);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u && !skipAnonymousSignIn.current)
        signInAnonymously(auth!).catch((e) => {
          console.error(e);
          setNotice(
            "Firebase sign-in failed. Check that Anonymous Authentication is enabled.",
          );
          setReady(true);
        });
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!firebaseConfigured || !db || !user) return;
    const ref = doc(db, "users", user.uid, "workspace", "main");
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = normalizeWorkspace(snap.data());
          if (data.trips?.length) setWorkspace(data);
        }
        setRemoteLoaded(true);
        setReady(true);
      },
      () => {
        try {
          const saved = localStorage.getItem("motteku-workspace");
          if (saved) {
            const parsed = normalizeWorkspace(JSON.parse(saved));
            if (parsed.trips?.length) setWorkspace(parsed);
          }
        } catch {}
        setRemoteError(true);
        setNotice(
          "Firebase access was denied. Using local demo mode; publish firestore.rules in the matching Firebase project to restore cloud sync.",
        );
        setRemoteLoaded(true);
        setReady(true);
      },
    );
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!ready) return;
    if (firebaseConfigured && db && user && !remoteError) {
      if (!remoteLoaded) return;
      const ref = doc(db, "users", user.uid, "workspace", "main");
      setDoc(ref, workspace, { merge: true }).catch(() => {
        setRemoteError(true);
        setNotice(
          "Firebase access was denied. Using local demo mode; publish firestore.rules in the matching Firebase project to restore cloud sync.",
        );
      });
    } else {
      try {
        localStorage.setItem("motteku-workspace", JSON.stringify(workspace));
      } catch {}
    }
  }, [workspace, ready, user, remoteLoaded, remoteError]);
  const expenses = active?.expenses || [];
  const stats = useMemo(() => {
    if (!active) return { total: 0, packed: 0, need: 0, weight: 0, spent: 0 };
    return {
      total: active.items.length,
      packed: active.items.filter((i) => i.status === "Packed").length,
      need: active.items.filter((i) => i.status === "Need to buy").length,
      weight: active.items.reduce((s, i) => s + (Number(i.weight) || 0), 0),
      spent: active.items.reduce(
        (s, i) =>
          s +
          (["Purchased", "Packed"].includes(i.status)
            ? Number(i.price) || 0
            : 0),
        0,
      ),
    };
  }, [active]);
  const addTrip = () => {
    const trip: Trip = {
      id: uid(),
      name: newName.trim() || `${newType} trip`,
      type: newType,
      location: newLocation,
      startDate: newStart,
      endDate: newEnd,
      prepStartDate: newStart,
      people: 1,
      budget: Number(newBudget) || 0,
      members: [{ id: uid(), name: "Me" }],
      items: (templates[newType] || []).map((n) => newItem(n, newType)),
      expenses: [],
      bags: [],
      createdAt: new Date().toISOString(),
    };
    setWorkspace((w) => ({
      ...w,
      trips: [trip, ...w.trips],
      activeTripId: trip.id,
    }));
    setNewName("");
    setTab("Overview");
    setShowCreateTrip(false);
    setNotice("Trip created with a starter checklist.");
  };
  const changeStatus = (id: string, status: ItemStatus) =>
    updateTrip((t) => ({
      ...t,
      items: t.items.map((i) => (i.id === id ? { ...i, status } : i)),
    }));
  const addItem = () => {
    if (!itemName.trim()) return;
    updateTrip((t) => ({
      ...t,
      items: [...t.items, newItem(itemName.trim(), t.type)],
    }));
    setItemName("");
  };
  const assignFairly = () => {
    if (!active.members.length) return;
    let idx = 0;
    updateTrip((t) => ({
      ...t,
      items: t.items.map((i) => {
        if (
          i.assignee === "Unassigned" ||
          !t.members.some((m) => m.name === i.assignee)
        ) {
          const assignee = t.members[idx % t.members.length].name;
          idx++;
          return { ...i, assignee };
        }
        return i;
      }),
    }));
    setNotice("Unassigned items were distributed across members.");
  };
  const addMember = () => {
    if (!memberName.trim() || !active) return;
    updateTrip((t) => ({
      ...t,
      members: [...t.members, { id: uid(), name: memberName.trim() }],
    }));
    setMemberName("");
  };
  const fetchWeather = async () => {
    setWeatherLoading(true);
    setWeather(null);
    try {
      const geo = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(active.location.split(",")[0])}&count=1&language=en&format=json`,
      );
      const gd = await geo.json();
      const place = gd.results?.[0];
      if (!place)
        throw new Error("Location not found. Try a city name like Osaka.");
      const r = await fetch(
        `/api/weather?lat=${place.latitude}&lon=${place.longitude}`,
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Weather unavailable");
      setWeather({ ...d, place });
    } catch (e: any) {
      setNotice(e.message || "Weather could not be loaded.");
    } finally {
      setWeatherLoading(false);
    }
  };
  const getAdvice = async () => {
    setAdviceLoading(true);
    try {
      const r = await fetch("/api/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip: {
            name: active.name,
            type: active.type,
            location: active.location,
            startDate: active.startDate,
            endDate: active.endDate,
            people: active.people,
          },
          weather: weather?.daily || null,
          items: active.items.map((i) => ({
            name: i.name,
            status: i.status,
            weight: i.weight,
          })),
        }),
      });
      const d = await r.json();
      if (d.result) setAdvice(d.result);
      else if (!d.configured) {
        const rainy = weather?.daily?.precipitation_probability_max?.some(
          (x: number) => x >= 40,
        );
        const cold = weather?.daily?.temperature_2m_min?.some(
          (x: number) => x < 10,
        );
        const suggested = [
          ...(rainy ? ["Umbrella", "Rain jacket", "Waterproof bag"] : []),
          ...(cold ? ["Warm jacket", "Thermal layer"] : []),
          ...(active.type === "Camping"
            ? ["Headlamp", "First aid kit", "Trash bags"]
            : []),
          ...(active.type === "Hiking" ? ["Trail snacks", "Offline map"] : []),
        ];
        setAdvice({
          advice:
            "Built-in suggestions are based on your trip type and available forecast. Add or remove items to fit your group.",
          suggestedItems: [...new Set(suggested)],
          cautions: ["Forecasts can change; check again before departure."],
        });
      } else throw new Error(d.error || "AI advice failed");
    } catch (e: any) {
      setNotice(e.message || "Advice could not be generated.");
    } finally {
      setAdviceLoading(false);
    }
  };
  const copyTrip = () => {
    const copy = {
      ...active,
      id: uid(),
      name: `${active.name} (Copy)`,
      createdAt: new Date().toISOString(),
      bags: [],
      sharedChatId: "",
      inviteCode: "",
      items: active.items.map((i) => ({
        ...i,
        id: uid(),
        status: "Need to buy" as ItemStatus,
        paidBy: "",
        comment: "",
        bagId: "",
        bagLocation: "",
      })),
    };
    setWorkspace((w) => ({
      ...w,
      trips: [copy, ...w.trips],
      activeTripId: copy.id,
      history: [active, ...w.history],
    }));
    setNotice("Trip copied. Item statuses reset for the new trip.");
  };
  const finishTrip = () => {
    setWorkspace((w) => ({
      ...w,
      history: [active, ...w.history],
      trips: w.trips.filter((t) => t.id !== active.id),
      activeTripId: w.trips.find((t) => t.id !== active.id)?.id || "",
    }));
    setNotice("Trip moved to history.");
  };
  const handleJoinedChat = (roomId: string, code: string, roomName: string) => {
    setWorkspace((current) => {
      const existing = current.trips.find((trip) => trip.sharedChatId === roomId);
      if (existing) {
        return {
          ...current,
          activeTripId: existing.id,
          trips: current.trips.map((trip) => trip.id === existing.id ? { ...trip, inviteCode: code } : trip),
        };
      }
      const joinedTrip: Trip = {
        id: uid(), name: roomName || tr("Shared group"), type: "Shared trip",
        location: "", startDate: "", endDate: "", prepStartDate: "",
        people: 1, budget: 0,
        members: [{ id: user?.uid || uid(), name: user?.displayName || user?.email?.split("@")[0] || "Me" }],
        items: [], expenses: [], bags: [], sharedChatId: roomId, inviteCode: code,
        createdAt: new Date().toISOString(),
      };
      return { ...current, trips: [joinedTrip, ...current.trips], activeTripId: joinedTrip.id };
    });
    setTab("Group chat");
  };
  const nav = [
    ["Overview", CalendarDays],
    ["Packing list", ListChecks],
    ["Bags & photos", ClipboardCheck],
    ["Group chat", MessageCircle],
    ["Reminders", CalendarDays],
    ["Members", Users],
    ["Budget", Wallet],
    ["Weather & AI", CloudSun],
    ["History", History],
  ] as const;
  if (!ready)
    return (
      <main className="loading">
        <LoaderCircle className="spin" size={28} /> {tr("Loading Motteku…")}
      </main>
    );
  return (
    <main className="app-shell">
      <aside
        className={sidebarCollapsed ? "sidebar sidebar-collapsed" : "sidebar"}
      >
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-mark">
              <TentTree size={25} />
              <button
                className="sidebar-toggle"
                type="button"
                onClick={toggleSidebar}
                title={tr(
                  sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
                )}
                aria-label={tr(
                  sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
                )}
                aria-expanded={!sidebarCollapsed}
                aria-controls="workspace-navigation"
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen size={18} />
                ) : (
                  <PanelLeftClose size={18} />
                )}
              </button>
            </div>
            <div className="brand-copy">
              <b>Motteku</b>
              <small>{tr("Pack together, go further")}</small>
            </div>
          </div>
        </div>
        <div className="sidebar-scroll">
          <div className="workspace-label">{tr("WORKSPACE")}</div>
          <nav id="workspace-navigation" aria-label={tr("WORKSPACE")}>
            {nav.map(([label, Icon]) => (
              <button
                key={label}
                className={`nav-item ${tab === label ? "selected" : ""}`}
                title={tr(label)}
                aria-current={tab === label ? "page" : undefined}
                onClick={() => setTab(label)}
              >
                <Icon size={18} />
                <span>{tr(label)}</span>
                {label === "Packing list" && active && (
                  <em>{active.items.length}</em>
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-bottom">
            <div className="sync-dot" />
            <span>
              {tr(
                firebaseConfigured && user && !remoteError
                  ? "Firebase connected mode"
                  : "Local demo mode",
              )}
            </span>
            <small>
              {tr(
                firebaseConfigured && user && !remoteError
                  ? "Changes sync to Firestore"
                  : "Data saved in this browser",
              )}
            </small>
          </div>
          <button
            className="logout-button"
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            title={tr(loggingOut ? "Signing out…" : "Log out")}
            aria-label={tr(loggingOut ? "Signing out…" : "Log out")}
          >
            <LogOut size={18} />
            <span>{tr(loggingOut ? "Signing out…" : "Log out")}</span>
          </button>
        </div>
      </aside>
      <section className="main-area">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              {tr("YOUR NEXT ADVENTURE STARTS HERE")}
            </div>
            <h1>
              {tr(
                tab === "Overview"
                  ? "Trip overview"
                  : tab === "Packing list"
                    ? "Packing checklist"
                    : tab === "Bags & photos"
                      ? "Bags & item locations"
                      : tab === "Group chat"
                        ? "Trip group chat"
                        : tab === "Reminders"
                          ? "Preparation reminders"
                          : tab === "Members"
                            ? "Your travel crew"
                            : tab === "Budget"
                              ? "Budget & expenses"
                              : tab === "Weather & AI"
                                ? "Weather & smart advice"
                                : "Trip history",
              )}
            </h1>
          </div>
          <div className="top-actions">
            <NotificationCenter
              trips={workspace.trips}
              accountId={user?.uid || "local"}
              onOpen={(tripId, nextTab) => {
                setWorkspace((w) => ({ ...w, activeTripId: tripId }));
                setTab(nextTab);
              }}
            />
            {(!user || user.isAnonymous) && (
              <Link className="auth-link" href="/login">
                {tr("Log in")}
              </Link>
            )}
            <select
              aria-label={tr("Select trip")}
              value={active?.id || ""}
              onChange={(e) =>
                setWorkspace((w) => ({ ...w, activeTripId: e.target.value }))
              }
            >
              {workspace.trips.length ? (
                workspace.trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))
              ) : (
                <option value="">{tr("No active trip")}</option>
              )}
            </select>
            <select
              className="language-select"
              aria-label={tr("Language")}
              value={language}
              onChange={(e) => setLanguage(e.target.value as "ja" | "en")}
            >
              <option value="ja">{tr("Japanese")}</option>
              <option value="en">{tr("English")}</option>
            </select>
            <button
              className="primary small"
              onClick={() => { setTab("Overview"); setShowCreateTrip(true); }}
            >
              <Plus size={16} /> {tr("New trip")}
            </button>
            {user && !user.isAnonymous && (
              <AccountMenu key={user.uid} user={user} onLogout={handleLogout} loggingOut={loggingOut} />
            )}
          </div>
        </header>
        {notice && (
          <div className="notice">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} aria-label={tr("Dismiss")}>
              <X size={16} />
            </button>
          </div>
        )}
        {!active && tab !== "History" && tab !== "Group chat" ? (
          <section className="empty-state">
            <TentTree size={42} />
            <h2>{tr("Ready to plan your next trip?")}</h2>
            <p>{tr("Create a trip to start your packing list.")}</p>
            <button className="primary" onClick={() => setShowCreateTrip(true)}><Plus size={16} /> {tr("New trip")}</button>
          </section>
        ) : (
          active && (
            <>
              {tab === "Overview" && (
                <>
                  <section className="hero-card">
                    <div className="hero-copy">
                      <span className="pill">
                        <span className="pill-dot" />
                        {tr(active.type).toUpperCase()} {tr("PLAN")}
                      </span>
                      <h2>{active.name}</h2>
                      <p>
                        <CalendarDays size={16} />
                        {active.startDate} ↁE{active.endDate}
                      </p>
                      <p>
                        <Cloud size={16} />
                        {active.location}
                      </p>
                      <div className="hero-buttons">
                        <button
                          className="light-button"
                          onClick={() => setTab("Packing list")}
                        >
                          <ListChecks size={16} /> {tr("Open checklist")}
                        </button>
                        <button className="outline-button" onClick={copyTrip}>
                          <Copy size={16} /> {tr("Copy trip")}
                        </button>
                      </div>
                    </div>
                    <div className="hero-art">
                      <div className="sun" />
                      <div className="mountain mountain-back" />
                      <div className="mountain mountain-front" />
                      <div className="tiny-tent">
                        <span />
                      </div>
                    </div>
                  </section>
                  <div className="stats-grid">
                    <Stat
                      icon={<ListChecks />}
                      label={tr("Packing progress")}
                      value={`${stats.packed}/${stats.total}`}
                      sub={`${stats.total ? Math.round((stats.packed / stats.total) * 100) : 0}% ${tr("packed")}`}
                      color="purple"
                    />
                    <Stat
                      icon={<ShoppingCart />}
                      label={tr("Still to buy")}
                      value={String(stats.need)}
                      sub={tr("items on your list")}
                      color="orange"
                    />
                    <Stat
                      icon={<Weight />}
                      label={tr("Total item weight")}
                      value={`${stats.weight.toFixed(1)} kg`}
                      sub={tr("across all items")}
                      color="blue"
                    />
                    <Stat
                      icon={<Wallet />}
                      label={tr("Purchased total")}
                      value={yen(stats.spent)}
                      sub={`${tr("budget")} ${yen(active.budget)}`}
                      color="green"
                    />
                  </div>
                  <div className="content-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h3>{tr("Pack your essentials")}</h3>
                          <p>
                            {tr("Check off items as your group gets ready.")}
                          </p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setTab("Packing list")}
                        >
                          {tr("View all")} <span>&gt;</span>
                        </button>
                      </div>
                      <div className="progress-line">
                        <span
                          style={{
                            width: `${stats.total ? (stats.packed / stats.total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <div className="item-list">
                        {active.items.slice(0, 6).map((i) => (
                          <div className="quick-item" key={i.id}>
                            <button
                              className={`check-circle ${i.status === "Packed" ? "checked" : ""}`}
                              onClick={() =>
                                changeStatus(
                                  i.id,
                                  i.status === "Packed" ? "Owned" : "Packed",
                                )
                              }
                            >
                              {i.status === "Packed" && <Check size={14} />}
                            </button>
                            <span
                              className={
                                i.status === "Packed" ? "muted strike" : ""
                              }
                            >
                              {i.name}
                            </span>
                            <small>
                              {i.assignee === "Unassigned"
                                ? "Unassigned"
                                : i.assignee}
                            </small>
                            <select
                              value={i.status}
                              onChange={(e) =>
                                changeStatus(i.id, e.target.value as ItemStatus)
                              }
                              aria-label={`${i.name} status`}
                            >
                              {(
                                [
                                  "Owned",
                                  "Need to buy",
                                  "Purchased",
                                  "Packed",
                                ] as ItemStatus[]
                              ).map((s) => (
                                <option key={s} value={s}>
                                  {tr(s)}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h3>{tr("Trip details")}</h3>
                          <p>{tr("Keep the essentials in one place.")}</p>
                        </div>
                        <CalendarDays size={20} className="muted-icon" />
                      </div>
                      <div className="detail-list">
                        <Detail
                          label={tr("Destination")}
                          value={active.location}
                        />
                        <Detail
                          label={tr("Trip type")}
                          value={tr(active.type)}
                        />
                        <Detail
                          label={tr("Group size")}
                          value={`${active.members.length} ${tr("members")}`}
                        />
                        <Detail
                          label={tr("Budget per person")}
                          value={yen(
                            active.budget / Math.max(1, active.members.length),
                          )}
                        />
                      </div>
                      <div className="member-row">
                        {active.members.slice(0, 5).map((m, i) => (
                          <span
                            className={`avatar avatar-${i % 5}`}
                            key={m.id}
                            title={m.name}
                          >
                            {m.name.slice(0, 1).toUpperCase()}
                          </span>
                        ))}
                        <button
                          className="add-avatar"
                          onClick={() => setTab("Members")}
                        >
                          <Plus size={15} />
                        </button>
                        <span className="member-caption">
                          {active.members.length} {tr("travelers")}
                        </span>
                      </div>
                      <button
                        className="wide-soft"
                        onClick={() => setTab("Members")}
                      >
                        {tr("Manage group members")} <span>&gt;</span>
                      </button>
                    </section>
                  </div>
                </>
              )}
              {tab === "Packing list" && (
                <section className="panel page-panel">
                  <div className="panel-head">
                    <div>
                      <h3>{tr("Everything you need to bring")}</h3>
                      <p>
                        {tr(
                          "Track ownership, shopping, weight and responsibility.",
                        )}
                      </p>
                    </div>
                    <span className="count-badge">
                      {active.items.length} {tr("items")}
                    </span>
                  </div>
                  <form
                    className="add-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addItem();
                    }}
                  >
                    <input
                      placeholder={tr("Add an item, e.g. portable charger")}
                      value={itemName}
                      onChange={(e) => setItemName(e.target.value)}
                    />
                    <button className="primary" type="submit">
                      <Plus size={16} /> {tr("Add item")}
                    </button>
                  </form>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{tr("Item")}</th>
                          <th>{tr("Status")}</th>
                          <th>{tr("Assigned to")}</th>
                          <th>{tr("Weight (kg)")}</th>
                          <th>{tr("Price (¥)")}</th>
                          <th>{tr("Comment")}</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {active.items.map((i) => (
                          <tr key={i.id}>
                            <td>
                              <b>{i.name}</b>
                              <small className="cell-sub">{i.category}</small>
                            </td>
                            <td>
                              <select
                                className={`status-select status-${i.status.replaceAll(" ", "-").toLowerCase()}`}
                                value={i.status}
                                onChange={(e) =>
                                  changeStatus(
                                    i.id,
                                    e.target.value as ItemStatus,
                                  )
                                }
                              >
                                {(
                                  [
                                    "Owned",
                                    "Need to buy",
                                    "Purchased",
                                    "Packed",
                                  ] as ItemStatus[]
                                ).map((s) => (
                                  <option key={s} value={s}>
                                    {tr(s)}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select
                                value={i.assignee}
                                onChange={(e) =>
                                  updateTrip((t) => ({
                                    ...t,
                                    items: t.items.map((x) =>
                                      x.id === i.id
                                        ? { ...x, assignee: e.target.value }
                                        : x,
                                    ),
                                  }))
                                }
                              >
                                <option value="Unassigned">
                                  {tr("Unassigned")}
                                </option>
                                {active.members.map((m) => (
                                  <option key={m.id}>{m.name}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                className="table-input number"
                                type="number"
                                min="0"
                                step="0.1"
                                value={i.weight}
                                onChange={(e) =>
                                  updateTrip((t) => ({
                                    ...t,
                                    items: t.items.map((x) =>
                                      x.id === i.id
                                        ? {
                                            ...x,
                                            weight: Number(e.target.value),
                                          }
                                        : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="table-input number"
                                type="number"
                                min="0"
                                step="1"
                                value={i.price}
                                onChange={(e) =>
                                  updateTrip((t) => ({
                                    ...t,
                                    items: t.items.map((x) =>
                                      x.id === i.id
                                        ? {
                                            ...x,
                                            price: Number(e.target.value),
                                          }
                                        : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="table-input"
                                placeholder={tr("Add note…")}
                                value={i.comment}
                                onChange={(e) =>
                                  updateTrip((t) => ({
                                    ...t,
                                    items: t.items.map((x) =>
                                      x.id === i.id
                                        ? { ...x, comment: e.target.value }
                                        : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <button
                                className="icon-button danger"
                                aria-label={`Delete ${i.name}`}
                                onClick={() =>
                                  updateTrip((t) => ({
                                    ...t,
                                    items: t.items.filter((x) => x.id !== i.id),
                                  }))
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="bottom-actions">
                    <button className="soft-button" onClick={assignFairly}>
                      <Users size={16} /> {tr("Auto-assign unassigned")}
                    </button>
                    <button
                      className="soft-button"
                      onClick={() => {
                        const csv = [
                          "Item,Category,Status,Assignee,WeightKg,PriceYen,Comment",
                          ...active.items.map((i) =>
                            [
                              i.name,
                              i.category,
                              i.status,
                              i.assignee,
                              i.weight,
                              i.price,
                              i.comment,
                            ]
                              .map(
                                (v) => `"${String(v).replaceAll('"', '""')}"`,
                              )
                              .join(","),
                          ),
                        ].join("\n");
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(
                          new Blob(["\ufeff" + csv], {
                            type: "text/csv;charset=utf-8;",
                          }),
                        );
                        a.download = "motteku-packing-list.csv";
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }}
                    >
                      <Download size={16} /> {tr("Export CSV")}
                    </button>
                  </div>
                </section>
              )}
              {tab === "Bags & photos" && (
                <BagPacking
                  bags={active.bags || []}
                  items={active.items}
                  chatId={active.sharedChatId}
                  userUid={user?.uid}
                  onBagsChange={(bags) => updateTrip((t) => ({ ...t, bags }))}
                  onItemChange={(id, bagId, location) =>
                    updateTrip((t) => ({
                      ...t,
                      items: t.items.map((i) =>
                        i.id === id
                          ? { ...i, bagId, bagLocation: location }
                          : i,
                      ),
                    }))
                  }
                  onSharedPlanChange={(bags, placements) =>
                    updateTrip((t) => ({
                      ...t,
                      bags,
                      items: t.items.map((i) => {
                        const shared = placements.find(
                          (p) => p.name.toLowerCase() === i.name.toLowerCase(),
                        );
                        return shared
                          ? {
                              ...i,
                              bagId: shared.bagId,
                              bagLocation: shared.bagLocation,
                            }
                          : i;
                      }),
                    }))
                  }
                  onNotice={setNotice}
                />
              )}
              {tab === "Reminders" && (
                <PrepReminders
                  tripId={active.id}
                  tripName={active.name}
                  startDate={active.startDate}
                  prepStartDate={active.prepStartDate}
                  items={active.items}
                  onPrepDate={(date) =>
                    updateTrip((t) => ({ ...t, prepStartDate: date }))
                  }
                  onNotice={setNotice}
                />
              )}
              {tab === "Members" && (
                <div className="content-grid">
                  <section className="panel page-panel">
                    <div className="panel-head">
                      <div>
                        <h3>{tr("Travel crew")}</h3>
                        <p>{tr("Add members and assign items fairly.")}</p>
                      </div>
                      <Users className="muted-icon" />
                    </div>
                    <form
                      className="add-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        addMember();
                      }}
                    >
                      <input
                        placeholder={tr("Member name")}
                        value={memberName}
                        onChange={(e) => setMemberName(e.target.value)}
                      />
                      <button className="primary">
                        <Plus size={16} /> {tr("Add member")}
                      </button>
                    </form>
                    <div className="crew-list">
                      {active.members.map((m, idx) => (
                        <div className="crew-card" key={m.id}>
                          <span
                            className={`avatar avatar-${idx % 5} big-avatar`}
                          >
                            {m.name.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="crew-info">
                            <b>{m.name}</b>
                            <small>
                              {
                                active.items.filter(
                                  (i) => i.assignee === m.name,
                                ).length
                              }{" "}
                              assigned items ·{" "}
                              {active.items
                                .filter((i) => i.assignee === m.name)
                                .reduce((s, i) => s + i.weight, 0)
                                .toFixed(1)}{" "}
                              kg
                            </small>
                          </div>
                          <button
                            className="icon-button danger"
                            onClick={() => {
                              updateTrip((t) => ({
                                ...t,
                                members: t.members.filter((x) => x.id !== m.id),
                                items: t.items.map((i) =>
                                  i.assignee === m.name
                                    ? { ...i, assignee: "Unassigned" }
                                    : i,
                                ),
                              }));
                            }}
                            aria-label={`Remove ${m.name}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button className="primary" onClick={assignFairly}>
                      <Users size={16} /> {tr("Auto-assign unassigned items")}
                    </button>
                  </section>
                  <section className="panel page-panel">
                    <div className="panel-head">
                      <div>
                        <h3>{tr("Load balance")}</h3>
                        <p>{tr("Compare how much each person carries.")}</p>
                      </div>
                      <Weight className="muted-icon" />
                    </div>
                    {active.members.map((m) => {
                      const kg = active.items
                        .filter((i) => i.assignee === m.name)
                        .reduce((s, i) => s + i.weight, 0);
                      const max = Math.max(
                        1,
                        ...active.members.map((mm) =>
                          active.items
                            .filter((i) => i.assignee === mm.name)
                            .reduce((s, i) => s + i.weight, 0),
                        ),
                      );
                      return (
                        <div className="load-row" key={m.id}>
                          <div>
                            <b>{m.name}</b>
                            <span>{kg.toFixed(1)} kg</span>
                          </div>
                          <div className="load-track">
                            <span style={{ width: `${(kg / max) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    <p className="helper-note">
                      {tr(
                        "The auto-assign tool distributes only unassigned items. You can manually change assignments to balance weight more accurately.",
                      )}
                    </p>
                  </section>
                </div>
              )}
              {tab === "Budget" && (
                <div className="content-grid">
                  <section className="panel page-panel">
                    <div className="panel-head">
                      <div>
                        <h3>{tr("Trip budget")}</h3>
                        <p>{tr("Track planned budget and purchased items.")}</p>
                      </div>
                      <Wallet className="muted-icon" />
                    </div>
                    <label className="field-label">
                      {tr("Group budget (¥)")}
                      <input
                        type="number"
                        min="0"
                        value={active.budget}
                        onChange={(e) =>
                          updateTrip((t) => ({
                            ...t,
                            budget: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                    <div className="budget-summary">
                      <div>
                        <span>{tr("Total purchased items")}</span>
                        <b>{yen(stats.spent)}</b>
                      </div>
                      <div>
                        <span>{tr("Budget remaining")}</span>
                        <b
                          className={
                            active.budget - stats.spent < 0 ? "text-danger" : ""
                          }
                        >
                          {yen(active.budget - stats.spent)}
                        </b>
                      </div>
                      <div>
                        <span>{tr("Equal share per member")}</span>
                        <b>
                          {yen(
                            stats.spent / Math.max(1, active.members.length),
                          )}
                        </b>
                      </div>
                    </div>
                    <div className="progress-line budget-progress">
                      <span
                        style={{
                          width: `${active.budget ? Math.min(100, (stats.spent / active.budget) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <p className="helper-note">
                      {tr(
                        "Purchased total counts the price of items marked “Purchased Eor “Packed E Mark an item as Purchased after buying it.",
                      )}
                    </p>
                  </section>
                  <section className="panel page-panel">
                    <div className="panel-head">
                      <div>
                        <h3>{tr("Expense log")}</h3>
                        <p>{tr("Record who paid for shared purchases.")}</p>
                      </div>
                      <Wallet className="muted-icon" />
                    </div>
                    <form
                      className="expense-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!expenseName.trim() || Number(expenseAmount) <= 0)
                          return;
                        updateTrip((t) => ({
                          ...t,
                          expenses: [
                            ...(t.expenses || []),
                            {
                              id: uid(),
                              name: expenseName.trim(),
                              amount: Number(expenseAmount),
                              payer: expensePayer || t.members[0]?.name || "Me",
                            },
                          ],
                        }));
                        setExpenseName("");
                        setExpenseAmount("");
                      }}
                    >
                      <input
                        placeholder={tr("Expense name")}
                        value={expenseName}
                        onChange={(e) => setExpenseName(e.target.value)}
                      />
                      <input
                        placeholder={tr("Amount (¥)")}
                        type="number"
                        min="1"
                        value={expenseAmount}
                        onChange={(e) => setExpenseAmount(e.target.value)}
                      />
                      <select
                        value={expensePayer}
                        onChange={(e) => setExpensePayer(e.target.value)}
                      >
                        <option value="">{tr("Paid by…")}</option>
                        {active.members.map((m) => (
                          <option key={m.id}>{m.name}</option>
                        ))}
                      </select>
                      <button className="primary">
                        <Plus size={16} /> {tr("Add")}
                      </button>
                    </form>
                    {expenses.length === 0 ? (
                      <div className="empty-inline">
                        {tr("No expenses recorded yet. Add a purchase above.")}
                      </div>
                    ) : (
                      <>
                        <div className="expense-list">
                          {expenses.map((x) => (
                            <div className="expense-row" key={x.id}>
                              <div>
                                <b>{x.name}</b>
                                <small>Paid by {x.payer}</small>
                              </div>
                              <strong>{yen(x.amount)}</strong>
                              <button
                                className="icon-button danger"
                                onClick={() =>
                                  updateTrip((t) => ({
                                    ...t,
                                    expenses: (t.expenses || []).filter(
                                      (y) => y.id !== x.id,
                                    ),
                                  }))
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="settlement">
                          <h4>{tr("Equal split summary")}</h4>
                          <p>
                            Total:{" "}
                            {yen(expenses.reduce((s, x) => s + x.amount, 0))} ÷{" "}
                            {Math.max(1, active.members.length)} people ={" "}
                            <b>
                              {yen(
                                expenses.reduce((s, x) => s + x.amount, 0) /
                                  Math.max(1, active.members.length),
                              )}
                            </b>{" "}
                            per person.
                          </p>
                          {active.members.map((m) => {
                            const paid = expenses
                              .filter((x) => x.payer === m.name)
                              .reduce((s, x) => s + x.amount, 0);
                            const share =
                              expenses.reduce((s, x) => s + x.amount, 0) /
                              Math.max(1, active.members.length);
                            return (
                              <div className="settle-row" key={m.id}>
                                <span>{m.name}</span>
                                <span>Paid {yen(paid)}</span>
                                <b
                                  className={
                                    paid - share >= 0
                                      ? "text-green"
                                      : "text-danger"
                                  }
                                >
                                  {paid - share >= 0
                                    ? `Gets back ${yen(paid - share)}`
                                    : `Owes ${yen(share - paid)}`}
                                </b>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </section>
                </div>
              )}
              {tab === "Weather & AI" && (
                <div className="content-grid">
                  <section className="panel page-panel">
                    <div className="panel-head">
                      <div>
                        <h3>{tr("Destination forecast")}</h3>
                        <p>{tr("Weather helps your group pack smarter.")}</p>
                      </div>
                      <CloudSun className="muted-icon" />
                    </div>
                    <label className="field-label">
                      {tr("Destination or city")}
                      <input
                        value={active.location}
                        onChange={(e) =>
                          updateTrip((t) => ({
                            ...t,
                            location: e.target.value,
                          }))
                        }
                        placeholder="Osaka, Japan"
                      />
                    </label>
                    <button
                      className="primary"
                      onClick={fetchWeather}
                      disabled={weatherLoading}
                    >
                      {weatherLoading ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <RefreshCw size={16} />
                      )}{" "}
                      {tr("Get 7-day forecast")}
                    </button>
                    {weather?.daily && (
                      <div className="forecast-grid">
                        {weather.daily.time.map((day: string, i: number) => (
                          <div className="forecast-day" key={day}>
                            <small>
                              {new Date(day + "T12:00:00").toLocaleDateString(
                                language === "ja" ? "ja-JP" : "en-US",
                                {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                },
                              )}
                            </small>
                            <CloudSun size={24} />
                            <b>
                              {Math.round(weather.daily.temperature_2m_max[i])}°
                              /{" "}
                              {Math.round(weather.daily.temperature_2m_min[i])}°
                            </b>
                            <span>
                              {weatherLabel(weather.daily.weather_code[i], tr)}
                            </span>
                            <small>
                              {weather.daily.precipitation_probability_max[i] ??
                                0}
                              % rain
                            </small>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="helper-note">
                      {tr(
                        "Weather is provided by Open-Meteo. Forecasts may not cover the entire trip if it is more than 7 days away.",
                      )}
                    </p>
                  </section>
                  <section className="panel page-panel">
                    <div className="panel-head">
                      <div>
                        <h3>{tr("AI packing advice")}</h3>
                        <p>
                          {tr(
                            "Get suggestions based on your trip and forecast.",
                          )}
                        </p>
                      </div>
                      <Sparkles className="muted-icon" />
                    </div>
                    <div className="ai-banner">
                      <Sparkles size={23} />
                      <div>
                        <b>{tr("Your trip, thoughtfully packed")}</b>
                        <p>
                          {tr(
                            "Suggestions adapt to trip type, destination and forecast when available.",
                          )}
                        </p>
                      </div>
                    </div>
                    <button
                      className="primary"
                      onClick={getAdvice}
                      disabled={adviceLoading}
                    >
                      {adviceLoading ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <Sparkles size={16} />
                      )}{" "}
                      {tr("Generate suggestions")}
                    </button>
                    {advice && (
                      <div className="advice-results">
                        <h4>{tr("Recommendation")}</h4>
                        <p>{advice.advice}</p>
                        {advice.suggestedItems?.length > 0 && (
                          <>
                            <h4>{tr("Suggested items")}</h4>
                            {advice.suggestedItems.map((n: string) => (
                              <button
                                className="suggestion-chip"
                                key={n}
                                onClick={() => {
                                  if (
                                    !active.items.some(
                                      (i) =>
                                        i.name.toLowerCase() ===
                                        n.toLowerCase(),
                                    )
                                  )
                                    updateTrip((t) => ({
                                      ...t,
                                      items: [
                                        ...t.items,
                                        newItem(n, "AI suggestion"),
                                      ],
                                    }));
                                  setNotice(`${n} added to the packing list.`);
                                }}
                              >
                                <Plus size={13} />
                                {n}
                              </button>
                            ))}
                          </>
                        )}
                        {advice.cautions?.length > 0 && (
                          <>
                            <h4>{tr("Things to remember")}</h4>
                            <ul>
                              {advice.cautions.map((n: string) => (
                                <li key={n}>{n}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                    <p className="helper-note">
                      {tr(
                        "If no Gemini key is configured, Motteku uses simple built-in suggestions. Add GEMINI_API_KEY in .env.local to enable Gemini.",
                      )}
                    </p>
                  </section>
                </div>
              )}
            </>
          )
        )}
        {tab === "Group chat" && (
          <TripChat
            tripId={active?.id || ""}
            chatId={active?.sharedChatId}
            inviteCode={active?.inviteCode}
            userUid={user?.uid}
            userName={user?.displayName || user?.email?.split("@")[0] || ""}
            tripName={active?.name || tr("Shared group")}
            onRoomChange={(id, code) => {
              if (!active) return;
              setWorkspace((current) => ({
                ...current,
                trips: current.trips.map((trip) => trip.id === active.id ? { ...trip, sharedChatId: id, inviteCode: code } : trip),
              }));
            }}
            onJoinedRoom={handleJoinedChat}
            onNotice={setNotice}
          />
        )}
        {tab === "History" && (
          <section className="panel page-panel">
            <div className="panel-head">
              <div>
                <h3>{tr("Past trips")}</h3>
                <p>{tr("Copy a previous packing list and reuse it.")}</p>
              </div>
              <History className="muted-icon" />
            </div>
            {workspace.history.length === 0 ? (
              <div className="empty-inline">
                {tr("Completed trips will appear here when you finish a trip.")}
              </div>
            ) : (
              workspace.history.map((t) => (
                <div className="history-card" key={t.id}>
                  <div className="history-icon">
                    <ClipboardCheck size={20} />
                  </div>
                  <div className="history-info">
                    <b>{t.name}</b>
                    <small>
                      {t.location} · {t.items.length} items · {t.startDate}
                    </small>
                  </div>
                  <button
                    className="soft-button"
                    onClick={() => {
                      const cp = {
                        ...t,
                        id: uid(),
                        name: `${t.name} (Copy)`,
                        createdAt: new Date().toISOString(),
                        bags: [],
                        sharedChatId: "",
                        inviteCode: "",
                        items: t.items.map((i) => ({
                          ...i,
                          id: uid(),
                          status: "Need to buy" as ItemStatus,
                          bagId: "",
                          bagLocation: "",
                        })),
                      };
                      setWorkspace((w) => ({
                        ...w,
                        trips: [cp, ...w.trips],
                        activeTripId: cp.id,
                      }));
                      setTab("Overview");
                    }}
                  >
                    <Copy size={15} /> {tr("Reuse list")}
                  </button>
                  <button
                    className="history-delete"
                    onClick={() => {
                      if (window.confirm(`Delete  E{t.name} Efrom past trips?`))
                        setWorkspace((w) => ({
                          ...w,
                          history: w.history.filter((item) => item.id !== t.id),
                        }));
                    }}
                  >
                    <Trash2 size={15} />
                    <span>{tr("Delete")}</span>
                  </button>
                </div>
              ))
            )}
          </section>
        )}
        {tab === "Overview" && showCreateTrip && (
        <div className="create-modal-backdrop" onClick={() => setShowCreateTrip(false)}>
        <section role="dialog" aria-modal="true" aria-labelledby="create-trip-title" className="panel create-panel" id="create-trip" onClick={(e) => e.stopPropagation()}>
          <div className="panel-head">
            <div>
              <h3 id="create-trip-title">{tr("Create a new trip")}</h3>
              <p>
                {tr("Start with a template, then customize the checklist.")}
              </p>
            </div>
            <button type="button" className="icon-button" aria-label={tr("Dismiss")} onClick={() => setShowCreateTrip(false)}><X size={18} /></button>
          </div>
          <form
            className="create-form"
            onSubmit={(e) => {
              e.preventDefault();
              addTrip();
            }}
          >
            <label>
              {tr("Trip name")}
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={tr("e.g. Summer beach trip")}
              />
            </label>
            <label>
              {tr("Trip type")}
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
              >
                {Object.keys(templates).map((t) => (
                  <option key={t} value={t}>
                    {tr(t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr("Destination")}
              <input
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder="Osaka, Japan"
              />
            </label>
            <label>
              {tr("Start date")}
              <input
                type="date"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
              />
            </label>
            <label>
              {tr("End date")}
              <input
                type="date"
                min={newStart}
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
              />
            </label>
            <label>
              {tr("Group budget (¥)")}
              <input
                type="number"
                min="0"
                value={newBudget}
                onChange={(e) => setNewBudget(e.target.value)}
              />
            </label>
            <button className="primary" type="submit">
              <Plus size={16} /> {tr("Create trip from template")}
            </button>
          </form>
        </section>
        </div>
        )}
        <footer>
          {tr(
            "Made for groups who want to spend less time packing and more time exploring.",
          )}{" "}
          <span>{tr("Motteku · Prototype")}</span>
        </footer>
      </section>
    </main>
  );
}
function Stat({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
